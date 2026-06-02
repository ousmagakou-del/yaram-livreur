import { useState, useEffect, useRef } from 'react';
import { useNav, useUser } from '../App';
import {
  getAllProducts,
  getAllPharmacies,
  getAllBrands,
  getAllBanners,
  getAllCategories,
  getMyAddresses,
  supabase,
} from '../lib/supabase';
import { getUserPosition, sortByDistance, formatDistance, getPermissionState } from '../lib/geo';
import ProductTile from '../components/ProductTile';
import PullToRefresh from '../components/PullToRefresh';
import TabBar from '../components/TabBar';
import BarcodeScannerClient from '../components/BarcodeScannerClient';
import { usePageSEO } from '../lib/seo';
import '../components/BarcodeScannerClient.css';
import './Home.css';

const DEFAULT_CATEGORY_PRESET = {
  bg_color: '#F4F4F2',
  text_color: '#1A1A1A',
};

// ─── Cache module-level + persisté en sessionStorage ───
// Avant : perdu au refresh → écran vide + 8 fetch au boot
// Apres : restaure depuis sessionStorage si < 5 min, refresh en arriere-plan
const HOME_CACHE_KEY = 'yaram-home-cache-v1';
const HOME_CACHE_TTL = 5 * 60 * 1000;        // sessionStorage = 5 min (frais)
const HOME_LS_FALLBACK_TTL = 24 * 60 * 60 * 1000; // localStorage fallback = 24h (afficher OLD au resume)

function loadHomeCacheFromStorage() {
  try {
    // 1. sessionStorage (frais < 5 min) — priorité
    const raw = sessionStorage.getItem(HOME_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.loadedAt && Date.now() - parsed.loadedAt < HOME_CACHE_TTL) {
        return parsed;
      }
    }
    // 2. localStorage fallback (peut être OLD 24h) — pour afficher INSTANT au resume
    // L'app affiche les vieilles données pendant que le refresh BG se fait
    const lsRaw = localStorage.getItem(HOME_CACHE_KEY);
    if (lsRaw) {
      const parsed = JSON.parse(lsRaw);
      if (parsed?.loadedAt && Date.now() - parsed.loadedAt < HOME_LS_FALLBACK_TTL && parsed?.products?.length > 0) {
        console.log('[Home] Restored from localStorage (age:', Math.round((Date.now() - parsed.loadedAt) / 1000), 's)');
        return parsed;
      }
    }
    return null;
  } catch { return null; }
}

const restored = typeof window !== 'undefined' ? loadHomeCacheFromStorage() : null;

const homeDataCache = restored || {
  products: null,
  pharmacies: null,
  categories: null,
  topBrands: null,
  banners: null,
  bestSellers: null,
  loadedAt: 0,
};

function persistHomeCache() {
  try {
    const json = JSON.stringify(homeDataCache);
    sessionStorage.setItem(HOME_CACHE_KEY, json);
    // Persist aussi en localStorage pour survivre ferme/réouvre app
    // (vital pour iOS post-background : affiche old data INSTANT au lieu de loader)
    try {
      if (json.length < 2 * 1024 * 1024) { // 2 MB max
        localStorage.setItem(HOME_CACHE_KEY, json);
      }
    } catch { /* quota plein, on s'en moque */ }
  } catch { /* ignore quota errors */ }
}

