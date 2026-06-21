import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNav } from '../App';
import { getAllProducts, getAllBrands, getAllCategories } from '../lib/supabase';
import ProductTile from '../components/ProductTile';
import TabBar from '../components/TabBar';
import { usePageSEO, useJsonLd } from '../lib/seo';
import './Search.css';

// ─── Constantes ────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'yaram-search-history';
const HISTORY_MAX = 8;
const DEBOUNCE_MS = 200;
const STAGGER_MS = 30;

const POPULAR_SUGGESTIONS = [
  'Sérum vitamine C',
  'Crème hydratante',
  'Bioderma',
  'La Roche-Posay',
  'Avène',
  'Crème solaire',
  'Rouge à lèvres',
  'Crème bébé',
];

// Marques tendance — affichées en grid avec logo
const TRENDING_BRANDS = [
  'Bioderma', 'La Roche-Posay', 'Avène', 'Nuxe',
  'CeraVe', 'Vichy', 'Mixa', 'Eucerin',
];

const SORT_OPTIONS = [
  { id: 'relevance', label: 'Pertinence' },
  { id: 'price-asc', label: 'Prix ↑' },
  { id: 'price-desc', label: 'Prix ↓' },
  { id: 'newest', label: 'Nouveautés' },
];

const TAB_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'products', label: 'Produits' },
  { id: 'brands', label: 'Marques' },
  { id: 'promos', label: 'Promos' },
];

const CAT_LABELS = {
  visage: 'Visage', serum: 'Sérums', solaire: 'Solaires', nettoyant: 'Nettoyants',
  hydratant: 'Hydratants', masque: 'Masques', corps: 'Corps', levres: 'Lèvres',
  maquillage: 'Maquillage', cheveux: 'Cheveux', huile: 'Huiles', hygiene: 'Hygiène',
  bebe: 'Bébé', bouche: 'Bouche', complement: 'Compléments', parfum: 'Parfums',
  pieds_mains: 'Pieds & Mains', intime: 'Intime', deodorants: 'Déodorants',
};

const CAT_EMOJI = {
  visage: '✨', serum: '💧', solaire: '☀️', nettoyant: '🧼', hydratant: '💦',
  masque: '🎭', corps: '🧴', levres: '💋', maquillage: '💄', cheveux: '💇‍♀️',
  huile: '🌿', hygiene: '🛁', bebe: '👶', bouche: '🦷', complement: '💊',
  parfum: '🌸', pieds_mains: '👣', intime: '🌷', deodorants: '🌬️',
};

function catLabel(cat) {
  if (!cat) return '';
  return CAT_LABELS[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
}

function catEmoji(cat) {
  return CAT_EMOJI[cat] || '🛍️';
}

// Haptic léger (silencieux si pas supporté)
function hapticTap() {
  try { if (navigator.vibrate) navigator.vibrate(8); } catch {}
}

// ─── localStorage history ──────────────────────────────────────────────────────
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, HISTORY_MAX)));
  } catch {}
}

function pushHistory(term) {
  const t = (term || '').trim();
  if (!t || t.length < 2) return;
  const cur = loadHistory();
  const next = [t, ...cur.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, HISTORY_MAX);
  saveHistory(next);
}

