import { useState, useEffect, useMemo, useRef } from 'react';
import { useNav } from '../App';
import { supabase, isFavorite, toggleFavorite } from '../lib/supabase';
import { getUserPosition, haversineDistance, formatDistance } from '../lib/geo';
import { haptic } from '../lib/haptic';
import ProductTile from '../components/ProductTile';
import './PharmacyDetail.css';

const FALLBACK_AVATAR = null; // on bascule sur initiale si pas de logo

// ──────────────────────────────────────────────────
// Helpers horaires : déduit ouvert/fermé et "Ouvre à HHh"
// pharmacy.hours peut être une string libre, on extrait heuristique.
// ──────────────────────────────────────────────────
function parseHoursStatus(hoursStr) {
  if (!hoursStr || typeof hoursStr !== 'string') {
    return { open: null, label: '', next: '' };
  }
  // cherche 2 horaires HH:MM ou HHh ou HH-HH
  const m = hoursStr.match(/(\d{1,2})(?:[h:](\d{2}))?\s*[-–à]\s*(\d{1,2})(?:[h:](\d{2}))?/);
  if (!m) return { open: null, label: hoursStr, next: '' };
  const oh = parseInt(m[1], 10);
  const om = parseInt(m[2] || '0', 10);
  const ch = parseInt(m[3], 10);
  const cm = parseInt(m[4] || '0', 10);
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  const open = cur >= openMin && cur < closeMin;
  let next = '';
  if (open) {
    next = `Ferme à ${String(ch).padStart(2, '0')}h${cm ? String(cm).padStart(2, '0') : ''}`;
  } else if (cur < openMin) {
    next = `Ouvre à ${String(oh).padStart(2, '0')}h${om ? String(om).padStart(2, '0') : ''}`;
  } else {
    next = `Ouvre demain à ${String(oh).padStart(2, '0')}h`;
  }
  return { open, label: hoursStr, next };
}

