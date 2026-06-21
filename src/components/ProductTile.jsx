import { useState, useEffect, memo } from 'react';
import { useNav } from '../App';
import { scoreClass, formatPrice } from '../lib/utils';
import { isFavorite, toggleFavorite } from '../lib/supabase';
import { haptic } from '../lib/haptic';
import { imgSrc } from '../lib/imgSrc';
import './ProductTile.css';

function ProductTile({ product, size = 'normal' }) {
  const { navigate } = useNav();
  const [fav, setFav] = useState(false);

  useEffect(() => {
    // SAFETY : cancelled flag pour éviter "setState on unmounted component" warning
    // si user scroll vite (tile démontée avant que isFavorite résolve).
    let cancelled = false;
    isFavorite(product.id).then(fav => {
      if (!cancelled) setFav(fav);
    }).catch(() => { /* silent : favori = false par défaut */ });
    return () => { cancelled = true; };
  }, [product.id]);

  const handleFav = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    haptic('light');
    // OPTIMISTIC : on flip l'état immédiatement, rollback si serveur refuse
    const optimistic = !fav;
    setFav(optimistic);
    try {
      const next = await toggleFavorite(product.id);
      // Si le serveur retourne un état différent, on s'aligne
      if (next !== optimistic) setFav(next);
    } catch {
      // Rollback en cas d'erreur réseau
      setFav(!optimistic);
    }
  };

  const handleOpen = () => {
    navigate(`/product/${product.id}`);
  };

  const sc = scoreClass(product.score);
  const fallbackImg = 'https://placehold.co/400x400/E8F5EC/1F8B4C?text=' + encodeURIComponent(product.brand || 'Produit');

  return (
    <div className={`product-tile ${size}`} onClick={handleOpen} role="button" tabIndex={0}>
      <div className="pt-img-wrap">
        <img
          src={imgSrc(product.img, { w: size === 'large' ? 600 : 400, q: 80 })}
          alt={`${product.brand || ''} ${product.name || 'Produit'}`.trim()}
          loading="lazy"
          decoding="async"
          onError={(e) => { e.target.src = fallbackImg; }}
        />
        <div className={`pt-score ${sc}`}>{product.score}</div>
        {product.is_imported && (
          <div className="pt-import-badge" title={`Import ${product.origin_country || 'USA'} - livraison sous ${product.lead_time_days || 15}j`}>
            <span>✈️</span> Import {product.lead_time_days || 15}j
          </div>
        )}
        <button
          type="button"
          className={`pt-fav ${fav ? 'active' : ''}`}
          onClick={handleFav}
          aria-label="Ajouter aux favoris"
        >
          <svg viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
        </button>
      </div>
      <div className="pt-info">
        <div className="pt-brand">{product.brand}</div>
        <div className="pt-name">{product.name}</div>
        <div className="pt-bottom">
          <span className="pt-price">{formatPrice(product.price)}<small> FCFA</small></span>
          <span className="pt-rating">★ {product.rating}</span>
        </div>
      </div>
    </div>
  );
}

// PERF : memo evite les re-renders inutiles dans les grilles (Home, Search, Categories).
// Comparaison custom : on ne re-render que si l'ID change OU la taille change.
// Les autres props (img, name, price, score) sont stables tant que l'ID est le même
// (puisque ça vient du cache produit). Si elles changent (rare), c'est OK de skip.
export default memo(ProductTile, (prev, next) => (
  prev.product?.id === next.product?.id &&
  prev.size === next.size &&
  prev.product?.price === next.product?.price &&
  prev.product?.score === next.product?.score
));