import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { scoreClass, formatPrice } from '../lib/utils';
import { isFavorite, toggleFavorite } from '../lib/supabase';
import { haptic } from '../lib/haptic';
import './ProductTile.css';

export default function ProductTile({ product, size = 'normal' }) {
  const { navigate } = useNav();
  const [fav, setFav] = useState(false);

  useEffect(() => {
    (async () => setFav(await isFavorite(product.id)))();
  }, [product.id]);

  const handleFav = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    haptic('light');
    const next = await toggleFavorite(product.id);
    setFav(next);
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
          src={product.img}
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