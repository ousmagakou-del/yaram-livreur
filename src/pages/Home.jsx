import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { getAllProducts, getAllPharmacies, supabase } from '../lib/supabase';
import { getUserPosition, sortByDistance, formatDistance, getPermissionState } from '../lib/geo';
import ProductTile from '../components/ProductTile';
import TabBar from '../components/TabBar';
import BannerCarousel from '../components/BannerCarousel';
import './Home.css';

const CATEGORY_EMOJI = {
  'Visage': '✨', 'Corps': '🧴', 'Bébé': '👶', 'Bucco-dentaire': '🦷',
  'Compléments': '💊', 'Cheveux': '💇', 'Solaire': '☀️', 'Intime': '🌸',
  'Hygiène': '🧼', 'Pieds & Mains': '🦶', 'Lèvres': '💋', 'Déodorants': '🌿',
};

export default function Home() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [products, setProducts] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [nearbyPharmacies, setNearbyPharmacies] = useState([]);
  const [userPos, setUserPos] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('unknown');
  const [categories, setCategories] = useState([]);
  const [favIds, setFavIds] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [latestScan, setLatestScan] = useState(null);
  const [loading, setLoading] = useState(true);

  // ─── Demander GPS au démarrage ───
  useEffect(() => {
    (async () => {
      const state = await getPermissionState();
      if (state === 'granted') {
        const pos = await getUserPosition();
        if (pos) {
          setUserPos(pos);
          setGpsStatus('granted');
        }
      } else if (state === 'prompt' || state === 'unknown') {
        setGpsStatus('requesting');
        const pos = await getUserPosition(3000);
        if (pos) {
          setUserPos(pos);
          setGpsStatus('granted');
        } else {
          setGpsStatus('denied');
        }
      } else {
        setGpsStatus('denied');
      }
    })();
  }, []);

  // ─── Charger données ───
  useEffect(() => {
    (async () => {
      const [p, ph] = await Promise.all([getAllProducts(), getAllPharmacies()]);
      setProducts(p);
      setPharmacies(ph);

      const catMap = {};
      p.forEach(prod => {
        if (!prod.category) return;
        const cat = prod.category;
        if (cat[0] !== cat[0].toUpperCase()) return;
        if (!catMap[cat]) catMap[cat] = { id: cat, name: cat, count: 0, sampleImg: null };
        catMap[cat].count++;
        if (!catMap[cat].sampleImg && prod.img) catMap[cat].sampleImg = prod.img;
      });
      setCategories(Object.values(catMap).sort((a, b) => b.count - a.count));

      if (user?.id) {
        const { data: favs } = await supabase
          .from('favorites').select('product_id').eq('user_id', user.id);
        setFavIds((favs || []).map(f => f.product_id));

        const { data: scan } = await supabase
          .from('skin_scans').select('*')
          .eq('user_id', user.id).order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        setLatestScan(scan);
      }

      try {
        const { data: orders } = await supabase
          .from('orders').select('items')
          .in('status', ['delivered', 'shipped', 'ready', 'preparing']);

        const productSales = {};
        (orders || []).forEach(o => {
          (o.items || []).forEach(item => {
            if (item.productId) {
              productSales[item.productId] = (productSales[item.productId] || 0) + (item.qty || 1);
            }
          });
        });

        const sortedIds = Object.entries(productSales)
          .sort((a, b) => b[1] - a[1]).map(([id]) => id);
        const best = sortedIds.map(id => p.find(pr => pr.id === id)).filter(Boolean);
        setBestSellers(best);
      } catch (e) {
        console.error('best sellers error:', e);
      }

      setLoading(false);
    })();
  }, [user?.id]);

  // ─── Trier pharmacies par distance ───
  useEffect(() => {
    if (pharmacies.length === 0) return;
    if (userPos) {
      const sorted = sortByDistance(pharmacies, userPos.lat, userPos.lng);
      setNearbyPharmacies(sorted.slice(0, 5));
    } else {
      setNearbyPharmacies(pharmacies.slice(0, 5));
    }
  }, [pharmacies, userPos]);

  const handleEnableGPS = async () => {
    setGpsStatus('requesting');
    const pos = await getUserPosition();
    if (pos) {
      setUserPos(pos);
      setGpsStatus('granted');
    } else {
      setGpsStatus('denied');
    }
  };

  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const firstName = user?.first_name || 'toi';
  const avatar = user?.avatar || ('https://ui-avatars.com/api/?background=1F8B4C&color=fff&bold=true&name=' + encodeURIComponent(firstName));

  // ─── Données du scan IA (priorité) ou fallback user ───
  const diag = latestScan?.diagnosis || {};
  const skinTypeRaw = latestScan?.skin_type || diag.skin_type || user?.skin_type || null;
  const skinType = skinTypeRaw ? cap(skinTypeRaw) : null;
  const phototype = user?.skin_phototype || diag.phototype || null;
  const skinScore = latestScan?.skin_score ?? diag.skin_score ?? null;

  // Concerns réelles du scan IA, fallback sur user.skin_concerns si pas de scan
  const concernsList = (() => {
    if (Array.isArray(diag.concerns) && diag.concerns.length > 0) {
      return diag.concerns.map(c => cap(c.name || c)).filter(Boolean);
    }
    if (Array.isArray(user?.skin_concerns) && user.skin_concerns.length > 0) {
      return user.skin_concerns.map(cap);
    }
    return [];
  })();
  const concernsText = concernsList.length > 0 ? concernsList.slice(0, 3).join(' · ') : null;
  const concernsCount = concernsList.length;
  const favs = favIds.length;

  // ─── Recommandation produits basée sur le scan ───
  const scoreProduct = (p) => {
    let score = 0;
    const userSkin = (skinTypeRaw || '').toLowerCase();
    if (p.skin_types && p.skin_types.length > 0) {
      const compatible = p.skin_types.some(t =>
        t.toLowerCase() === userSkin || t.toLowerCase() === 'toutes' || t.toLowerCase() === 'all'
      );
      if (compatible) score += 30;
    } else score += 15;
    score += (p.score || 50) * 0.3;

    if (diag.ingredients_recommandes) {
      const recommended = diag.ingredients_recommandes.map(i => i.toLowerCase());
      const productText = `${p.name || ''} ${p.inci || ''} ${p.short_desc || ''}`.toLowerCase();
      const matches = recommended.filter(ing => productText.includes(ing)).length;
      score += matches * 5;
    }
    if (diag.ingredients_a_eviter) {
      const avoid = diag.ingredients_a_eviter.map(i => i.toLowerCase());
      const productText = `${p.name || ''} ${p.inci || ''}`.toLowerCase();
      const matches = avoid.filter(ing => productText.includes(ing)).length;
      score -= matches * 10;
    }
    if (concernsList.length > 0 && p.short_desc) {
      const desc = p.short_desc.toLowerCase();
      concernsList.forEach(c => { if (desc.includes(c.toLowerCase())) score += 5; });
    }
    if (favIds.includes(p.id)) score += 20;
    return score;
  };

  const topMatches = products
    .slice()
    .map(p => ({ ...p, _personalScore: scoreProduct(p) }))
    .sort((a, b) => b._personalScore - a._personalScore)
    .slice(0, 6);

  const trending = bestSellers.length > 0
    ? bestSellers.slice(0, 4)
    : products.slice().sort((a, b) => {
        const scoreA = (a.review_count || 0) * 0.6 + (a.score || 0) * 0.4;
        const scoreB = (b.review_count || 0) * 0.6 + (b.score || 0) * 0.4;
        return scoreB - scoreA;
      }).slice(0, 4);

  return (
    <div className="home-screen page-anim">
      <div className="home-scroll">
        <div className="home-header">
          <button className="home-avatar-btn" onClick={() => navigate('/profile')}>
            <img src={avatar} alt="" />
            <div>
              <div className="home-hello">Salut {firstName} 👋</div>
              <div className="home-loc">
                <span className="home-dot" /> {user?.neighborhood ? `${user.neighborhood}, ` : ''}{user?.city || 'Dakar'}
              </div>
            </div>
          </button>
          <button className="home-bell" onClick={() => navigate('/orders')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            <span className="home-bell-dot" />
          </button>
        </div>

        <button className="home-search-bar" onClick={() => navigate('/search')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span>Cherche un produit, une marque...</span>
        </button>

        {/* ─── PROFIL PEAU — tout dynamique ─── */}
        <div className="home-skin-card">
          <div className="home-skin-label">TON PROFIL PEAU</div>

          {latestScan ? (
            <>
              <div className="home-skin-type">
                {skinType || 'Peau'}
                {phototype ? ` · Phototype ${phototype}` : ''}
              </div>
              {concernsText && (
                <div className="home-skin-concerns">{concernsText}</div>
              )}
              <div className="home-skin-stats">
                <div className="home-skin-stat">
                  <div className="home-skin-num">{skinScore != null ? skinScore : '—'}</div>
                  <div className="home-skin-stat-lbl">score peau</div>
                </div>
                <div className="home-skin-stat">
                  <div className="home-skin-num">{concernsCount}</div>
                  <div className="home-skin-stat-lbl">à surveiller</div>
                </div>
                <div className="home-skin-stat">
                  <div className="home-skin-num">{favs}</div>
                  <div className="home-skin-stat-lbl">favoris</div>
                </div>
              </div>
              <button className="home-skin-cta" onClick={() => navigate({ name: 'scan', params: {} })}>
                Refaire le diagnostic →
              </button>
            </>
          ) : (
            <>
              <div className="home-skin-type">Pas encore de diagnostic</div>
              <div className="home-skin-concerns">
                Fais ton 1er scan IA pour obtenir des recommandations personnalisées
              </div>
              <div className="home-skin-stats">
                <div className="home-skin-stat">
                  <div className="home-skin-num">—</div>
                  <div className="home-skin-stat-lbl">score peau</div>
                </div>
                <div className="home-skin-stat">
                  <div className="home-skin-num">—</div>
                  <div className="home-skin-stat-lbl">à surveiller</div>
                </div>
                <div className="home-skin-stat">
                  <div className="home-skin-num">{favs}</div>
                  <div className="home-skin-stat-lbl">favoris</div>
                </div>
              </div>
              <button className="home-skin-cta" onClick={() => navigate({ name: 'scan', params: {} })}>
                Faire ton diagnostic IA →
              </button>
            </>
          )}
        </div>

        <div style={{ padding: '0 16px' }}><BannerCarousel /></div>

        {/* PRÈS DE CHEZ TOI */}
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1A1A1A' }}>
                📍 Près de chez toi
              </div>
              {gpsStatus === 'granted' && (
                <div style={{ fontSize: 11, color: '#1F8B4C', fontWeight: 600 }}>
                  GPS activé · trié par distance
                </div>
              )}
              {gpsStatus === 'denied' && (
                <div style={{ fontSize: 11, color: '#9B9B9B' }}>
                  Active le GPS pour voir les distances
                </div>
              )}
            </div>
            <button
              onClick={() => navigate({ name: 'pharmacies', params: {} })}
              style={{ background: 'transparent', border: 'none', color: '#1F8B4C', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Tout voir →
            </button>
          </div>

          {gpsStatus === 'denied' && (
            <div style={{ padding: '0 16px', marginBottom: 12 }}>
              <button
                onClick={handleEnableGPS}
                style={{
                  width: '100%', padding: 14,
                  background: 'linear-gradient(135deg, #1F8B4C, #166635)',
                  color: 'white', border: 'none', borderRadius: 12,
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                📍 Activer la localisation
              </button>
            </div>
          )}

          {gpsStatus === 'requesting' && (
            <div style={{ padding: 20, textAlign: 'center', color: '#9B9B9B', fontSize: 13 }}>
              📍 Recherche de ta position…
            </div>
          )}

          <div style={{
            display: 'flex', gap: 12, padding: '0 16px',
            overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            scrollSnapType: 'x mandatory',
          }}>
            {nearbyPharmacies.map(ph => (
              <button
                key={ph.id}
                onClick={() => navigate({ name: 'pharmacy_detail', params: { id: ph.id } })}
                style={{
                  flexShrink: 0, width: 220,
                  background: 'white', border: '1px solid #EEE',
                  borderRadius: 14, padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                  scrollSnapAlign: 'start', overflow: 'hidden',
                }}
              >
                <div style={{
                  height: 100,
                  background: ph.cover
                    ? `url(${ph.cover}) center/cover`
                    : 'linear-gradient(135deg, #1F8B4C, #166635)',
                  position: 'relative',
                }}>
                  {ph.distance !== undefined && ph.distance !== Infinity && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      background: 'white', padding: '4px 10px',
                      borderRadius: 999, fontSize: 11, fontWeight: 800,
                      color: '#1F8B4C', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    }}>
                      📍 {formatDistance(ph.distance)}
                    </div>
                  )}
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1A1A', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ph.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 6 }}>
                    {ph.neighborhood ? `${ph.neighborhood}, ` : ''}{ph.city}
                  </div>
                  {ph.rating > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#F4B53A', fontWeight: 700 }}>
                      ★ {ph.rating} <span style={{ color: '#9B9B9B', fontWeight: 400 }}>· {ph.review_count || 0} avis</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* CATÉGORIES */}
        <div className="home-section" style={{ marginTop: 24 }}>
          <div className="home-section-head">
            <div className="section-title">Catégories</div>
            <button className="section-link" onClick={() => navigate({ name: 'categories', params: {} })}>Tout voir →</button>
          </div>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9B9B9B' }}>Chargement…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, padding: '0 16px' }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => navigate({ name: 'search', params: { category: cat.id } })}
                  style={{
                    background: 'white', border: '1px solid #EEE', borderRadius: 14,
                    padding: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  }}
                >
                  <div style={{
                    width: '100%', aspectRatio: '1/1',
                    background: 'linear-gradient(135deg, #1F8B4C20, #1F8B4C10)',
                    borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 36, marginBottom: 8, overflow: 'hidden',
                  }}>
                    {cat.sampleImg ? (
                      <img src={cat.sampleImg} alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = CATEGORY_EMOJI[cat.name] || '📦'; }}
                      />
                    ) : (CATEGORY_EMOJI[cat.name] || '📦')}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A', lineHeight: 1.2 }}>{cat.name}</div>
                  <div style={{ fontSize: 11, color: '#6B6B6B', marginTop: 2 }}>{cat.count} produit{cat.count > 1 ? 's' : ''}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* POUR TOI */}
        <div className="home-section">
          <div className="home-section-head">
            <div>
              <div className="section-title">✨ Pour toi, {firstName}</div>
              <div className="section-sub">
                {latestScan ? `Basé sur ton scan IA · peau ${(skinType || '').toLowerCase()}` : 'Fais ton scan pour des recos perso'}
              </div>
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>Chargement…</div>
          ) : topMatches.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>Aucun produit</div>
          ) : (
            <div className="product-grid">
              {topMatches.map(p => <ProductTile key={p.id} product={p} />)}
            </div>
          )}
        </div>

        {/* TENDANCES */}
        <div className="home-section">
          <div className="home-section-head">
            <div>
              <div className="section-title">🔥 Tendances cette semaine</div>
              <div className="section-sub">
                {bestSellers.length > 0 ? 'Les plus commandés' : 'Les plus appréciés'}
              </div>
            </div>
          </div>
          {loading ? null : (
            <div className="product-grid" style={{ marginTop: 12 }}>
              {trending.map(p => <ProductTile key={p.id} product={p} />)}
            </div>
          )}
        </div>

        <div style={{ height: 30 }} />
      </div>
      <TabBar active="home" />
    </div>
  );
}