// ──────────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────────
export default function PharmacyDetail({ pharmacyId }) {
  const { navigate } = useNav();
  const [pharmacy, setPharmacy] = useState(null);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [fav, setFav] = useState(false);
  const [userPos, setUserPos] = useState(null);
  const [activeCat, setActiveCat] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');
  const rootRef = useRef(null);
  const heroImgRef = useRef(null);

  // ── Chargement pharmacie + produits + reviews ────
  // PROD HARDENING : si pharmacyId absent au mount → on coupe le loader tout de
  // suite (l'écran "Pharmacie introuvable" apparait au lieu d'un spinner infini).
  // Safety timeout 12s : si une requête hang malgré le customFetch timeout (cas
  // rare : Service Worker bug, AbortController qui ne fire pas sur certains
  // proxies LTE Sénégal), on rend la main à l'UI plutôt que de pourrir l'expé.
  useEffect(() => {
    if (!pharmacyId) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    const safety = setTimeout(() => {
      if (cancelled) return;
      console.warn('[PharmacyDetail] safety timeout 12s — release UI');
      setLoading(false);
      setLoadError(true);
    }, 12000);

    (async () => {
      try {
        // .maybeSingle() : retourne {data:null} si 0 rows AU LIEU de {error:PGRST116}.
        // Évite que le warn 0-row pollue Sentry et clarifie le path "pharmacie inactive".
        const { data: ph, error: phErr } = await supabase
          .from('pharmacies')
          .select('id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, hours, delivery_hours, logo, cover, description, active, rating, review_count')
          .eq('id', pharmacyId).maybeSingle();
        if (cancelled) return;
        if (phErr) {
          console.warn('[PharmacyDetail] pharmacy fetch error:', phErr.message);
        }
        setPharmacy(ph || null);

        // Si pas de pharmacie → on arrête le flow (loading off, error true).
        // Inutile d'aller chercher l'inventaire / les avis.
        if (!ph) {
          setLoadError(true);
          return;
        }

        const { data: inv, error: invErr } = await supabase
          .from('inventory').select('product_id, stock, products(*)')
          .eq('pharmacy_id', pharmacyId).gt('stock', 0).eq('active', true);
        if (cancelled) return;
        if (invErr) console.warn('[PharmacyDetail] inventory error:', invErr.message);

        const list = [];
        (inv || []).forEach(i => {
          if (i.products && i.products.id) list.push({ ...i.products, stock: i.stock });
        });
        setProducts(list);

        // Reviews : best-effort. La table publique est `reviews` (par produit),
        // pas `pharmacy_reviews` (n'existe pas en DB). On laisse la liste vide
        // proprement plutôt que de logger un 42P01 dans Sentry à chaque vue.
        if (!cancelled) setReviews([]);
      } catch (e) {
        console.warn('[PharmacyDetail] load failed:', e?.message);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(safety);
      }
    })();
    return () => { cancelled = true; clearTimeout(safety); };
  }, [pharmacyId, reloadKey]);

  // ── Géolocalisation utilisateur (silencieuse) ────
  useEffect(() => {
    let cancelled = false;
    getUserPosition().then(pos => {
      if (!cancelled && pos) setUserPos(pos);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Favori pharmacie (réutilise la même API) ─────
  useEffect(() => {
    if (!pharmacyId) return;
    let cancelled = false;
    isFavorite(`pharmacy_${pharmacyId}`).then(v => {
      if (!cancelled) setFav(v);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pharmacyId]);

  // ── Scroll listener : header glass + parallax ────
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const y = el.scrollTop;
        setScrolled(y > 80);
        if (heroImgRef.current) {
          // parallax léger : on déplace l'image -30% max
          const max = 60;
          const dy = Math.max(-max, -Math.min(y * 0.3, max));
          heroImgRef.current.style.transform = `translate3d(0, ${dy}px, 0) scale(${1 + Math.min(y, 200) / 1500})`;
        }
        raf = 0;
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [pharmacy]);

  // ── Catégories dérivées des produits ─────────────
  const categories = useMemo(() => {
    const set = new Set();
    products.forEach(p => { if (p.category) set.add(p.category); });
    return ['all', ...Array.from(set).slice(0, 12)];
  }, [products]);

  // ── Distance affichée si user géolocalisé ────────
  const distanceLabel = useMemo(() => {
    if (!userPos || !pharmacy?.lat || !pharmacy?.lng) return '';
    const km = haversineDistance(userPos.lat, userPos.lng, pharmacy.lat, pharmacy.lng);
    return formatDistance(km);
  }, [userPos, pharmacy]);

  // ── Status horaires ──────────────────────────────
  const status = useMemo(() => parseHoursStatus(pharmacy?.hours), [pharmacy?.hours]);

  // ── Liste filtrée ────────────────────────────────
  const filteredProducts = useMemo(() => {
    let list = products;
    if (activeCat !== 'all') list = list.filter(p => p.category === activeCat);
    if (activeFilter === 'promo') list = list.filter(p => p.promo || p.discount > 0 || p.old_price);
    else if (activeFilter === 'new') list = list.filter(p => p.is_new || p.created_at);
    else if (activeFilter === 'top') list = list.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return list;
  }, [products, activeCat, activeFilter]);

  // ── Handlers ─────────────────────────────────────
  const onBack = () => { haptic('light'); navigate(-1); };
  const onToggleFav = async () => {
    haptic('light');
    try {
      const v = await toggleFavorite(`pharmacy_${pharmacyId}`);
      setFav(v);
    } catch (_) {}
  };
  const onShare = async () => {
    haptic('light');
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try { await navigator.share({ title: pharmacy?.name, text: pharmacy?.tagline || '', url }); } catch (_) {}
    } else if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(url); } catch (_) {}
    }
  };

  // ─────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="pd-loading-full">
        <div className="pd-spinner" />
        <div>Chargement de la pharmacie…</div>
      </div>
    );
  }

  if (!pharmacy) {
    // Distinction prod : (a) chargement KO → bouton retry ; (b) row inexistant → retour.
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ fontSize: 16, marginBottom: 8 }}>
          {loadError ? 'Impossible de charger cette pharmacie' : 'Pharmacie introuvable'}
        </p>
        {loadError && (
          <p style={{ fontSize: 13, color: '#8B8B8B', marginBottom: 20 }}>
            Vérifie ta connexion puis réessaye.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          {loadError && (
            <button
              onClick={() => { setReloadKey(k => k + 1); }}
              style={{ padding: '10px 20px', background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
            >
              Réessayer
            </button>
          )}
          <button
            onClick={() => navigate(-1)}
            style={{ padding: '10px 20px', background: loadError ? '#F4F4F2' : '#1F8B4C', color: loadError ? '#222' : 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
          >
            ← Retour
          </button>
        </div>
      </div>
    );
  }

  const phone = pharmacy.phone?.replace(/\s/g, '') || '';
  const whatsapp = pharmacy.whatsapp?.replace(/\s|\+/g, '') || '';
  const waMessage = `Bonjour ${pharmacy.name} 👋\n\nJe vous écris depuis YARAM.\n\nMerci 💚`;
  const initial = (pharmacy.name || 'P').trim().charAt(0).toUpperCase();

  return (
    <div className="pd-root" ref={rootRef}>

      {/* ─── HEADER (transparent → glass) ─── */}
      <header className={`pd-header ${scrolled ? 'scrolled' : ''}`}>
        <button className="pd-iconbtn" onClick={onBack} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="pd-header-title">{pharmacy.name}</div>
        <div className="pd-header-right">
          <button className={`pd-iconbtn fav ${fav ? 'active' : ''}`} onClick={onToggleFav} aria-label="Favori">
            <svg viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </button>
          <button className="pd-iconbtn" onClick={onShare} aria-label="Partager">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      </header>

      {/* ─── HERO ─── */}
      <div className="pd-hero">
        {pharmacy.cover ? (
          <img
            ref={heroImgRef}
            className="pd-hero-img"
            src={pharmacy.cover}
            alt={`${pharmacy.name} — ${pharmacy.city || ''}`}
            loading="eager"
            decoding="async"
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : null}
      </div>

      {/* ─── INFO BLOCK (avatar overlap + nom + badges) ─── */}
      <div className="pd-infoblock">
        <div className="pd-avatar-wrap">
          {pharmacy.logo ? (
            <img className="pd-avatar" src={pharmacy.logo} alt={pharmacy.name} loading="lazy" decoding="async" onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            <div className="pd-avatar-fallback">{initial}</div>
          )}
        </div>
        <div className="pd-info-top">
          <h1 className="pd-name">{pharmacy.name}</h1>
          <div className="pd-meta">
            {pharmacy.rating > 0 && (
              <span className="pd-rating">
                <span className="star">★</span>
                {Number(pharmacy.rating).toFixed(1)}
                {pharmacy.review_count > 0 && <span style={{ color: '#8B8B8B', fontWeight: 500 }}>({pharmacy.review_count})</span>}
              </span>
            )}
            {pharmacy.rating > 0 && (pharmacy.neighborhood || pharmacy.city) && <span className="pd-meta-dot">·</span>}
            <span>{pharmacy.neighborhood ? `${pharmacy.neighborhood}, ` : ''}{pharmacy.city}</span>
          </div>
          {(pharmacy.tagline || pharmacy.description) && (
            <p className="pd-tagline">{pharmacy.tagline || pharmacy.description}</p>
          )}
          <div className="pd-badges">
            {status.open === true && (
              <span className="pd-badge open"><span className="dot" />Ouvert maintenant</span>
            )}
            {status.open === false && (
              <span className="pd-badge closed"><span className="dot" />Fermé</span>
            )}
            {pharmacy.delivery_hours && (
              <span className="pd-badge delivery">🛵 Livraison 24h</span>
            )}
            {pharmacy.rating >= 4.5 && (
              <span className="pd-badge top">⭐ Top vendeur</span>
            )}
          </div>
        </div>
      </div>

      {/* ─── INFOS ESSENTIELLES (3 mini cards) ─── */}
      <div className="pd-quick">
        <a
          href={pharmacy.lat && pharmacy.lng ? `https://www.google.com/maps/search/?api=1&query=${pharmacy.lat},${pharmacy.lng}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="pd-quick-card"
        >
          <span className="pd-quick-ico">📍</span>
          <span className="pd-quick-label">Distance</span>
          <span className="pd-quick-value">{distanceLabel || (pharmacy.city || '—')}</span>
        </a>
        <div className="pd-quick-card" style={{ cursor: 'default' }}>
          <span className="pd-quick-ico">🕒</span>
          <span className="pd-quick-label">Horaires</span>
          <span className="pd-quick-value">{status.next || pharmacy.hours || '—'}</span>
        </div>
        <a
          href={phone ? `tel:${phone}` : '#'}
          className="pd-quick-card"
          onClick={(e) => { if (!phone) e.preventDefault(); }}
        >
          <span className="pd-quick-ico">📞</span>
          <span className="pd-quick-label">Téléphone</span>
          <span className="pd-quick-value">{pharmacy.phone || '—'}</span>
        </a>
      </div>

      {/* ─── STICKY CTA WHATSAPP ─── */}
      {whatsapp && (
        <div className="pd-sticky-cta">
          <a
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(waMessage)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="pd-wa-btn"
            onClick={() => haptic('light')}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.52 3.48A12 12 0 0 0 3.48 20.52l-1.2 4.38 4.5-1.18A12 12 0 1 0 20.52 3.48ZM12 21.4a9.4 9.4 0 0 1-4.78-1.3l-.34-.2-2.68.7.72-2.6-.22-.36A9.4 9.4 0 1 1 12 21.4Zm5.16-7.04c-.28-.14-1.66-.82-1.92-.92-.26-.1-.44-.14-.62.14-.18.28-.72.92-.88 1.1-.16.18-.32.2-.6.06-.28-.14-1.18-.44-2.24-1.38-.84-.74-1.4-1.66-1.56-1.94-.16-.28-.02-.42.12-.56.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.1-.18.04-.34-.02-.48-.06-.14-.62-1.5-.86-2.06-.22-.54-.46-.46-.62-.46-.16-.02-.34-.02-.52-.02-.18 0-.48.06-.74.34-.26.28-.96.94-.96 2.3 0 1.36.98 2.68 1.12 2.86.14.18 1.94 2.96 4.7 4.14.66.28 1.18.46 1.58.58.66.2 1.26.18 1.74.1.52-.08 1.66-.68 1.9-1.34.24-.66.24-1.22.16-1.34-.06-.12-.24-.18-.52-.32Z"/>
            </svg>
            Contacter sur WhatsApp
          </a>
        </div>
      )}

      {/* ─── CATÉGORIES (chips) ─── */}
      {categories.length > 1 && (
        <>
          <div className="pd-section">
            <div className="pd-section-title">Catégories</div>
          </div>
          <div className="pd-cats">
            {categories.map(cat => (
              <button
                key={cat}
                className={`pd-chip ${activeCat === cat ? 'active' : ''}`}
                onClick={() => { haptic('light'); setActiveCat(cat); }}
              >
                {cat === 'all' ? 'Toutes' : cat}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ─── FILTRES PRODUITS ─── */}
      <div className="pd-section">
        <div className="pd-section-title">Produits ({filteredProducts.length})</div>
      </div>
      <div className="pd-filters">
        {[
          { k: 'all', l: 'Tous' },
          { k: 'promo', l: '🏷️ Promos' },
          { k: 'new', l: '✨ Nouveautés' },
          { k: 'top', l: '🔥 Top vendus' },
        ].map(f => (
          <button
            key={f.k}
            className={`pd-filter ${activeFilter === f.k ? 'active' : ''}`}
            onClick={() => { haptic('light'); setActiveFilter(f.k); }}
          >
            {f.l}
          </button>
        ))}
      </div>

      {/* ─── GRID PRODUITS ─── */}
      <div className="pd-products-wrap">
        {filteredProducts.length === 0 ? (
          <div className="pd-empty">Aucun produit pour ce filtre</div>
        ) : (
          <div className="pd-grid">
            {filteredProducts.map((p, idx) => (
              <div
                key={p.id || idx}
                className="pd-tile-anim"
                style={{ animationDelay: `${Math.min(idx, 12) * 40}ms` }}
              >
                <ProductTile product={p} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── AVIS CLIENTS ─── */}
      {reviews.length > 0 && (
        <>
          <div className="pd-section" style={{ marginTop: 24 }}>
            <div className="pd-section-title">Avis clients</div>
          </div>
          <div className="pd-reviews">
            {reviews.map(r => (
              <div key={r.id} className="pd-review-card">
                <div className="pd-review-head">
                  <span className="pd-review-name">{r.name || 'Client'}</span>
                  <span className="pd-review-stars">{'★'.repeat(Math.round(r.rating || 0))}</span>
                </div>
                <div className="pd-review-text">{r.comment}</div>
              </div>
            ))}
            {pharmacy.review_count > reviews.length && (
              <a className="pd-review-more" href="#" onClick={(e) => e.preventDefault()}>
                Voir tous les avis ({pharmacy.review_count})
              </a>
            )}
          </div>
        </>
      )}

      {/* ─── STICKY BOTTOM (ouvert/fermé) ─── */}
      <div className="pd-bottombar">
        <span className={`dot ${status.open ? 'open' : 'closed'}`} />
        <div style={{ flex: 1 }}>
          <div className="pd-bottombar-status">
            {status.open === true ? 'Ouvert maintenant' : status.open === false ? 'Fermé' : (pharmacy.hours ? 'Horaires' : 'Pharmacie')}
          </div>
          {status.next && <div className="pd-bottombar-hours">{status.next}</div>}
        </div>
        {phone && (
          <a
            href={`tel:${phone}`}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: '#1F8B4C',
              color: 'white',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Appeler
          </a>
        )}
      </div>
    </div>
  );
}
