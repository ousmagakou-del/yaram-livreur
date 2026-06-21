import { useState, useEffect, useRef, useMemo } from 'react';
import { useNav } from '../App';
import { getMyFavorites, toggleFavorite } from '../lib/supabase';
import { haptic } from '../lib/haptic';
import ProductTile from '../components/ProductTile';
import TabBar from '../components/TabBar';
import './Favorites.css';

const SORT_OPTIONS = [
  { id: 'recent', label: 'Plus récents', icon: '🕒' },
  { id: 'name',   label: 'Nom A → Z',    icon: '🔤' },
  { id: 'price_asc',  label: 'Prix croissant',  icon: '↑' },
  { id: 'price_desc', label: 'Prix décroissant', icon: '↓' },
  { id: 'pharmacy',   label: 'Par pharmacie', icon: '🏥' },
];

const TABS = [
  { id: 'products',   label: 'Produits',   icon: '✨' },
  { id: 'pharmacies', label: 'Pharmacies', icon: '🏥' },
  { id: 'brands',     label: 'Marques',    icon: '⭐' },
];

export default function Favorites() {
  const { navigate } = useNav();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('products');
  const [sort, setSort] = useState('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [toast, setToast] = useState('');
  const longPressTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyFavorites();
        if (!cancelled) setFavorites(data || []);
      } catch (e) {
        console.warn('[Favorites] load failed:', e?.message);
        if (!cancelled) setFavorites([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(''), 2500);
  };

  // PRESERVE : tri en mémoire
  const sortedProducts = useMemo(() => {
    const arr = [...favorites];
    switch (sort) {
      case 'name':       arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
      case 'price_asc':  arr.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
      case 'price_desc': arr.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
      case 'pharmacy':   arr.sort((a, b) => (a.brand || '').localeCompare(b.brand || '')); break;
      default: break;
    }
    return arr;
  }, [favorites, sort]);

  // Cards pharmacies & marques dérivées depuis les favoris produits
  const pharmacies = useMemo(() => {
    const map = new Map();
    favorites.forEach(p => {
      const key = p.pharmacy_id || p.brand || 'autre';
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: p.pharmacy_name || p.brand || 'Pharmacie',
          distance: p.distance_km || (1 + Math.random() * 6).toFixed(1),
          count: 1,
        });
      } else {
        map.get(key).count++;
      }
    });
    return Array.from(map.values());
  }, [favorites]);

  const brands = useMemo(() => {
    const map = new Map();
    favorites.forEach(p => {
      const key = p.brand || 'Sans marque';
      if (!map.has(key)) {
        map.set(key, { id: key, name: key, count: 1 });
      } else {
        map.get(key).count++;
      }
    });
    return Array.from(map.values());
  }, [favorites]);

  // ── Sélection multiple ──
  const enterSelect = (id) => {
    haptic('medium');
    setSelectMode(true);
    setSelected(new Set([id]));
  };
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const handleLongPressStart = (id) => {
    longPressTimer.current = setTimeout(() => enterSelect(id), 550);
  };
  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Bulk delete
  const bulkDelete = async () => {
    const ids = Array.from(selected);
    haptic('heavy');
    for (const id of ids) {
      try { await toggleFavorite(id); } catch {}
    }
    setFavorites(prev => prev.filter(p => !selected.has(p.id)));
    showToast(`${ids.length} favori${ids.length > 1 ? 's' : ''} retiré${ids.length > 1 ? 's' : ''}`);
    exitSelect();
  };

  // Bulk add to cart (stocke local + redirect)
  const bulkAddToCart = () => {
    haptic('medium');
    const ids = Array.from(selected);
    try {
      const cart = JSON.parse(localStorage.getItem('yaram_cart') || '[]');
      ids.forEach(id => {
        const p = favorites.find(f => f.id === id);
        if (p) cart.push({ id: p.id, name: p.name, brand: p.brand, price: p.price, img: p.img, qty: 1 });
      });
      localStorage.setItem('yaram_cart', JSON.stringify(cart));
    } catch {}
    showToast(`${ids.length} produit${ids.length > 1 ? 's' : ''} ajouté${ids.length > 1 ? 's' : ''} au panier`);
    exitSelect();
    setTimeout(() => navigate('/cart'), 600);
  };

  // ── SwipeRow inline component ──
  const SwipeCell = ({ product, index }) => {
    const [dx, setDx] = useState(0);
    const startX = useRef(0);
    const moved = useRef(false);

    const onTouchStart = (e) => {
      startX.current = e.touches[0].clientX;
      moved.current = false;
      handleLongPressStart(product.id);
    };
    const onTouchMove = (e) => {
      const d = e.touches[0].clientX - startX.current;
      if (Math.abs(d) > 6) { moved.current = true; handleLongPressEnd(); }
      if (d < 0) setDx(Math.max(d, -120));
    };
    const onTouchEnd = async () => {
      handleLongPressEnd();
      if (dx < -80) {
        haptic('medium');
        try { await toggleFavorite(product.id); } catch {}
        setFavorites(prev => prev.filter(p => p.id !== product.id));
        showToast('Favori retiré');
      } else {
        setDx(0);
      }
    };

    const onClick = (e) => {
      if (selectMode) {
        e.preventDefault();
        e.stopPropagation();
        toggleSelect(product.id);
      }
    };

    return (
      <div
        className={`yfav-cell ${selectMode ? 'selectable' : ''} ${selected.has(product.id) ? 'selected' : ''}`}
        style={{ animationDelay: `${Math.min(index * 35, 600)}ms` }}
      >
        <div className="yfav-swipe-wrap">
          <div className="yfav-swipe-bg">Retirer ❤️</div>
          <div
            className="yfav-swipe-content"
            style={{ transform: `translateX(${dx}px)` }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onClickCapture={onClick}
          >
            <ProductTile product={product} />
            {selectMode && (
              <div className="yfav-checkbox">{selected.has(product.id) ? '✓' : ''}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const currentCount = tab === 'products' ? favorites.length : tab === 'pharmacies' ? pharmacies.length : brands.length;

  return (
    <div className="yfav-screen page-anim">
      {/* HEADER GLASS */}
      <header className="yfav-header">
        <button className="yfav-back" onClick={() => selectMode ? exitSelect() : navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            {selectMode ? (
              <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
            ) : (
              <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>
            )}
          </svg>
        </button>
        <div className="yfav-title-wrap">
          <h1 className="yfav-title">{selectMode ? `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : 'Mes favoris'}</h1>
          {!selectMode && (
            <p className="yfav-sub">{currentCount} {tab === 'products' ? 'produit' : tab === 'pharmacies' ? 'pharmacie' : 'marque'}{currentCount > 1 ? 's' : ''} sauvé{currentCount > 1 ? 's' : ''}</p>
          )}
        </div>
        {!selectMode && (
          <button className="yfav-sort-btn" onClick={() => setSortOpen(true)} aria-label="Trier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="3" y2="12"/><line x1="13" y1="18" x2="3" y2="18"/>
            </svg>
            Trier
          </button>
        )}
      </header>

      {/* TABS */}
      {!selectMode && (
        <div className="yfav-tabs">
          {TABS.map(t => {
            const count = t.id === 'products' ? favorites.length : t.id === 'pharmacies' ? pharmacies.length : brands.length;
            return (
              <button
                key={t.id}
                className={`yfav-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => { haptic('light'); setTab(t.id); }}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
                <span className="yfav-tab-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* SCROLL */}
      <div className="yfav-scroll">
        {loading ? (
          <div className="yfav-skel-grid">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="yfav-skel" />)}
          </div>
        ) : currentCount === 0 ? (
          <div className="yfav-empty">
            <div className="yfav-empty-illu">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </div>
            <h3 className="yfav-empty-title">Tu n'as pas encore de favoris</h3>
            <p className="yfav-empty-sub">Touche le cœur sur un produit pour le retrouver ici en un clin d'œil.</p>
            <button className="yfav-empty-cta" onClick={() => navigate('/')}>
              Découvrir le catalogue →
            </button>
          </div>
        ) : tab === 'products' ? (
          <div className="yfav-grid">
            {sortedProducts.map((p, i) => <SwipeCell key={p.id} product={p} index={i} />)}
          </div>
        ) : tab === 'pharmacies' ? (
          <div className="yfav-pharma-list">
            {pharmacies.map((ph, i) => (
              <div
                key={ph.id}
                className="yfav-pharma-card yfav-cell"
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => navigate(`/pharmacy/${ph.id}`)}
              >
                <div className="yfav-pharma-logo">🏥</div>
                <div className="yfav-pharma-info">
                  <h3 className="yfav-pharma-name">{ph.name}</h3>
                  <div className="yfav-pharma-meta">
                    <span>📍 {ph.distance} km</span>
                    <span className="dot" />
                    <span>{ph.count} produit{ph.count > 1 ? 's' : ''}</span>
                  </div>
                </div>
                <svg className="yfav-pharma-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="18" height="18">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        ) : (
          <div className="yfav-brand-grid">
            {brands.map((b, i) => (
              <div
                key={b.id}
                className="yfav-brand-card yfav-cell"
                style={{ animationDelay: `${i * 50}ms` }}
                onClick={() => navigate(`/brand/${encodeURIComponent(b.name)}`)}
              >
                <div className="yfav-brand-logo">{(b.name || '?').charAt(0).toUpperCase()}</div>
                <h3 className="yfav-brand-name">{b.name}</h3>
                <p className="yfav-brand-count">{b.count} produit{b.count > 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BULK BAR */}
      {selectMode && selected.size > 0 && (
        <div className="yfav-bulk-bar">
          <span className="yfav-bulk-count">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          <button className="yfav-bulk-btn danger" onClick={bulkDelete}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/></svg>
            Supprimer
          </button>
          <button className="yfav-bulk-btn primary" onClick={bulkAddToCart}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="14" height="14"><circle cx="9" cy="21" r="1.5"/><circle cx="20" cy="21" r="1.5"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/></svg>
            Au panier
          </button>
        </div>
      )}

      {/* MODAL SORT */}
      {sortOpen && (
        <div className="yfav-modal-backdrop" onClick={() => setSortOpen(false)}>
          <div className="yfav-modal" onClick={(e) => e.stopPropagation()}>
            <div className="yfav-modal-handle" />
            <h3 className="yfav-modal-title">Trier par</h3>
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.id}
                className={`yfav-modal-option ${sort === opt.id ? 'active' : ''}`}
                onClick={() => { haptic('light'); setSort(opt.id); setSortOpen(false); }}
              >
                <span><span style={{ marginRight: 10 }}>{opt.icon}</span>{opt.label}</span>
                {sort === opt.id && <span className="check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {toast && <div className="yfav-toast">{toast}</div>}

      <TabBar />
    </div>
  );
}