export default function Home() {
  const { navigate, route } = useNav();
  const { user } = useUser();

  usePageSEO({
    title: 'YARAM · Beauté pour ta peau africaine',
    description: 'Marketplace beauté Sénégal · Diagnostic IA peau gratuit · 800+ produits adaptés à la peau africaine · Livraison 24h Dakar',
    canonical: 'https://yaram.app/',
  });

  // ─── Hydrate depuis le cache module-level si dispo (instantane) ───
  const [products, setProducts] = useState(homeDataCache.products || []);
  const [pharmacies, setPharmacies] = useState(homeDataCache.pharmacies || []);
  const [nearbyPharmacies, setNearbyPharmacies] = useState([]);
  const [userPos, setUserPos] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('unknown');

  // ─── Adresses utilisateur (pour switcher la ville affichée) ───
  const [addresses, setAddresses] = useState([]);
  const [selectedAddrId, setSelectedAddrId] = useState(() => {
    try { return localStorage.getItem('yaram_selected_addr_id') || null; } catch { return null; }
  });
  const [showAddrPicker, setShowAddrPicker] = useState(false);

  useEffect(() => {
    if (!user?.id) { setAddresses([]); return; }
    (async () => {
      try {
        const list = await getMyAddresses();
        setAddresses(list || []);
        // Si pas de sélection en cours OU sélection invalide (adresse supprimée),
        // tombe sur l'adresse par défaut DB ou la première dispo.
        const stillValid = (list || []).find(a => a.id === selectedAddrId);
        if (!stillValid) {
          const def = (list || []).find(a => a.is_default) || list?.[0];
          if (def) {
            setSelectedAddrId(def.id);
            try { localStorage.setItem('yaram_selected_addr_id', def.id); } catch {}
          }
        }
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // SAFETY : addresses peut être null/undefined avant le fetch initial
  const selectedAddr = addresses?.find(a => a.id === selectedAddrId)
    || addresses?.find(a => a.is_default)
    || addresses?.[0]
    || null;

  const switchAddress = (id) => {
    setSelectedAddrId(id);
    try { localStorage.setItem('yaram_selected_addr_id', id); } catch {}
    setShowAddrPicker(false);
  };
  const [categories, setCategories] = useState(homeDataCache.categories || []);
  const [topBrands, setTopBrands] = useState(homeDataCache.topBrands || []);
  const [banners, setBanners] = useState(homeDataCache.banners || []);
  const [activeBannerIdx, setActiveBannerIdx] = useState(0);
  const [favIds, setFavIds] = useState([]);
  const [bestSellers, setBestSellers] = useState(homeDataCache.bestSellers || []);
  const [latestScan, setLatestScan] = useState(null);
  // Loading = true SEULEMENT au tout premier load (pas de cache)
  const [loading, setLoading] = useState(!homeDataCache.products);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [couponDismissed, setCouponDismissed] = useState(() => {
    try { return localStorage.getItem('yaram_coupon_dismissed') === '1'; } catch { return false; }
  });

  // Ref pour eviter les re-fetch concurrents
  const fetchingRef = useRef(false);

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

  // ─── Charger toutes les donnees (STREAMING progressif) ───
  // PERF FIX (mai 2026) :
  // - Avant : Promise.all([8 fetches]) qui bloque sur la plus lente requete (3-8 sec sur 4G)
  // - Apres : 3 phases parallèles. Phase 1 = ESSENTIEL (products, categories), affiche
  //   la page immediatement. Phase 2 + 3 = enrichissement (banniere, best sellers, ...)
  //   en arriere-plan sans bloquer l'UI.
  //
  // - Safety : fetchingRef reset GARANTI via try/catch/finally à 3 niveaux
  // - Safety : si Phase 1 mets > 8 sec, on abort et garde le cache (evite app figee)
  const loadData = async (force = false) => {
    // Si fetch deja en cours ET pas force → skip
    if (fetchingRef.current && !force) return;
    fetchingRef.current = true;

    // Cache check : si data fresh (< 5 min) et pas force, on skip
    const cacheAge = Date.now() - homeDataCache.loadedAt;
    if (!force && homeDataCache.products && cacheAge < 5 * 60 * 1000) {
      fetchingRef.current = false;
      setLoading(false);
      return;
    }

    // SAFETY : timeout global 12 sec. Au-dela on relache fetchingRef pour
    // pas figer l'app, meme si une promise pend infiniment.
    // Safety 25s : réseau africain 3G lent peut prendre 15-20s
    const safetyTimeout = setTimeout(() => {
      console.warn('[Home] loadData safety timeout, releasing fetchingRef');
      fetchingRef.current = false;
      setLoading(false);
    }, 25000);

    try {
      // ═══ PHASE 1 : ESSENTIEL (affiche la page le plus vite possible) ═══
      // Products + categories en parallele AVEC CACHE SWR.
      // Avant : categories query directe → 200-500ms à chaque retour Home.
      // Maintenant : cached → instant si déjà chargé.
      const phase1 = Promise.all([
        getAllProducts(),
        getAllCategories(),
      ]);

      const [p, catData] = await phase1;

      setProducts(p);
      homeDataCache.products = p;

      // Compute categories
      let newCategories;
      if (catData.length > 0) {
        const counts = {};
        p.forEach(prod => { if (prod.category) counts[prod.category] = (counts[prod.category] || 0) + 1; });
        newCategories = catData.map(cat => ({ ...cat, product_count: counts[cat.slug] || 0 }));
      } else {
        const catMap = {};
        p.forEach(prod => {
          if (!prod.category) return;
          if (!catMap[prod.category]) {
            catMap[prod.category] = {
              id: prod.category, slug: prod.category,
              name: prod.category.charAt(0).toUpperCase() + prod.category.slice(1),
              bg_color: DEFAULT_CATEGORY_PRESET.bg_color,
              text_color: DEFAULT_CATEGORY_PRESET.text_color,
              icon_url: null, product_count: 0,
            };
          }
          catMap[prod.category].product_count++;
        });
        newCategories = Object.values(catMap).sort((a, b) => b.product_count - a.product_count).slice(0, 12);
      }
      setCategories(newCategories);
      homeDataCache.categories = newCategories;

      // L'utilisateur peut maintenant voir la page → unblock loading
      setLoading(false);

      // ═══ PHASE 2 : ENRICHISSEMENT (best sellers, brands, banners, pharmacies) ═══
      // Lancé en parallele mais NE BLOQUE PAS l'UI. Si une promise rame, on s'en moque.
      Promise.all([
        getAllPharmacies().catch(() => []),
        getAllBrands().catch(() => []),
        getAllBanners().catch(() => []),
      ]).then(([ph, br, bn]) => {
        setPharmacies(ph);
        homeDataCache.pharmacies = ph;

        // Top brands
        const brandCount = {};
        p.forEach(prod => { if (prod.brand) brandCount[prod.brand] = (brandCount[prod.brand] || 0) + 1; });
        const sortedBrands = (br || [])
          .map(b => ({ ...b, _count: brandCount[b.name] || 0 }))
          .sort((a, b) => b._count - a._count)
          .slice(0, 10);
        setTopBrands(sortedBrands);
        homeDataCache.topBrands = sortedBrands;

        // Banners (filtre par dates)
        const now = new Date();
        const activeBn = (bn || []).filter(b => {
          if (b.active === false) return false;
          if (!b.end_date) return true;
          const d = new Date(b.end_date);
          return !isNaN(d.getTime()) && d > now;
        });
        setBanners(activeBn);
        homeDataCache.banners = activeBn;
        // PERSIST Phase 2 dans sessionStorage + localStorage
        persistHomeCache();
      }).catch(e => console.warn('[Home] phase 2 enrichissement failed (non-bloquant):', e?.message));

      // ═══ PHASE 3 : USER-SPECIFIC (favorites, last scan, best sellers RPC) ═══
      // Aussi non-bloquant. Si user pas connecte, skip.
      if (user?.id) {
        supabase.from('favorites').select('product_id').eq('user_id', user.id)
          .then(({ data }) => setFavIds((data || []).map(f => f.product_id)))
          .catch(() => {});

        supabase.from('skin_scans').select('*')
          .eq('user_id', user.id).order('created_at', { ascending: false })
          .limit(1).maybeSingle()
          .then(({ data }) => setLatestScan(data))
          .catch(() => {});
      }

      // Best sellers RPC (cote serveur, peut etre lent) — non-bloquant
      supabase.rpc('public_best_sellers', { p_limit: 30 })
        .then(({ data: rows }) => {
          const best = (rows || []).map(r => p.find(pr => pr.id === r.product_id)).filter(Boolean);
          setBestSellers(best);
          homeDataCache.bestSellers = best;
        })
        .catch(e => console.warn('[Home] best sellers RPC failed (non-bloquant):', e?.message));

      // Mise a jour finale du cache (meme si Phase 2/3 pas encore terminees)
      homeDataCache.loadedAt = Date.now();
      persistHomeCache();
    } catch (err) {
      console.error('[Home] Phase 1 fatal error:', err);
    } finally {
      clearTimeout(safetyTimeout);
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  // ─── Load au mount + quand l'user change ───
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ─── Re-fetch silencieux quand on revient sur le Home ───
  // Pattern : si route.name === 'home' ET cache > 30s, refresh BG
  useEffect(() => {
    if (route?.name !== 'home') return;
    const cacheAge = Date.now() - homeDataCache.loadedAt;
    if (cacheAge > 30 * 1000) {
      // Refresh en BG, ne montre pas le loading (on a deja la data du cache)
      loadData(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.name]);

  // ─── Refresh quand l'app redevient visible (retour iOS) ───
  // PERF FIX : on ne refetch QUE si on est physiquement sur la Home, sinon
  // on déclenche des refetch inutiles quand l'user revient du background sur
  // une autre page (ex: Promos, Product) → lag a la prochaine nav home.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Skip si on n'est pas sur la Home (ex : user sur Promos quand iPhone re-ouvre)
      if (route?.name !== 'home' && route?.name) return;
      const cacheAge = Date.now() - homeDataCache.loadedAt;
      if (cacheAge > 60 * 1000) {
        loadData(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ─── Auto-refresh sur retour navigation (popstate iOS) ───
    // Quand l'user fait "Retour" depuis une autre page (Product, Cart, etc.)
    // vers Home, force un refresh des données si le cache a > 30 sec.
    // Évite le bug "données obsolètes au retour qui force un manual refresh".
    const handleRouteBack = (e) => {
      const target = e?.detail?.to;
      if (target?.name !== 'home' && target?.name) return;
      const cacheAge = Date.now() - homeDataCache.loadedAt;
      if (cacheAge > 30 * 1000) {
        loadData(true);
      }
    };
    window.addEventListener('yaram-route-back', handleRouteBack);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('yaram-route-back', handleRouteBack);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.name]);

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
    const t = setInterval(() => setActiveBannerIdx(i => (i + 1) % banners.length), 5000);
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
      const rec = diag.ingredients_recommandes.map(i => i.toLowerCase());
      const txt = `${p.name || ''} ${p.inci || ''} ${p.short_desc || ''}`.toLowerCase();
      score += rec.filter(ing => txt.includes(ing)).length * 5;
    }
    if (diag.ingredients_a_eviter) {
      const avo = diag.ingredients_a_eviter.map(i => i.toLowerCase());
      const txt = `${p.name || ''} ${p.inci || ''}`.toLowerCase();
      score -= avo.filter(ing => txt.includes(ing)).length * 10;
    }
    if (concernsList.length > 0 && p.short_desc) {
      const desc = p.short_desc.toLowerCase();
      concernsList.forEach(c => { if (desc.includes(c.toLowerCase())) score += 5; });
    }
    if (favIds.includes(p.id)) score += 20;
    return score;
  };

  const topMatches = products.slice().map(p => ({ ...p, _personalScore: scoreProduct(p) }))
    .sort((a, b) => b._personalScore - a._personalScore).slice(0, 4);

  const trending = bestSellers.length > 0
    ? bestSellers.slice(0, 4)
    : products.slice().sort((a, b) => {
        const sA = (a.review_count || 0) * 0.6 + (a.score || 0) * 0.4;
        const sB = (b.review_count || 0) * 0.6 + (b.score || 0) * 0.4;
        return sB - sA;
      }).slice(0, 4);

  const handleBannerClick = (banner) => {
    if (banner.id) {
      supabase.rpc('increment_banner_click', { banner_id: banner.id }).catch(() => {
        supabase.from('banners').update({ click_count: (banner.click_count || 0) + 1 }).eq('id', banner.id);
      });
    }
    if (banner.link_type === 'scan') navigate({ name: 'scan', params: {} });
    else if (banner.link_type === 'pharmacy') navigate({ name: 'pharmacies', params: {} });
    else if (banner.link_type === 'product' && banner.link_target) navigate({ name: 'product', params: { id: banner.link_target } });
    else if (banner.link_type === 'category' && banner.link_target) navigate({ name: 'search', params: { category: banner.link_target } });
    else if (banner.link_type === 'external' && banner.link_target) window.open(banner.link_target, '_blank');
  };

  const handleProductFound = (productId) => {
    setScannerOpen(false);
    navigate({ name: 'product', params: { id: productId } });
  };

  // ─── Skeleton loader (premier load seulement) ───
  if (loading && products.length === 0) {
    return (
      <div className="yhome-screen page-anim">
        <div className="yhome-scroll">
          <header className="yhome-hero">
            <div className="yhome-hero-top">
              <div className="yhome-avatar-btn">
                <div className="yhome-avatar-letter" style={{ background: 'rgba(255,255,255,0.2)' }} />
                <div>
                  <div style={{ width: 120, height: 12, background: 'rgba(255,255,255,0.25)', borderRadius: 6, marginBottom: 6 }} />
                  <div style={{ width: 80, height: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 6 }} />
                </div>
              </div>
            </div>
            <div className="yhome-search-row">
              <div className="yhome-search-bar" style={{ background: 'rgba(255,255,255,0.9)', height: 44 }} />
              <div className="yhome-scan-btn" />
            </div>
          </header>

          <div style={{ padding: 16 }}>
            <div style={{ background: '#EEE', height: 100, borderRadius: 14, marginBottom: 16 }} />
            <div style={{ background: '#EEE', height: 70, borderRadius: 14, marginBottom: 16 }} />
            <div style={{ background: '#EEE', height: 180, borderRadius: 14, marginBottom: 16 }} />
            <div style={{ background: '#EEE', height: 240, borderRadius: 14 }} />
          </div>
        </div>
        <TabBar active="home" />
      </div>
    );
  }

  // Handler pull-to-refresh : force le refetch + petite pause pour montrer le spinner
  const handlePullRefresh = async () => {
    try {
      await loadData(true);
      // Petite pause pour que l'user voit le feedback visuel (sinon le spinner disparaît trop vite si data en cache)
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn('[Home] pull refresh failed:', e?.message);
    }
  };

  return (
    <div className="yhome-screen page-anim">
      <div className="yhome-scroll">
      <PullToRefresh onRefresh={handlePullRefresh}>

        {/* ════════ HEADER VERT YARAM ════════ */}
        <header className="yhome-hero">
          <div className="yhome-hero-top">
            <div className="yhome-avatar-btn" style={{ background: 'transparent', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => navigate('/profile')}
                style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                aria-label="Mon profil"
              >
                {user?.avatar ? (
                  <img src={user.avatar} alt={user.first_name || 'Avatar'} loading="eager" decoding="async" className="yhome-avatar-img" />
                ) : (
                  <div className="yhome-avatar-letter">{avatarLetter}</div>
                )}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="yhome-hello">Salut {firstName} 👋</div>
                <button
                  onClick={() => {
                    // Si une seule adresse OU aucune → emmène vers gestion adresses
                    if (addresses.length <= 1) {
                      navigate({ name: 'addresses', params: {} });
                    } else {
                      setShowAddrPicker(true);
                    }
                  }}
                  className="yhome-loc"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'inherit',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span className="yhome-loc-dot" />
                  {selectedAddr ? (
                    <>
                      {selectedAddr.label ? `${selectedAddr.label} · ` : ''}
                      {selectedAddr.neighborhood ? `${selectedAddr.neighborhood}, ` : ''}
                      {selectedAddr.city}
                    </>
                  ) : (
                    user?.neighborhood ? `${user.neighborhood}, ${user?.city || 'Dakar'}` :
                    user?.city || '📍 Ajouter mon adresse'
                  )}
                  {addresses.length > 1 && <span style={{ fontSize: 10, opacity: 0.7 }}> ▼</span>}
                </button>
              </div>
            </div>

            {/* Picker d'adresses (modal simple) */}
            {showAddrPicker && (
              <div
                onClick={() => setShowAddrPicker(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.5)',
                  zIndex: 999,
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: '#fff',
                    width: '100%',
                    maxWidth: 500,
                    borderRadius: '16px 16px 0 0',
                    padding: '20px 16px calc(var(--safe-bottom,0px) + 24px)',
                    maxHeight: '70vh',
                    overflowY: 'auto',
                  }}
                >
                  <h3 style={{ margin: '0 0 14px', fontSize: 17, color: '#1A1A1A' }}>📍 Mes adresses</h3>
                  {addresses.map(a => (
                    <button
                      key={a.id}
                      onClick={() => switchAddress(a.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        width: '100%',
                        padding: '12px 14px',
                        background: a.id === selectedAddrId ? 'rgba(31,139,76,0.08)' : '#fff',
                        border: `1px solid ${a.id === selectedAddrId ? '#1F8B4C' : '#E5E5E2'}`,
                        borderRadius: 12,
                        marginBottom: 8,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{
                        width: 20, height: 20, borderRadius: '50%',
                        border: `2px solid ${a.id === selectedAddrId ? '#1F8B4C' : '#CCC'}`,
                        background: a.id === selectedAddrId ? '#1F8B4C' : 'transparent',
                        flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1A1A1A' }}>
                          {a.label || 'Adresse'} {a.is_default && <span style={{ fontSize: 10, color: '#1F8B4C' }}>· défaut</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#6B6B6B' }}>
                          {a.neighborhood ? `${a.neighborhood}, ` : ''}{a.city}
                        </div>
                      </div>
                    </button>
                  ))}
                  <button
                    onClick={() => { setShowAddrPicker(false); navigate({ name: 'addresses', params: {} }); }}
                    style={{
                      width: '100%',
                      padding: 12,
                      background: 'transparent',
                      border: '1px dashed #1F8B4C',
                      color: '#1F8B4C',
                      borderRadius: 12,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    + Ajouter une nouvelle adresse
                  </button>
                </div>
              </div>
            )}
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
            <button
              className="yhome-scan-btn"
              onClick={() => setScannerOpen(true)}
              aria-label="Scanner un code-barres"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                <path d="M3 5a2 2 0 0 1 2-2h2"/>
                <path d="M19 3h2a2 2 0 0 1 2 2v2"/>
                <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
                <path d="M5 21H3a2 2 0 0 1-2-2v-2"/>
                <line x1="7" y1="7" x2="7" y2="17"/>
                <line x1="10" y1="7" x2="10" y2="17"/>
                <line x1="13" y1="7" x2="13" y2="17"/>
                <line x1="16" y1="7" x2="16" y2="17"/>
              </svg>
            </button>
          </div>
        </header>

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
                try { localStorage.setItem('yaram_pending_promo', 'BIENVENUE10'); } catch {}
                if (navigator.vibrate) navigator.vibrate(40);
                navigate('/cart');
              }}
            >
              BIENVENUE10
            </button>
            <button className="yhome-coupon-close" onClick={dismissCoupon} aria-label="Fermer">×</button>
          </div>
        )}

        <button
          className="yhome-promo-link"
          onClick={() => navigate({ name: 'promos', params: {} })}
        >
          <div className="yhome-promo-link-icon">🎁</div>
          <div className="yhome-promo-link-text">
            <strong>Bons plans</strong>
            <span>Découvre toutes les promos actives</span>
          </div>
          <div className="yhome-promo-link-arrow">→</div>
        </button>

        {topBrands.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <h2 className="yhome-section-title">Marques</h2>
              <button className="yhome-section-link" onClick={() => navigate('/search')}>Tout voir →</button>
            </div>
            <div className="yhome-brands-row">
              {topBrands.map(brand => (
                <button
                  key={brand.id}
                  className="yhome-brand-item"
                  onClick={() => navigate({ name: 'search', params: { brand: brand.name } })}
                >
                  <div className="yhome-brand-circle">
                    {brand.img ? (
                      <img src={brand.img} alt={`Logo ${brand.name}`} loading="lazy" decoding="async" onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = brand.name.substring(0, 8); }} />
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

        {banners.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-banner-wrap" onClick={() => handleBannerClick(banners[activeBannerIdx])}>
              {banners[activeBannerIdx]?.image_url ? (
                <img
                  src={banners[activeBannerIdx].image_url}
                  alt={banners[activeBannerIdx].title || 'Promo'}
                  className="yhome-banner-img-full"
                />
              ) : (
                <div
                  className="yhome-banner-fallback"
                  style={{
                    background: banners[activeBannerIdx]?.bg_color || '#1F8B4C',
                    color: banners[activeBannerIdx]?.text_color || '#FFFFFF',
                  }}
                >
                  {banners[activeBannerIdx]?.sponsor_name && (
                    <div className="yhome-banner-sponsor">{banners[activeBannerIdx].sponsor_name}</div>
                  )}
                  <div className="yhome-banner-title">{banners[activeBannerIdx]?.title}</div>
                  {banners[activeBannerIdx]?.subtitle && (
                    <div className="yhome-banner-subtitle">{banners[activeBannerIdx].subtitle}</div>
                  )}
                  {banners[activeBannerIdx]?.cta_text && banners[activeBannerIdx]?.link_type !== 'none' && (
                    <button className="yhome-banner-cta">{banners[activeBannerIdx].cta_text} →</button>
                  )}
                </div>
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
                      <img src={cat.icon_url} alt={`Catégorie ${cat.name}`} loading="lazy" decoding="async" onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = cat.name.charAt(0); }} />
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

        {/* ═══ BANNER BOUTIQUE INTERNATIONALE ═══ */}
        <section className="yhome-section">
          <button
            onClick={() => navigate({ name: 'international', params: {} })}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #0066CC 0%, #004999 50%, #002F66 100%)',
              border: 'none',
              borderRadius: 16,
              padding: '18px 18px',
              color: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              boxShadow: '0 6px 18px rgba(0, 102, 204, 0.25)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>🌍</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 3, letterSpacing: -0.3 }}>
                Boutique internationale
              </div>
              <div style={{ fontSize: 12, opacity: 0.92, lineHeight: 1.35 }}>
                Tes marques préférées importées en 15 jours · Acompte 50%
              </div>
            </div>
            <div style={{
              fontSize: 22,
              flexShrink: 0,
              background: 'rgba(255,255,255,0.15)',
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>→</div>
            <div style={{
              position: 'absolute',
              top: -25,
              right: -25,
              width: 90,
              height: 90,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }} />
          </button>
        </section>

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

        {topMatches.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <div>
                <h2 className="yhome-section-title">✨ Pour toi, {firstName}</h2>
                <div className="yhome-section-sub">
                  {latestScan ? `Basé sur ton scan IA · peau ${(skinType || '').toLowerCase()}` : 'Fais ton scan pour des recos perso'}
                </div>
              </div>
              <button className="yhome-section-link" onClick={() => navigate('/search')}>Tout voir →</button>
            </div>
            <div className="yhome-product-grid-2">
              {topMatches.map(p => <ProductTile key={p.id} product={p} />)}
            </div>
          </section>
        )}

        {trending.length > 0 && (
          <section className="yhome-section">
            <div className="yhome-section-head">
              <div>
                <h2 className="yhome-section-title">🔥 Tendances cette semaine</h2>
                <div className="yhome-section-sub">
                  {bestSellers.length > 0 ? 'Les plus commandés' : 'Les plus appréciés'}
                </div>
              </div>
              <button className="yhome-section-link" onClick={() => navigate('/search')}>Tout voir →</button>
            </div>
            <div className="yhome-product-grid-2">
              {trending.map(p => <ProductTile key={p.id} product={p} />)}
            </div>
          </section>
        )}

        <div style={{ height: 40 }} />
      </PullToRefresh>
      </div>

      <TabBar active="home" />

      {scannerOpen && (
        <BarcodeScannerClient
          onProductFound={handleProductFound}
          onCancel={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}
