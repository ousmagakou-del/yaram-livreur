import { useState, useEffect, useMemo } from 'react';
import { useNav } from '../App';
import {
  getAllCategories,
  getAllBrands,
  getProductCategorySlugs,
} from '../lib/supabase';
import { haptic } from '../lib/haptic';
import TabBar from '../components/TabBar';
import './Categories.css';

/* ─────────────────────────────────────────────────────────────
   FEATURED — gros tiles type Sephora / Apple App Store browse
   On mappe sur les slugs reels du catalogue Yaram quand possible.
   ───────────────────────────────────────────────────────────── */
const FEATURED = [
  {
    key: 'pharmacie',
    label: 'Pharmacie',
    slug: 'pharmacie',
    bg: '#FEF3C7',
    fg: '#92400E',
    // pilule
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <path d="M10.5 20.5a7 7 0 0 1-9.9-9.9l9.9-9.9a7 7 0 0 1 9.9 9.9l-9.9 9.9z" />
        <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
      </svg>
    ),
  },
  {
    key: 'beaute',
    label: 'Beauté',
    slug: 'beaute',
    bg: '#FCE7F3',
    fg: '#9D174D',
    // rouge à lèvres
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <path d="M9 4l4-2 4 6-3 2z" />
        <rect x="7" y="10" width="9" height="11" rx="1.5" />
        <line x1="7" y1="14" x2="16" y2="14" />
      </svg>
    ),
  },
  {
    key: 'bebe',
    label: 'Bébé',
    slug: 'bebe',
    bg: '#DBEAFE',
    fg: '#1E40AF',
    // biberon
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <path d="M9 2h6v3H9z" />
        <path d="M8 5h8l-1 4H9z" />
        <rect x="9" y="9" width="6" height="13" rx="2" />
        <line x1="10.5" y1="13" x2="13.5" y2="13" />
        <line x1="10.5" y1="16" x2="13.5" y2="16" />
      </svg>
    ),
  },
  {
    key: 'wellness',
    label: 'Bien-être',
    slug: 'bien-etre',
    bg: '#DCFCE7',
    fg: '#166534',
    // feuille
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <path d="M20 4c-8 0-14 6-14 14 0 .5 0 1 .1 1.5C12 19 18 14 20 4z" />
        <path d="M6 18s4-2 8-6" />
      </svg>
    ),
  },
  {
    key: 'hygiene',
    label: 'Hygiène',
    slug: 'hygiene',
    bg: '#CFFAFE',
    fg: '#155E75',
    // gouttes
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <path d="M12 2s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
        <path d="M9 14a3 3 0 0 0 3 3" />
      </svg>
    ),
  },
  {
    key: 'international',
    label: 'Import',
    slug: 'international',
    bg: '#FEE7DC',
    fg: '#993C1D',
    // globe
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
      </svg>
    ),
  },
];

