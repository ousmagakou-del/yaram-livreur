import { useState, useEffect, useMemo } from 'react';
import { useNav } from '../App';
import { getAllProducts, getAllBrands } from '../lib/supabase';
import ProductTile from '../components/ProductTile';
import TabBar from '../components/TabBar';
import { usePageSEO } from '../lib/seo';
import './Search.css';

const RECENT = ['niacinamide', 'spf peau noire', 'karité', 'sérum vitamine c'];
const SUGGESTIONS = ['Beurre de karité', 'SPF sans voile blanc', 'Anti-taches', 'Huile de baobab'];

const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommandés', icon: '✨' },
  { id: 'score-desc', label: 'Meilleur score', icon: '⭐' },
  { id: 'price-asc', label: 'Prix croissant', icon: '⬆️' },
  { id: 'price-desc', label: 'Prix décroissant', icon: '⬇️' },
  { id: 'reviews', label: 'Plus populaires', icon: '🔥' },
];

const SCORE_RANGES = [
  { id: 'all', label: 'Tous', min: 0 },
  { id: 'excellent', label: '85+ Excellent', min: 85 },
  { id: 'good', label: '70+ Bon', min: 70 },
  { id: 'medium', label: '50+ Moyen', min: 50 },
];

const PRICE_RANGES = [
  { id: 'all', label: 'Tous prix', min: 0, max: Infinity },
  { id: 'eco', label: 'Moins de 5 000', min: 0, max: 5000 },
  { id: 'low', label: '5 000 - 10 000', min: 5000, max: 10000 },
  { id: 'mid', label: '10 000 - 20 000', min: 10000, max: 20000 },
  { id: 'high', label: 'Plus de 20 000', min: 20000, max: Infinity },
];

const COMMON_BADGES = ['Made in Sénégal', 'Bio', 'Vegan', 'Sans parfum', 'Sans alcool', 'Recommandé dermato'];

const CAT_LABELS = {
  visage: 'Visage',
  serum: 'Sérums', solaire: 'Solaires', nettoyant: 'Nettoyants',
  hydratant: 'Hydratants', masque: 'Masques', corps: 'Corps',
  levres: 'Lèvres', maquillage: 'Maquillage', cheveux: 'Cheveux', huile: 'Huiles',
  hygiene: 'Hygiène', bebe: 'Bébé', bouche: 'Bouche', complement: 'Compléments',
  parfum: 'Parfums', pieds_mains: 'Pieds & Mains', intime: 'Intime', deodorants: 'Déodorants',
};