// ─── Composant principal ───────────────────────────────────────────────────────
export default function Search({ initialCategory, initialBrand }) {
  const { navigate } = useNav();

  // SEO
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
  const seoCanonical = initialBrand
    ? `https://yaram.app/search?brand=${encodeURIComponent(initialBrand)}`
    : initialCategory
      ? `https://yaram.app/search?category=${encodeURIComponent(initialCategory)}`
      : 'https://yaram.app/search';
  usePageSEO({ title: seoTitle, description: seoDesc, canonical: seoCanonical });

  // ─── State ────────────────────────────────────────────────────────────────
  const [q, setQ] = useState('');                  // valeur input (instantanée)
  const [qDebounced, setQDebounced] = useState(''); // valeur utilisée pour filtrer
  const [category, setCategory] = useState(initialCategory || null);
  const [brand, setBrand] = useState(initialBrand || null);
  const [products, setProducts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState('relevance');

  const [history, setHistory] = useState(() => loadHistory());

  const inputRef = useRef(null);

  // ─── Debounce sur q ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // ─── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [p, b, c] = await Promise.all([
          getAllProducts(),
          getAllBrands(),
          getAllCategories(),
        ]);
        if (cancelled) return;
        setProducts(p || []);
        setBrands(b || []);
        setCategories(c || []);
      } catch (e) {
        console.error('Search load error:', e);
      }
      if (!cancelled) setLoading(false);
    };
    load();

    const handleRouteBack = (e) => {
      const target = e?.detail?.to?.name;
      if (target && target !== 'search') return;
      load();
    };
    window.addEventListener('yaram-route-back', handleRouteBack);
    return () => {
      cancelled = true;
      window.removeEventListener('yaram-route-back', handleRouteBack);
    };
  }, []);

  // Réagir aux changements de props initiales (navigation Home → Search)
  useEffect(() => {
    if (initialBrand) setBrand(initialBrand);
  }, [initialBrand]);
  useEffect(() => {
    if (initialCategory) setCategory(initialCategory);
  }, [initialCategory]);

  // ─── Recherche effective ──────────────────────────────────────────────────
  const hasQuery = qDebounced.trim() !== '';
  const hasFilter = !!category || !!brand;
  const isActiveSearch = hasQuery || hasFilter;

  // Suggestions live (instantanées sur input) ─────────────────────────────
  const liveSuggestions = useMemo(() => {
    if (!qDebounced.trim()) return null;
    const s = qDebounced.toLowerCase().trim();

    const matchedProducts = products
      .filter(p =>
        p.name?.toLowerCase().includes(s) ||
        p.brand?.toLowerCase().includes(s)
      )
      .slice(0, 5);

    const matchedBrands = brands
      .filter(b => b.name?.toLowerCase().includes(s))
      .slice(0, 3);

    const matchedCategoriesObj = (categories.length > 0 ? categories : []).filter(c =>
      (c.slug || c.id || '').toString().toLowerCase().includes(s) ||
      (c.name || '').toLowerCase().includes(s) ||
      catLabel(c.slug || c.id)?.toLowerCase().includes(s)
    ).slice(0, 3);

    // Fallback si la table categories est vide : utiliser CAT_LABELS
    const matchedCategories = matchedCategoriesObj.length > 0
      ? matchedCategoriesObj.map(c => ({ slug: c.slug || c.id, label: c.name || catLabel(c.slug || c.id) }))
      : Object.entries(CAT_LABELS)
          .filter(([slug, label]) => slug.includes(s) || label.toLowerCase().includes(s))
          .slice(0, 3)
          .map(([slug, label]) => ({ slug, label }));

    return { products: matchedProducts, brands: matchedBrands, categories: matchedCategories };
  }, [qDebounced, products, brands, categories]);

  // ─── Liste filtrée (résultats) ────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!isActiveSearch) return [];
    let list = [...products];
    if (category) list = list.filter(p => p.category === category);
    if (brand) list = list.filter(p => p.brand === brand);
    if (qDebounced.trim() !== '') {
      const s = qDebounced.toLowerCase().trim();
      list = list.filter(p =>
        p.name?.toLowerCase().includes(s) ||
        p.brand?.toLowerCase().includes(s) ||
        p.category?.toLowerCase().includes(s)
      );
    }

    // Tab filter
    if (tab === 'promos') list = list.filter(p => p.discount || p.promo || (p.old_price && p.old_price > p.price));

    if (sort === 'price-asc') list.sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (sort === 'price-desc') list.sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (sort === 'newest') list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    // 'relevance' = ordre naturel (laisser tel quel)

    return list;
  }, [products, category, brand, qDebounced, tab, sort, isActiveSearch]);

  // Marques matchant la recherche (pour onglet "Marques")
  const matchedBrandsForResults = useMemo(() => {
    if (!qDebounced.trim()) return brands;
    const s = qDebounced.toLowerCase().trim();
    return brands.filter(b => b.name?.toLowerCase().includes(s));
  }, [qDebounced, brands]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleClear = () => {
    setQ('');
    setQDebounced('');
    inputRef.current?.focus();
  };

  const handleCancel = () => {
    hapticTap();
    navigate(-1);
  };

  const submitTerm = useCallback((term) => {
    if (!term) return;
    pushHistory(term);
    setHistory(loadHistory());
    setQ(term);
  }, []);

  const removeHistoryItem = (term) => {
    const next = loadHistory().filter(x => x !== term);
    saveHistory(next);
    setHistory(next);
  };

  const clearAllHistory = () => {
    saveHistory([]);
    setHistory([]);
  };

  const goToProduct = (p) => {
    hapticTap();
    pushHistory(p.name);
    navigate(`/product/${p.id}`);
  };

  const goToBrand = (b) => {
    hapticTap();
    pushHistory(b.name || b);
    setBrand(b.name || b);
    setQ('');
    setQDebounced('');
  };

  const goToCategory = (slug, label) => {
    hapticTap();
    if (label) pushHistory(label);
    setCategory(slug);
    setQ('');
    setQDebounced('');
  };

  const clearCategoryFilter = () => setCategory(null);
  const clearBrandFilter = () => setBrand(null);

  // ─── JSON-LD ItemList (SEO) ───────────────────────────────────────────────
  useJsonLd(
    (initialCategory || initialBrand) && filtered.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: seoTitle,
          numberOfItems: filtered.length,
          itemListElement: filtered.slice(0, 20).map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: `https://yaram.app/product/${p.id}`,
            name: p.name,
          })),
        }
      : null,
    `searchitemlist-${initialCategory || initialBrand || 'none'}`
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  const showResults = isActiveSearch;
  const showLiveSuggestions = hasQuery && !hasFilter && liveSuggestions
    && (liveSuggestions.products.length + liveSuggestions.brands.length + liveSuggestions.categories.length > 0);

  return (
    <div className="search-screen page-anim">
      {/* ─── Header sticky ─── */}
      <div className="ysearch-header">
        <div className="ysearch-input-wrap">
          <svg className="ysearch-loupe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            autoFocus={!category && !initialBrand}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && q.trim()) submitTerm(q.trim()); }}
            placeholder={category ? `Filtrer dans ${catLabel(category)}…` : brand ? `Filtrer dans ${brand}…` : 'Produit, marque, ingrédient…'}
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {q && (
            <button onClick={handleClear} className="ysearch-clear" aria-label="Effacer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        <button className="ysearch-cancel" onClick={handleCancel}>Annuler</button>
      </div>

      {/* ─── Bandeau filtres actifs ─── */}
      {(category || brand) && (
        <div className="ysearch-pinned-filters">
          {category && (
            <span className="ysearch-pin-chip">
              {catEmoji(category)} {catLabel(category)}
              <button onClick={clearCategoryFilter} aria-label="Retirer catégorie">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </span>
          )}
          {brand && (
            <span className="ysearch-pin-chip">
              🏷️ {brand}
              <button onClick={clearBrandFilter} aria-label="Retirer marque">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </span>
          )}
        </div>
      )}

      {/* ─── Filtres tabs (quand résultats) ─── */}
      {showResults && (
        <div className="ysearch-tabs-bar">
          <div className="ysearch-tabs">
            {TAB_FILTERS.map(t => (
              <button
                key={t.id}
                className={`ysearch-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => { setTab(t.id); hapticTap(); }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ysearch-tabs ysearch-tabs-sort">
            {SORT_OPTIONS.map(s => (
              <button
                key={s.id}
                className={`ysearch-tab small ${sort === s.id ? 'active' : ''}`}
                onClick={() => { setSort(s.id); hapticTap(); }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Scroll body ─── */}
      <div className="ysearch-scroll">
        {/* CAS 1 : input avec texte → suggestions live */}
        {hasQuery && !hasFilter && (
          <LiveSuggestions
            suggestions={liveSuggestions}
            loading={loading}
            onPickProduct={goToProduct}
            onPickBrand={goToBrand}
            onPickCategory={goToCategory}
          />
        )}

        {/* CAS 2 : recherche active (filtres ou query+filtre) → résultats */}
        {showResults && !(hasQuery && !hasFilter) && (
          loading ? (
            <SearchSkeleton />
          ) : tab === 'brands' ? (
            <BrandsResults brands={matchedBrandsForResults} onPick={goToBrand} />
          ) : filtered.length === 0 ? (
            <NoResults
              term={qDebounced || category || brand}
              categories={categories}
              onPickCategory={goToCategory}
              onReset={() => { setCategory(null); setBrand(null); setQ(''); setQDebounced(''); }}
            />
          ) : (
            <ResultsGrid products={filtered} category={category} brand={brand} />
          )
        )}

        {/* CAS 3 : rien tapé → empty state premium */}
        {!isActiveSearch && (
          <EmptyState
            history={history}
            onPickHistory={(term) => { setQ(term); }}
            onRemoveHistory={removeHistoryItem}
            onClearHistory={clearAllHistory}
            onPickSuggestion={(s) => { setQ(s); }}
            trendingBrands={brands.length > 0
              ? brands.filter(b => TRENDING_BRANDS.includes(b.name)).slice(0, 8)
              : TRENDING_BRANDS.map(name => ({ name, logo: null }))}
            onPickBrand={goToBrand}
            categories={categories}
            onPickCategory={goToCategory}
          />
        )}

        <div style={{ height: 40 }} />
      </div>

      <TabBar active="search" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOUS-COMPOSANTS
// ═══════════════════════════════════════════════════════════════════════════════

function LiveSuggestions({ suggestions, loading, onPickProduct, onPickBrand, onPickCategory }) {
  if (loading) return <SearchSkeleton mini />;
  if (!suggestions) return null;
  const { products, brands, categories } = suggestions;
  if (products.length + brands.length + categories.length === 0) {
    return (
      <div className="ysearch-no-live">
        <div className="ysearch-no-live-emoji">🔍</div>
        <p>Aucune correspondance directe.</p>
        <span>Appuie sur Entrée pour lancer une recherche complète.</span>
      </div>
    );
  }

  let idx = 0;
  return (
    <div className="ysearch-live">
      {products.length > 0 && (
        <div className="ysearch-live-section">
          <h4 className="ysearch-live-title">Produits</h4>
          <div className="ysearch-live-list">
            {products.map((p) => (
              <button
                key={p.id}
                className="ysearch-live-row stagger-in"
                style={{ animationDelay: `${(idx++) * STAGGER_MS}ms` }}
                onClick={() => onPickProduct(p)}
              >
                <div className="ysearch-live-thumb">
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="ysearch-live-thumb-ph">{(p.name || '?')[0]}</div>}
                </div>
                <div className="ysearch-live-meta">
                  <div className="ysearch-live-name">{p.name}</div>
                  <div className="ysearch-live-sub">{p.brand}</div>
                </div>
                <div className="ysearch-live-price">{p.price ? `${p.price.toLocaleString('fr-FR')} F` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {brands.length > 0 && (
        <div className="ysearch-live-section">
          <h4 className="ysearch-live-title">Marques</h4>
          <div className="ysearch-live-list">
            {brands.map((b) => (
              <button
                key={b.id || b.name}
                className="ysearch-live-row stagger-in"
                style={{ animationDelay: `${(idx++) * STAGGER_MS}ms` }}
                onClick={() => onPickBrand(b)}
              >
                <div className="ysearch-live-thumb brand">
                  {b.logo ? <img src={b.logo} alt="" loading="lazy" /> : <div className="ysearch-live-thumb-ph">{(b.name || '?')[0]}</div>}
                </div>
                <div className="ysearch-live-meta">
                  <div className="ysearch-live-name">{b.name}</div>
                  <div className="ysearch-live-sub">Marque{b.local ? ' · 🇸🇳 locale' : ''}</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="ysearch-live-arrow">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {categories.length > 0 && (
        <div className="ysearch-live-section">
          <h4 className="ysearch-live-title">Catégories</h4>
          <div className="ysearch-live-list">
            {categories.map((c) => (
              <button
                key={c.slug}
                className="ysearch-live-row stagger-in"
                style={{ animationDelay: `${(idx++) * STAGGER_MS}ms` }}
                onClick={() => onPickCategory(c.slug, c.label)}
              >
                <div className="ysearch-live-thumb cat">{catEmoji(c.slug)}</div>
                <div className="ysearch-live-meta">
                  <div className="ysearch-live-name">{c.label}</div>
                  <div className="ysearch-live-sub">Catégorie</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="ysearch-live-arrow">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsGrid({ products, category, brand }) {
  return (
    <div className="search-results">
      <div className="ysearch-count">
        <strong>{products.length}</strong> résultat{products.length > 1 ? 's' : ''}
        {category ? ` · ${catLabel(category)}` : ''}
        {brand ? ` · ${brand}` : ''}
      </div>
      <div className="search-product-grid-2">
        {products.map((p, i) => (
          <div key={p.id} className="stagger-in" style={{ animationDelay: `${Math.min(i, 12) * STAGGER_MS}ms` }}>
            <ProductTile product={p} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandsResults({ brands, onPick }) {
  if (brands.length === 0) {
    return (
      <div className="ysearch-no-live">
        <div className="ysearch-no-live-emoji">🏷️</div>
        <p>Aucune marque correspondante</p>
      </div>
    );
  }
  return (
    <div className="ysearch-brands-grid">
      {brands.map((b, i) => (
        <button
          key={b.id || b.name}
          className="ysearch-brand-card stagger-in"
          style={{ animationDelay: `${Math.min(i, 12) * STAGGER_MS}ms` }}
          onClick={() => onPick(b)}
        >
          <div className="ysearch-brand-logo">
            {b.logo ? <img src={b.logo} alt={b.name} loading="lazy" /> : <span>{(b.name || '?')[0]}</span>}
          </div>
          <div className="ysearch-brand-name">{b.name}</div>
          {b.local && <div className="ysearch-brand-tag">🇸🇳 Locale</div>}
        </button>
      ))}
    </div>
  );
}

function NoResults({ term, categories, onPickCategory, onReset }) {
  const suggested = (categories || []).slice(0, 6);
  const fallback = Object.entries(CAT_LABELS).slice(0, 6).map(([slug, label]) => ({ slug, name: label }));
  const list = suggested.length > 0 ? suggested : fallback;
  return (
    <div className="ysearch-no-results">
      <div className="ysearch-no-illust">🌿</div>
      <h3>Pas de résultat pour <span className="ysearch-no-term">« {term} »</span></h3>
      <p>Essaie une autre orthographe ou explore ces catégories :</p>
      <div className="ysearch-no-cats">
        {list.map(c => {
          const slug = c.slug || c.id;
          return (
            <button key={slug} className="ysearch-no-cat" onClick={() => onPickCategory(slug, c.name || catLabel(slug))}>
              <span>{catEmoji(slug)}</span>
              <span>{c.name || catLabel(slug)}</span>
            </button>
          );
        })}
      </div>
      <button className="ysearch-reset-btn" onClick={onReset}>Réinitialiser la recherche</button>
    </div>
  );
}

function EmptyState({ history, onPickHistory, onRemoveHistory, onClearHistory, onPickSuggestion, trendingBrands, onPickBrand, categories, onPickCategory }) {
  return (
    <div className="ysearch-empty">
      {/* Recherches récentes */}
      {history.length > 0 && (
        <section className="ysearch-section">
          <div className="ysearch-section-head">
            <h3 className="ysearch-section-title">Recherches récentes</h3>
            <button className="ysearch-section-action" onClick={onClearHistory}>Effacer tout</button>
          </div>
          <div className="ysearch-chips">
            {history.map((term, i) => (
              <span
                key={term}
                className="ysearch-chip removable stagger-in"
                style={{ animationDelay: `${i * STAGGER_MS}ms` }}
              >
                <button className="ysearch-chip-main" onClick={() => onPickHistory(term)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                    <polyline points="12 8 12 12 14 14"/><circle cx="12" cy="12" r="10"/>
                  </svg>
                  {term}
                </button>
                <button className="ysearch-chip-remove" onClick={() => onRemoveHistory(term)} aria-label={`Retirer ${term}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Suggestions populaires */}
      <section className="ysearch-section">
        <div className="ysearch-section-head">
          <h3 className="ysearch-section-title">Suggestions populaires</h3>
        </div>
        <div className="ysearch-chips">
          {POPULAR_SUGGESTIONS.map((s, i) => (
            <button
              key={s}
              className="ysearch-chip suggestion stagger-in"
              style={{ animationDelay: `${i * STAGGER_MS}ms` }}
              onClick={() => onPickSuggestion(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* Marques tendance */}
      {trendingBrands.length > 0 && (
        <section className="ysearch-section">
          <div className="ysearch-section-head">
            <h3 className="ysearch-section-title">Marques tendance</h3>
          </div>
          <div className="ysearch-trending-grid">
            {trendingBrands.map((b, i) => (
              <button
                key={b.id || b.name}
                className="ysearch-trending-card stagger-in"
                style={{ animationDelay: `${i * STAGGER_MS}ms` }}
                onClick={() => onPickBrand(b)}
              >
                <div className="ysearch-trending-logo">
                  {b.logo ? <img src={b.logo} alt={b.name} loading="lazy" /> : <span>{(b.name || '?')[0]}</span>}
                </div>
                <div className="ysearch-trending-name">{b.name}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Catégories quick access */}
      {categories.length > 0 && (
        <section className="ysearch-section">
          <div className="ysearch-section-head">
            <h3 className="ysearch-section-title">Parcourir par catégorie</h3>
          </div>
          <div className="ysearch-chips">
            {categories.slice(0, 10).map((c, i) => {
              const slug = c.slug || c.id;
              return (
                <button
                  key={slug}
                  className="ysearch-chip stagger-in"
                  style={{ animationDelay: `${i * STAGGER_MS}ms` }}
                  onClick={() => onPickCategory(slug, c.name || catLabel(slug))}
                >
                  <span>{catEmoji(slug)}</span>
                  <span>{c.name || catLabel(slug)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// Skeleton shimmer ─────────────────────────────────────────────────────────────
function SearchSkeleton({ mini }) {
  if (mini) {
    return (
      <div className="ysearch-live">
        <div className="ysearch-live-section">
          <div className="ysearch-sk-line" style={{ width: 90, height: 12, marginBottom: 12 }} />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ysearch-sk-row">
              <div className="ysearch-sk-box" style={{ width: 48, height: 48, borderRadius: 12 }} />
              <div style={{ flex: 1 }}>
                <div className="ysearch-sk-line" style={{ width: '70%', height: 11, marginBottom: 6 }} />
                <div className="ysearch-sk-line" style={{ width: '40%', height: 10 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="search-results">
      <div className="ysearch-sk-line" style={{ width: 120, height: 14, marginBottom: 14 }} />
      <div className="search-product-grid-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="product-tile" style={{ pointerEvents: 'none' }}>
            <div className="pt-img-wrap">
              <div className="ysearch-sk-line" style={{ width: '100%', aspectRatio: '1/1', borderRadius: 12 }} />
            </div>
            <div className="pt-info">
              <div className="ysearch-sk-line" style={{ width: '50%', height: 10, marginBottom: 6 }} />
              <div className="ysearch-sk-line" style={{ width: '90%', height: 12, marginBottom: 8 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div className="ysearch-sk-line" style={{ width: 60, height: 14 }} />
                <div className="ysearch-sk-line" style={{ width: 32, height: 14 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