// Palette douce pour fallback quand la categorie n'a pas de couleurs en base
const SOFT_PALETTE = [
  { bg: '#FEF3C7', fg: '#92400E' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#DBEAFE', fg: '#1E40AF' },
  { bg: '#DCFCE7', fg: '#166534' },
  { bg: '#CFFAFE', fg: '#155E75' },
  { bg: '#FEE7DC', fg: '#993C1D' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#FEF2F2', fg: '#991B1B' },
];

function pickSoft(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SOFT_PALETTE[h % SOFT_PALETTE.length];
}

export default function Categories() {
  const { navigate } = useNav();
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Safety 12s : libère l'UI si une des 3 RPC reste pendante
    const safety = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 12000);
    const load = async () => {
      try {
        const [catData, slugRows, brandData] = await Promise.all([
          getAllCategories(),
          getProductCategorySlugs(),
          getAllBrands(),
        ]);
        if (cancelled) return;

        const c = {};
        (slugRows || []).forEach((row) => {
          if (row.category) c[row.category] = (c[row.category] || 0) + 1;
        });
        setCounts(c);

        if (catData && catData.length) {
          setCategories(catData);
        } else {
          // fallback : reconstitue depuis les slugs
          const map = {};
          (slugRows || []).forEach((row) => {
            const cat = row.category;
            if (!cat) return;
            if (!map[cat]) {
              map[cat] = {
                id: cat,
                slug: cat,
                name: cat.charAt(0).toUpperCase() + cat.slice(1),
              };
            }
          });
          setCategories(
            Object.values(map).sort(
              (a, b) => (c[b.slug] || 0) - (c[a.slug] || 0),
            ),
          );
        }

        setBrands(brandData || []);
      } catch (e) {
        console.error('Categories load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(safety);
      }
    };
    load();

    const handleRouteBack = (e) => {
      const target = e?.detail?.to?.name;
      if (target && target !== 'categories') return;
      load();
    };
    window.addEventListener('yaram-route-back', handleRouteBack);
    return () => {
      cancelled = true;
      clearTimeout(safety);
      window.removeEventListener('yaram-route-back', handleRouteBack);
    };
  }, []);

  // Featured tiles enrichies avec le count reel
  const featuredTiles = useMemo(
    () =>
      FEATURED.map((f) => ({
        ...f,
        count: counts[f.slug] || 0,
      })),
    [counts],
  );

  const goToSearch = (params) => {
    haptic('light');
    navigate({ name: 'search', params });
  };

  const onSearchClick = () => {
    haptic('light');
    navigate({ name: 'search', params: query ? { q: query } : {} });
  };

  return (
    <div className="ycat-screen page-anim">
      <div className="ycat-scroll">
        {/* ─── HEADER STICKY ─── */}
        <header className="ycat-header">
          <div className="ycat-header-top">
            <button
              className="ycat-back-btn"
              onClick={() => {
                haptic('light');
                navigate(-1);
              }}
              aria-label="Retour"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <h1>Catégories</h1>
            <div className="ycat-header-spacer" />
          </div>

          <button
            type="button"
            className="ycat-searchbar"
            onClick={onSearchClick}
            aria-label="Rechercher un produit"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Rechercher un produit, une marque…</span>
          </button>
        </header>

        {/* ─── HERO FEATURED ─── */}
        <section className="ycat-section">
          <div className="ycat-section-head">
            <h2>À la une</h2>
            <span className="ycat-section-sub">Nos univers populaires</span>
          </div>

          {loading ? (
            <div className="ycat-hero-row">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="ycat-hero-card ycat-skel" style={{ animationDelay: `${i * 60}ms` }} />
              ))}
            </div>
          ) : (
            <div className="ycat-hero-row">
              {featuredTiles.map((f, i) => (
                <button
                  key={f.key}
                  className="ycat-hero-card"
                  style={{
                    background: f.bg,
                    color: f.fg,
                    animationDelay: `${i * 40}ms`,
                  }}
                  onClick={() => goToSearch({ category: f.slug })}
                >
                  <div className="ycat-hero-icon" style={{ color: f.fg }}>
                    {f.icon}
                  </div>
                  <div className="ycat-hero-name">{f.label}</div>
                  <div className="ycat-hero-count">
                    {f.count > 0 ? `${f.count} produit${f.count > 1 ? 's' : ''}` : 'À découvrir'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ─── TOUTES LES CATÉGORIES (grille 2 col) ─── */}
        <section className="ycat-section">
          <div className="ycat-section-head">
            <h2>Toutes les catégories</h2>
          </div>

          {loading ? (
            <div className="ycat-grid2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="ycat-row-skel ycat-skel" style={{ animationDelay: `${i * 50}ms` }} />
              ))}
            </div>
          ) : categories.length === 0 ? (
            <div className="ycat-empty">
              <p>Aucune catégorie pour l'instant</p>
            </div>
          ) : (
            <div className="ycat-grid2">
              {categories.map((cat, i) => {
                const palette =
                  cat.bg_color && cat.text_color
                    ? { bg: cat.bg_color, fg: cat.text_color }
                    : pickSoft(cat.slug || cat.name);
                const cnt = counts[cat.slug] || cat.product_count || 0;
                return (
                  <button
                    key={cat.id || cat.slug}
                    className="ycat-row"
                    style={{ animationDelay: `${Math.min(i * 35, 480)}ms` }}
                    onClick={() => goToSearch({ category: cat.slug })}
                  >
                    <div
                      className="ycat-row-icon"
                      style={{ background: palette.bg, color: palette.fg }}
                    >
                      {cat.icon_url ? (
                        <img
                          src={cat.icon_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span>{(cat.name || '?').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="ycat-row-text">
                      <div className="ycat-row-name">{cat.name}</div>
                      {cnt > 0 && (
                        <div className="ycat-row-sub">
                          {cnt} produit{cnt > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                    <svg className="ycat-row-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ─── MARQUES POPULAIRES ─── */}
        {(loading || brands.length > 0) && (
          <section className="ycat-section">
            <div className="ycat-section-head">
              <h2>Marques populaires</h2>
              <span className="ycat-section-sub">{brands.length > 0 ? `${brands.length} marques` : ''}</span>
            </div>

            {loading ? (
              <div className="ycat-brand-row">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="ycat-brand-card ycat-skel" style={{ animationDelay: `${i * 50}ms` }} />
                ))}
              </div>
            ) : (
              <div className="ycat-brand-row">
                {brands.slice(0, 20).map((b, i) => (
                  <button
                    key={b.id || b.name}
                    className="ycat-brand-card"
                    style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                    onClick={() => goToSearch({ brand: b.name })}
                  >
                    <div className="ycat-brand-logo">
                      {b.logo_url || b.logo ? (
                        <img
                          src={b.logo_url || b.logo}
                          alt={b.name}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <span>{(b.name || '?').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="ycat-brand-name">{b.name}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <div style={{ height: 40 }} />
      </div>

      <TabBar active="home" />
    </div>
  );
}