function catLabel(cat) {
  if (!cat) return '';
  return CAT_LABELS[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
}

export default function Search({ initialCategory, initialBrand }) {
  const { navigate } = useNav();

  // Title/desc dynamique selon le filtre actif (utile pour SEO et partages)
  const seoTitle = initialBrand
    ? `${initialBrand} — Produits beauté · YARAM`
    : initialCategory
      ? `${catLabel(initialCategory)} — Produits beauté · YARAM`
      : 'Recherche · YARAM';
  const seoDesc = initialBrand
    ? `Tous les produits ${initialBrand} adaptés à la peau africaine, validés par YARAM`
    : initialCategory
      ? `${catLabel(initialCategory)} pour ta peau africaine · 800+ références validées par dermato · Livraison Dakar`
      : 'Recherche produits beauté validés par YARAM · Filtres par marque, prix, score, badges';
  usePageSEO({ title: seoTitle, description: seoDesc });
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(initialCategory || null);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const [sort, setSort] = useState('recommended');
  const [selectedBrands, setSelectedBrands] = useState(initialBrand ? [initialBrand] : []);
  const [scoreRange, setScoreRange] = useState('all');
  const [priceRange, setPriceRange] = useState('all');
  const [selectedBadges, setSelectedBadges] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, b] = await Promise.all([getAllProducts(), getAllBrands()]);
        if (cancelled) return;
        setProducts(p || []);
        setBrands(b || []);
      } catch (e) {
        console.error('Search load error:', e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Si initialBrand change (navigation depuis Home), on met à jour
  useEffect(() => {
    if (initialBrand && !selectedBrands.includes(initialBrand)) {
      setSelectedBrands([initialBrand]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBrand]);

  useEffect(() => {
    if (initialCategory && category !== initialCategory) {
      setCategory(initialCategory);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategory]);

  const filtered = useMemo(() => {
    let list = [...products];
    if (category) list = list.filter(p => p.category === category);
    if (q.trim() !== '') {
      const s = q.toLowerCase();
      list = list.filter(p =>
        p.name?.toLowerCase().includes(s) ||
        p.brand?.toLowerCase().includes(s) ||
        p.category?.toLowerCase().includes(s)
      );
    }
    if (selectedBrands.length > 0) list = list.filter(p => selectedBrands.includes(p.brand));
    const sr = SCORE_RANGES.find(r => r.id === scoreRange);
    if (sr && sr.min > 0) list = list.filter(p => p.score >= sr.min);
    const pr = PRICE_RANGES.find(r => r.id === priceRange);
    if (pr && pr.id !== 'all') list = list.filter(p => p.price >= pr.min && p.price < pr.max);
    if (selectedBadges.length > 0) list = list.filter(p => selectedBadges.every(b => p.badges?.includes(b)));
    if (sort === 'score-desc') list.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else if (sort === 'reviews') list.sort((a, b) => (b.review_count || 0) - (a.review_count || 0));
    return list;
  }, [products, category, q, selectedBrands, scoreRange, priceRange, selectedBadges, sort]);

  const activeFiltersCount =
    selectedBrands.length +
    (scoreRange !== 'all' ? 1 : 0) +
    (priceRange !== 'all' ? 1 : 0) +
    selectedBadges.length +
    (sort !== 'recommended' ? 1 : 0);

  const resetFilters = () => {
    setSort('recommended');
    setSelectedBrands([]);
    setScoreRange('all');
    setPriceRange('all');
    setSelectedBadges([]);
  };

  const toggleBrand = (b) => setSelectedBrands(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);
  const toggleBadge = (b) => setSelectedBadges(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);

  return (
    <div className="search-screen page-anim">
      <div className="search-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="search-input-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            autoFocus={!category && !initialBrand}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={category ? `Filtrer dans ${catLabel(category)}...` : initialBrand ? `Filtrer dans ${initialBrand}...` : "Produit, marque, ingrédient..."}
          />
          {q && <button onClick={() => setQ('')} className="search-clear">×</button>}
        </div>
        <button
          className={`search-filter-btn ${activeFiltersCount > 0 ? 'has-active' : ''}`}
          onClick={() => setShowFilters(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <line x1="4" y1="21" x2="4" y2="14"/>
            <line x1="4" y1="10" x2="4" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12" y2="3"/>
            <line x1="20" y1="21" x2="20" y2="16"/>
            <line x1="20" y1="12" x2="20" y2="3"/>
            <line x1="1" y1="14" x2="7" y2="14"/>
            <line x1="9" y1="8" x2="15" y2="8"/>
            <line x1="17" y1="16" x2="23" y2="16"/>
          </svg>
          {activeFiltersCount > 0 && <span className="search-filter-badge">{activeFiltersCount}</span>}
        </button>
      </div>

      {(category || activeFiltersCount > 0) && (
        <div className="search-cat-bar">
          {category && (
            <span className="search-cat-chip">
              📁 {catLabel(category)}
              <button onClick={() => setCategory(null)}>×</button>
            </span>
          )}
          {sort !== 'recommended' && (
            <span className="search-cat-chip alt">
              {SORT_OPTIONS.find(s => s.id === sort)?.label}
              <button onClick={() => setSort('recommended')}>×</button>
            </span>
          )}
          {scoreRange !== 'all' && (
            <span className="search-cat-chip alt">
              Score {SCORE_RANGES.find(s => s.id === scoreRange)?.label}
              <button onClick={() => setScoreRange('all')}>×</button>
            </span>
          )}
          {priceRange !== 'all' && (
            <span className="search-cat-chip alt">
              {PRICE_RANGES.find(p => p.id === priceRange)?.label}
              <button onClick={() => setPriceRange('all')}>×</button>
            </span>
          )}
          {selectedBrands.map(b => (
            <span key={b} className="search-cat-chip alt">
              🏷️ {b}
              <button onClick={() => toggleBrand(b)}>×</button>
            </span>
          ))}
          {selectedBadges.map(b => (
            <span key={b} className="search-cat-chip alt">
              {b}
              <button onClick={() => toggleBadge(b)}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="search-scroll">
        {category || q.trim() !== '' || activeFiltersCount > 0 ? (
          loading ? (
            <SearchSkeleton />
          ) : filtered.length === 0 ? (
            <div className="search-empty">
              <div style={{fontSize: 48}}>🔍</div>
              <p>Aucun produit avec ces critères</p>
              <button className="btn-primary" onClick={() => { resetFilters(); setCategory(null); setQ(''); }} style={{maxWidth: 240, marginTop: 16}}>
                Réinitialiser →
              </button>
            </div>
          ) : (
            <div className="search-results">
              <div className="search-count">
                <strong>{filtered.length}</strong> produit{filtered.length > 1 ? 's' : ''}
                {category ? ` dans ${catLabel(category)}` : ''}
                {selectedBrands.length === 1 && !category ? ` chez ${selectedBrands[0]}` : ''}
              </div>
              <div className="search-product-grid-2">
                {filtered.map(p => <ProductTile key={p.id} product={p} />)}
              </div>
            </div>
          )
        ) : (
          <>
            <div className="search-section">
              <h3 className="search-section-title">Recherches récentes</h3>
              <div className="search-tags">
                {RECENT.map(r => (
                  <button key={r} className="search-tag" onClick={() => setQ(r)}>{r}</button>
                ))}
              </div>
            </div>
            <div className="search-section">
              <h3 className="search-section-title">Suggestions</h3>
              <div className="search-tags">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="search-tag suggestion" onClick={() => setQ(s)}>{s}</button>
                ))}
              </div>
            </div>
          </>
        )}
        <div style={{ height: 30 }} />
      </div>

      {showFilters && (
        <FiltersModal
          sort={sort} setSort={setSort}
          selectedBrands={selectedBrands} toggleBrand={toggleBrand}
          scoreRange={scoreRange} setScoreRange={setScoreRange}
          priceRange={priceRange} setPriceRange={setPriceRange}
          selectedBadges={selectedBadges} toggleBadge={toggleBadge}
          brands={brands}
          onClose={() => setShowFilters(false)}
          onReset={resetFilters}
          resultCount={filtered.length}
        />
      )}

      <TabBar active="search" />
    </div>
  );
}

// Skeleton qui mime une grille 2-col de ProductTile pendant le chargement.
// Reduit la sensation de "page vide" pendant le fetch des 800 produits.
function SearchSkeleton() {
  const sk = {
    background: 'linear-gradient(90deg, #F4F4F2 0%, #EAEAE7 50%, #F4F4F2 100%)',
    backgroundSize: '200% 100%',
    animation: 'yaramShimmer 1.4s ease-in-out infinite',
    borderRadius: 8,
  };
  return (
    <div className="search-results">
      <style>{`@keyframes yaramShimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div style={{ ...sk, width: 120, height: 14, marginBottom: 14 }} />
      <div className="search-product-grid-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="product-tile" style={{ pointerEvents: 'none' }}>
            <div className="pt-img-wrap">
              <div style={{ ...sk, width: '100%', aspectRatio: '1/1', borderRadius: 8 }} />
            </div>
            <div className="pt-info">
              <div style={{ ...sk, width: '50%', height: 10, marginBottom: 6 }} />
              <div style={{ ...sk, width: '90%', height: 12, marginBottom: 8 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ ...sk, width: 60, height: 14 }} />
                <div style={{ ...sk, width: 32, height: 14 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FiltersModal({
  sort, setSort,
  selectedBrands, toggleBrand,
  scoreRange, setScoreRange,
  priceRange, setPriceRange,
  selectedBadges, toggleBadge,
  brands, onClose, onReset, resultCount,
}) {
  return (
    <div className="filters-backdrop" onClick={onClose}>
      <div className="filters-modal" onClick={e => e.stopPropagation()}>
        <div className="filters-head">
          <h2>Filtres</h2>
          <button onClick={onClose}>×</button>
        </div>

        <div className="filters-body">
          <div className="filters-section">
            <h3>Trier par</h3>
            <div className="filters-options">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  className={`filters-opt ${sort === opt.id ? 'active' : ''}`}
                  onClick={() => setSort(opt.id)}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filters-section">
            <h3>Score minimum</h3>
            <div className="filters-options">
              {SCORE_RANGES.map(r => (
                <button
                  key={r.id}
                  className={`filters-opt ${scoreRange === r.id ? 'active' : ''}`}
                  onClick={() => setScoreRange(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filters-section">
            <h3>Fourchette de prix</h3>
            <div className="filters-options">
              {PRICE_RANGES.map(r => (
                <button
                  key={r.id}
                  className={`filters-opt ${priceRange === r.id ? 'active' : ''}`}
                  onClick={() => setPriceRange(r.id)}
                >
                  {r.label} {r.id !== 'all' && 'FCFA'}
                </button>
              ))}
            </div>
          </div>

          {brands.length > 0 && (
            <div className="filters-section">
              <h3>Marques ({brands.length})</h3>
              <div className="filters-options">
                {brands.map(b => (
                  <button
                    key={b.id}
                    className={`filters-opt ${selectedBrands.includes(b.name) ? 'active' : ''}`}
                    onClick={() => toggleBrand(b.name)}
                  >
                    {b.local && '🇸🇳 '}{b.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="filters-section">
            <h3>Badges</h3>
            <div className="filters-options">
              {COMMON_BADGES.map(b => (
                <button
                  key={b}
                  className={`filters-opt ${selectedBadges.includes(b) ? 'active' : ''}`}
                  onClick={() => toggleBadge(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="filters-foot">
          <button className="filters-reset" onClick={onReset}>Réinitialiser</button>
          <button className="btn-primary" onClick={onClose}>
            Voir {resultCount} produit{resultCount > 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
