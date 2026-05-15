import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import {
  getAllProducts,
  getAllPharmacies,
  getAllBrands,
  getAllBanners,
  supabase,
} from '../lib/supabase';
import { getUserPosition, sortByDistance, formatDistance, getPermissionState } from '../lib/geo';
import ProductTile from '../components/ProductTile';
import TabBar from '../components/TabBar';
import './Home.css';

const DEFAULT_CATEGORY_PRESET = {
  bg_color: '#F4F4F2',
  text_color: '#1A1A1A',
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
  const [topBrands, setTopBrands] = useState([]);
  const [banners, setBanners] = useState([]);
  const [activeBannerIdx, setActiveBannerIdx] = useState(0);
  const [favIds, setFavIds] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [latestScan, setLatestScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [couponDismissed, setCouponDismissed] = useState(() => {
    try { return localStorage.getItem('yaram_coupon_dismissed') === '1'; } catch { return false; }
  });

  // ─── GPS au demarrage ───
  useEffect(() => {
    (async () => {
      const state = await getPermissionState();
      if (state === 'granted') {
        const pos = await getUserPosition();
        if (pos) { setUserPos(pos); setGpsStatus('granted'); }
      } else if (state === 'prompt' || state === 'unknown') {
        setGpsStatus('requesting');
        const pos = await getUserPosition(3000);
        if (pos) { setUserPos(pos); setGpsStatus('granted'); }
        else { setGpsStatus('denied'); }
      } else {
        setGpsStatus('denied');
      }
    })();
  }, []);

  // ─── Charger toutes les donnees ───
  useEffect(() => {
    (async () => {
      try {
        const [p, ph, br, bn, catRes] = await Promise.all([
          getAllProducts(),
          getAllPharmacies(),
          getAllBrands(),
          getAllBanners().catch(() => []),
          supabase.from('categories').select('*').eq('active', true).order('display_order', { ascending: true }),
        ]);

        setProducts(p);
        setPharmacies(ph);

        // ─── Categories (depuis la table) ou fallback depuis produits ───
        const catData = catRes?.data || [];
        if (catData.length > 0) {
          // Compte les produits par slug pour afficher la couverture reelle
          const counts = {};
          p.forEach(prod => {
            const c = prod.category;
            if (c) counts[c] = (counts[c] || 0) + 1;
          });
          const enriched = catData.map(cat => ({
            ...cat,
            product_count: counts[cat.slug] || 0,
          }));
          setCategories(enriched);
        } else {
          // Fallback : agrege depuis products (cas ou la table est vide)
          const catMap = {};
          p.forEach(prod => {
            if (!prod.category) return;
            if (!catMap[prod.category]) {
              catMap[prod.category] = {
                id: prod.category,
                slug: prod.category,
                name: prod.category.charAt(0).toUpperCase() + prod.category.slice(1),
                bg_color: DEFAULT_CATEGORY_PRESET.bg_color,
                text_color: DEFAULT_CATEGORY_PRESET.text_color,
                icon_url: null,
                product_count: 0,
              };
            }
            catMap[prod.category].product_count++;
          });
          setCategories(Object.values(catMap).sort((a, b) => b.product_count - a.product_count).slice(0, 12));
        }

        // ─── Top marques (par nb de produits) ───
        const brandCount = {};
        p.forEach(prod => {
          const b = prod.brand;
          if (b) brandCount[b] = (brandCount[b] || 0) + 1;
        });
        const sortedBrands = (br || [])
          .map(b => ({ ...b, _count: brandCount[b.name] || 0 }))
          .sort((a, b) => b._count - a._count)
          .slice(0, 10);
        setTopBrands(sortedBrands);

        // ─── Bannieres actives, filtrees par date ───
        const now = new Date();
        const activeBn = (bn || []).filter(b =>
          b.active !== false &&
          (!b.end_date || new Date(b.end_date) > now)
        );
        setBanners(activeBn);

        // ─── Favoris user ───
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

        // ─── Best sellers ───
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
      } catch (err) {
        console.error('Home load error:', err);
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

  // ─── Auto-rotate bannieres ───
  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => {
      setActiveBannerIdx(i => (i + 1) % banners.length);
    }, 5000);
    return () => clearInterval(t);
  }, [banners.length]);

  const handleEnableGPS = async () => {
    setGpsStatus('requesting');
    const pos = await getUserPosition();
    if (pos) { setUserPos(pos); setGpsStatus('granted'); }
    else { setGpsStatus('denied'); }
  };

  const dismissCoupon = () => {
    setCouponDismissed(true);
    try { localStorage.setItem('yaram_coupon_dismissed', '1'); } catch {}
  };

  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const firstName = user?.first_name || 'toi';
  const avatarLetter = (firstName || 'Y').charAt(0).toUpperCase();

  // ─── Recos pour toi (scoring depuis le scan IA) ───
  const diag = latestScan?.diagnosis || {};
  const skinTypeRaw = latestScan?.skin_type || diag.skin_type || user?.skin_type || null;
  const skinType = skinTypeRaw ? cap(skinTypeRaw) : null;
  const concernsList = (() => {
    if (Array.isArray(diag.concerns) && diag.concerns.length > 0) {
      return diag.concerns.map(c => cap(c.name || c)).filter(Boolean);
    }
    if (Array.isArray(user?.skin_concerns) && user.skin_concerns.length > 0) {
      return user.skin_concerns.map(cap);
    }
    return [];
  })();

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
    ? bestSellers.slice(0, 6)
    : products.slice().sort((a, b) => {
        const sA = (a.review_count || 0) * 0.6 + (a.score || 0) * 0.4;
        const sB = (b.review_count || 0) * 0.6 + (b.score || 0) * 0.4;
        return sB - sA;
      }).slice(0, 6);

  // ─── Handler clic banniere ───
  const handleBannerClick = (banner) => {
    // Increment click_count (silencieux, on attend pas)
    if (banner.id) {
      supabase.rpc('increment_banner_click', { banner_id: banner.id }).catch(() => {
        // fallback : update direct
        supabase.from('banners').update({ click_count: (banner.click_count || 0) + 1 }).eq('id', banner.id);
      });
    }
    // Navigation selon link_type
    if (banner.link_type === 'scan') {
      navigate({ name: 'scan', params: {} });
    } else if (banner.link_type === 'pharmacy') {
      navigate({ name: 'pharmacies', params: {} });
    } else if (banner.link_type === 'product' && banner.link_target) {
      navigate({ name: 'product', params: { id: banner.link_target } });
    } else if (banner.link_type === 'category' && banner.link_target) {
      navigate({ name: 'search', params: { category: banner.link_target } });
    } else if (banner.link_type === 'external' && banner.link_target) {
      window.open(banner.link_target, '_blank');
    }
  };

  return (
    <div className="yhome-screen page-anim">
      <div className="yhome-scroll">

        {/* ════════ HEADER VERT YARAM ════════ */}
        <header className="yhome-hero">
          <div className="yhome-hero-top">
            <button className="yhome-avatar-btn" onClick={() => navigate('/profile')}>
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="yhome-avatar-img" />
              ) : (
                <div className="yhome-avatar-letter">{avatarLetter}</div>
              )}
              <div>
                <div className="yhome-hello">Salut {firstName} 👋</div>
                <div className="yhome-loc">
                  <span className="yhome-loc-dot" />
                  {user?.neighborhood ? `${user.neighborhood}, ` : ''}{user?.city || 'Dakar'}
                </div>
              </div>
            </button>
            <button className="yhome-bell" onClick={() => navigate('/orders')} aria-label="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
              <span className="yhome-bell-dot" />
            </button>
          </div>

          <div className="yhome-search-row">
            <button className="yhome-search-bar" onClick={() => navigate('/search')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span>Cherche un produit, une marque...</span>
            </button>
            <button className="yhome-scan-btn" onClick={() => navigate({ name: 'scan', params: {} })} aria-label="Scan IA">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3"/>
                <line x1="7" y1="12" x2="17" y2="12"/>
              </svg>
            </button>
          </div>
        </header>

        {/* ════════ COUPON PROMO COLLANT ════════ */}
        {!couponDismissed && (
          <div className="yhome-coupon">
            <div className="yhome-coupon-badge">
              -10%<br/><span>1ère</span>
            </div>
            <div className="yhome-coupon-text">
              <strong>Sur ta 1ère commande dès 25 000 FCFA</strong>
              <span>avec le code</span>
            </div>
            <button
              className="yhome-coupon-code"
              onClick={() => {
                try { navigator.clipboard?.writeText('BIENVENUE10'); } catch {}
              }}
            >
              BIENVENUE10
            </button>
            <button className="yhome-coupon-close" onClick={dismissCoupon} aria-label="Fermer">×</button>
          </div>
        )}

        {/* ════════ MARQUES (carrousel cercles) ════════ */}
        {topBrands.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <h2 className="yhome-section-title">Marques</h2>
              <button className="yhome-section-link" onClick={() => navigate('/search')}>
                Tout voir →
              </button>
            </div>
            <div className="yhome-brands-row">
              {topBrands.map(brand => (
                <button
                  key={brand.id}
                  className="yhome-brand-item"
                  onClick={() => navigate({ name: 'search', params: { brand: brand.name } })}
                >
                  <div className="yhome-brand-circle">
                    {brand.logo ? (
                      <img src={brand.logo} alt={brand.name} onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = brand.name.substring(0, 8); }} />
                    ) : (
                      <span className="yhome-brand-initials">{brand.name.substring(0, 8)}</span>
                    )}
                  </div>
                  <div className="yhome-brand-name">
                    {brand.local && <span>🇸🇳 </span>}{brand.name}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ════════ BANNIÈRE HERO ════════ */}
        {banners.length > 0 && (
          <section className="yhome-section">
            <div
              className="yhome-banner-card"
              style={{
                background: banners[activeBannerIdx]?.bg_color || '#1F8B4C',
                color: banners[activeBannerIdx]?.text_color || '#FFFFFF',
              }}
              onClick={() => handleBannerClick(banners[activeBannerIdx])}
            >
              {banners[activeBannerIdx]?.sponsor_name && (
                <div className="yhome-banner-sponsor">{banners[activeBannerIdx].sponsor_name}</div>
              )}
              <div className="yhome-banner-title">{banners[activeBannerIdx]?.title}</div>
              {banners[activeBannerIdx]?.subtitle && (
                <div className="yhome-banner-subtitle">{banners[activeBannerIdx].subtitle}</div>
              )}
              {banners[activeBannerIdx]?.cta_text && banners[activeBannerIdx]?.link_type !== 'none' && (
                <button className="yhome-banner-cta">
                  {banners[activeBannerIdx].cta_text} →
                </button>
              )}
              {banners[activeBannerIdx]?.image_url && (
                <img src={banners[activeBannerIdx].image_url} alt="" className="yhome-banner-img" />
              )}
            </div>
            {banners.length > 1 && (
              <div className="yhome-banner-dots">
                {banners.map((_, i) => (
                  <button
                    key={i}
                    className={`yhome-banner-dot ${i === activeBannerIdx ? 'active' : ''}`}
                    onClick={() => setActiveBannerIdx(i)}
                    aria-label={`Voir bannière ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ════════ CATÉGORIES (grille avec SVG uploadés ou fallback) ════════ */}
        {categories.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <h2 className="yhome-section-title">Catégories</h2>
              <button className="yhome-section-link" onClick={() => navigate({ name: 'categories', params: {} })}>
                Tout voir →
              </button>
            </div>
            <div className="yhome-cat-grid">
              {categories.slice(0, 8).map(cat => (
                <button
                  key={cat.id}
                  className="yhome-cat-item"
                  onClick={() => navigate({ name: 'search', params: { category: cat.slug } })}
                >
                  <div
                    className="yhome-cat-tile"
                    style={{
                      background: cat.bg_color || DEFAULT_CATEGORY_PRESET.bg_color,
                      color: cat.text_color || DEFAULT_CATEGORY_PRESET.text_color,
                    }}
                  >
                    {cat.icon_url ? (
                      <img
                        src={cat.icon_url}
                        alt=""
                        onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = cat.name.charAt(0); }}
                      />
                    ) : (
                      <span>{cat.name.charAt(0)}</span>
                    )}
                  </div>
                  <div className="yhome-cat-name">{cat.name}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ════════ PRÈS DE CHEZ TOI ════════ */}
        <section className="yhome-section">
          <div className="yhome-section-head">
            <div>
              <h2 className="yhome-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" style={{ verticalAlign: -1, marginRight: 4 }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                Près de chez toi
              </h2>
              {gpsStatus === 'granted' && (
                <div className="yhome-section-sub success">GPS activé · trié par distance</div>
              )}
              {gpsStatus === 'denied' && (
                <div className="yhome-section-sub">Active le GPS pour voir les distances</div>
              )}
            </div>
            <button className="yhome-section-link" onClick={() => navigate({ name: 'pharmacies', params: {} })}>
              Tout voir →
            </button>
          </div>

          {gpsStatus === 'denied' && (
            <button className="yhome-gps-btn" onClick={handleEnableGPS}>
              📍 Activer la localisation
            </button>
          )}

          <div className="yhome-pharma-row">
            {nearbyPharmacies.map(ph => (
              <button
                key={ph.id}
                className="yhome-pharma-card"
                onClick={() => navigate({ name: 'pharmacy_detail', params: { id: ph.id } })}
              >
                <div
                  className="yhome-pharma-cover"
                  style={{
                    background: ph.cover
                      ? `url(${ph.cover}) center/cover`
                      : 'linear-gradient(135deg, #1F8B4C, #166635)',
                  }}
                >
                  {ph.distance !== undefined && ph.distance !== Infinity && (
                    <span className="yhome-pharma-dist">📍 {formatDistance(ph.distance)}</span>
                  )}
                </div>
                <div className="yhome-pharma-info">
                  <div className="yhome-pharma-name">{ph.name}</div>
                  <div className="yhome-pharma-area">
                    {ph.neighborhood ? `${ph.neighborhood}, ` : ''}{ph.city}
                  </div>
                  {ph.rating > 0 && (
                    <div className="yhome-pharma-rating">
                      ★ {ph.rating} <span>· {ph.review_count || 0} avis</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ════════ POUR TOI ════════ */}
        {topMatches.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <div>
                <h2 className="yhome-section-title">✨ Pour toi, {firstName}</h2>
                <div className="yhome-section-sub">
                  {latestScan ? `Basé sur ton scan IA · peau ${(skinType || '').toLowerCase()}` : 'Fais ton scan pour des recos perso'}
                </div>
              </div>
              <button className="yhome-section-link" onClick={() => navigate('/search')}>
                Tout voir →
              </button>
            </div>
            <div className="product-grid">
              {topMatches.map(p => <ProductTile key={p.id} product={p} />)}
            </div>
          </section>
        )}

        {/* ════════ TENDANCES ════════ */}
        {trending.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <div>
                <h2 className="yhome-section-title">🔥 Tendances cette semaine</h2>
                <div className="yhome-section-sub">
                  {bestSellers.length > 0 ? 'Les plus commandés' : 'Les plus appréciés'}
                </div>
              </div>
              <button className="yhome-section-link" onClick={() => navigate('/search')}>
                Tout voir →
              </button>
            </div>
            <div className="product-grid">
              {trending.map(p => <ProductTile key={p.id} product={p} />)}
            </div>
          </section>
        )}

        <div style={{ height: 40 }} />
      </div>

      <TabBar active="home" />
    </div>
  );
}
