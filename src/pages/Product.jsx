import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { supabase, getProductAvailability, isFavorite, toggleFavorite } from '../lib/supabase';
import { scoreClass, formatPrice, YARAM_WHATSAPP } from '../lib/utils';
import { haptic } from '../lib/haptic';
import { addToCart as cartAddToCart } from '../lib/cart';
import ReviewsSection from '../components/ReviewsSection';
import './Product.css';

export default function Product({ id }) {
  const { navigate } = useNav();
  const [product, setProduct] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPh, setSelectedPh] = useState(null);
  const [tab, setTab] = useState('ingredients');
  const [loading, setLoading] = useState(true);
  const [fav, setFav] = useState(false);
  const [favAnim, setFavAnim] = useState(false);
  const [qty, setQty] = useState(1);
  const [showCartToast, setShowCartToast] = useState(false);
  const [cartBounce, setCartBounce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Fetch UN seul produit (avant on telechargeait les 800+ pour en garder 1)
      const { data: p, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !p) {
        setProduct(null);
        setLoading(false);
        return;
      }
      setProduct(p);
      const [av, isFav] = await Promise.all([
        getProductAvailability(p.id),
        isFavorite(p.id),
      ]);
      if (cancelled) return;
      setPharmacies(av);
      setFav(isFav);
      if (av.length > 0) setSelectedPh(av[0]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const handleFav = async () => {
    haptic('light');
    setFavAnim(true);
    setTimeout(() => setFavAnim(false), 600);
    const next = await toggleFavorite(product.id);
    setFav(next);
  };

  const handleShare = async () => {
    haptic('light');
    const shareData = {
      title: product.name,
      text: `Découvre ${product.name} de ${product.brand} sur YARAM ! ${product.score}/100 ⭐`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback : copier le lien
        await navigator.clipboard.writeText(window.location.href);
        alert('Lien copié ! Partage-le avec tes amies 💚');
      }
    } catch (e) {
      console.log('Share canceled');
    }
  };

  const addToCart = () => {
    if (!selectedPh) {
      alert('Sélectionne une pharmacie');
      return;
    }
    // Passe par lib/cart.js : dispatch yaram-cart-updated (badge TabBar)
    // + set le timestamp pour la notif WhatsApp "panier abandonne" (24h).
    const result = cartAddToCart({
      product,
      pharmacy: selectedPh.pharmacy,
      qty,
    });
    if (!result.success) {
      alert(result.error || 'Erreur panier');
      return;
    }
    haptic('success');

    // Animation
    setCartBounce(true);
    setShowCartToast(true);
    setTimeout(() => setCartBounce(false), 600);
    setTimeout(() => setShowCartToast(false), 2500);
  };

  const goToCart = () => {
    setShowCartToast(false);
    navigate('/cart');
  };

  if (loading) return <div style={{padding: 40, textAlign: 'center'}}>Chargement…</div>;

  if (!product) {
    return (
      <div style={{padding: 40, textAlign: 'center'}}>
        <p>Produit introuvable</p>
        <button className="btn-primary" onClick={() => navigate('/')} style={{ marginTop: 20 }}>Retour</button>
      </div>
    );
  }

  const sc = scoreClass(product.score);
  const hasStock = pharmacies.length > 0;
  const waUrl = `https://wa.me/${YARAM_WHATSAPP}?text=` + encodeURIComponent("Bonjour, j'ai une question sur " + product.name);
  
  // Badge si nouveau / top vente
  const isTopSeller = (product.review_count || 0) >= 500;
  const isNew = product.created_at && (Date.now() - new Date(product.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000;
  const hasOldPrice = product.old_price && product.old_price > product.price;
  const discount = hasOldPrice ? Math.round(((product.old_price - product.price) / product.old_price) * 100) : 0;

  // Étoiles avec stagger animation
  const stars = [1, 2, 3, 4, 5].map(i => {
    const fullStar = product.rating >= i;
    const halfStar = product.rating >= i - 0.5 && product.rating < i;
    return (
      <span 
        key={i} 
        style={{
          color: fullStar || halfStar ? '#F4B53A' : '#DDD',
          fontSize: 16,
          display: 'inline-block',
          animation: `starPop 0.4s ease-out ${i * 0.1}s both`,
        }}
      >
        ★
      </span>
    );
  });

  return (
    <div className="prod-screen page-anim">
      <style>{`
        @keyframes heartPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }
        @keyframes cartBounce {
          0%, 100% { transform: scale(1); }
          30% { transform: scale(1.3) rotate(-10deg); }
          60% { transform: scale(0.95) rotate(5deg); }
        }
        @keyframes starPop {
          0% { transform: scale(0); opacity: 0; }
          70% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes slideInUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes badgePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(217,52,43,0.7); }
          70% { box-shadow: 0 0 0 10px rgba(217,52,43,0); }
        }
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
      `}</style>

      {/* HEADER */}
      <div className="prod-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div style={{display: 'flex', gap: 8}}>
          {/* Favori avec animation */}
          <button 
            className={`icon-back-btn ${fav ? 'fav-active' : ''}`} 
            onClick={handleFav} 
            style={{
              color: fav ? '#D9342B' : 'inherit',
              animation: favAnim ? 'heartPulse 0.6s ease-out' : 'none',
            }}
          >
            <svg viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
          </button>
          
          {/* Partager */}
          <button className="icon-back-btn" onClick={handleShare}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
          
          {/* Panier avec animation bounce */}
          <button 
            className="icon-back-btn" 
            onClick={() => navigate('/cart')}
            style={{
              animation: cartBounce ? 'cartBounce 0.6s ease-out' : 'none',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="prod-scroll">
        <div className="prod-image" style={{ position: 'relative' }}>
          <img src={product.img} alt={product.name} />
          <div className={`prod-score ${sc}`}>
            <div className="prod-score-num">{product.score}</div>
            <div className="prod-score-lbl">/100</div>
          </div>
          
          {/* Badges animés */}
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {isTopSeller && (
              <div style={{
                background: '#D9342B',
                color: 'white',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                animation: 'badgePulse 2s infinite',
              }}>
                🔥 Top vente
              </div>
            )}
            {isNew && (
              <div style={{
                background: '#1F8B4C',
                color: 'white',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
              }}>
                ✨ Nouveau
              </div>
            )}
            {discount > 0 && (
              <div style={{
                background: '#FF7900',
                color: 'white',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                animation: 'badgePulse 2s infinite',
              }}>
                -{discount}%
              </div>
            )}
          </div>
        </div>

        <div className="prod-info">
          <div className="prod-brand">{product.brand}</div>
          <h1 className="prod-name">{product.name}</h1>
          <p className="prod-short">{product.short_desc}</p>

          {/* Rating avec animation étoiles */}
          <div className="prod-rating">
            <div>{stars}</div>
            <span style={{ marginLeft: 8 }}>{product.rating}</span>
            <span style={{color: 'var(--ink-soft)', marginLeft: 4}}>· {product.review_count} avis</span>
          </div>

          {/* Prix avec promo */}
          <div className="prod-price">
            {hasOldPrice && (
              <span style={{ 
                textDecoration: 'line-through', 
                color: '#9B9B9B', 
                fontSize: 14, 
                marginRight: 8,
                fontWeight: 400,
              }}>
                {formatPrice(product.old_price)}
              </span>
            )}
            <strong>{formatPrice(product.price)}</strong>
            <small>FCFA</small>
          </div>

          {product.badges?.length > 0 && (
            <div className="prod-badges">
              {product.badges.map(b => <span key={b} className="prod-badge">{b}</span>)}
            </div>
          )}

          <div className="prod-tabs">
            <button className={`prod-tab ${tab === 'ingredients' ? 'active' : ''}`} onClick={() => setTab('ingredients')}>Ingrédients</button>
            <button className={`prod-tab ${tab === 'desc' ? 'active' : ''}`} onClick={() => setTab('desc')}>Description</button>
            <button className={`prod-tab ${tab === 'reviews' ? 'active' : ''}`} onClick={() => setTab('reviews')}>Avis</button>
          </div>

          <div className="prod-tab-content">
            {tab === 'ingredients' && (
              <p style={{fontSize: 12, lineHeight: 1.6, color: 'var(--ink-soft)'}}>{product.inci || 'INCI non disponible'}</p>
            )}
            {tab === 'desc' && (
              <div>
                <p style={{fontSize: 13, lineHeight: 1.6, color: 'var(--ink)'}}>{product.long_desc}</p>
                {product.reason && (
                  <div style={{marginTop: 12, padding: 12, background: 'var(--excellent-bg)', borderRadius: 10, fontSize: 12}}>
                    💡 <strong>Pourquoi pour toi :</strong> {product.reason}
                  </div>
                )}
              </div>
            )}
            {tab === 'reviews' && (
              <ReviewsSection productId={product.id} />
            )}
          </div>

          <div className="prod-section">
            <h3 className="prod-section-title">🏥 Disponible chez {pharmacies.length} pharmacie{pharmacies.length > 1 ? 's' : ''}</h3>
            {!hasStock ? (
              <div className="prod-no-stock">😢 Aucune pharmacie n'a ce produit en stock</div>
            ) : (
              <div className="prod-pharmacies">
                {pharmacies.map(av => (
                  <button
                    key={av.id}
                    className={`prod-ph-card ${selectedPh?.id === av.id ? 'selected' : ''}`}
                    onClick={() => setSelectedPh(av)}
                  >
                    <div className="prod-ph-radio">
                      {selectedPh?.id === av.id && <div className="prod-ph-radio-dot" />}
                    </div>
                    <div className="prod-ph-info">
                      <strong>{av.pharmacy.name}</strong>
                      <span>📍 {av.pharmacy.neighborhood}, {av.pharmacy.city}</span>
                    </div>
                    <div className="prod-ph-stock">
                      <span className="prod-ph-stock-num">{av.stock}</span>
                      <span>en stock</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="prod-wa-btn">
            💬 Conseil WhatsApp
          </a>
        </div>
        <div style={{ height: 160 }} />
      </div>

      {/* TOAST "Ajouté au panier" */}
      {showCartToast && (
        <div style={{
          position: 'fixed',
          bottom: 100,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1F8B4C',
          color: 'white',
          padding: '14px 20px',
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(31,139,76,0.4)',
          animation: 'slideInUp 0.3s ease-out',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
        }} onClick={goToCart}>
          <span style={{ fontSize: 20 }}>✓</span>
          <div>
            <div>Ajouté au panier !</div>
            <div style={{ fontSize: 11, opacity: 0.9, marginTop: 2 }}>Tap pour voir le panier →</div>
          </div>
        </div>
      )}

      {/* CTA avec quantité */}
      <div className="prod-cta">
        {hasStock && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12,
            marginBottom: 10,
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A' }}>Quantité :</span>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 0,
              background: '#F4F4F2',
              borderRadius: 999,
              overflow: 'hidden',
            }}>
              <button 
                onClick={() => { haptic('light'); setQty(Math.max(1, qty - 1)); }}
                disabled={qty === 1}
                style={{
                  width: 36, height: 36,
                  background: 'transparent',
                  border: 'none',
                  fontSize: 20,
                  fontWeight: 700,
                  cursor: qty === 1 ? 'not-allowed' : 'pointer',
                  color: qty === 1 ? '#CCC' : '#1F8B4C',
                  fontFamily: 'inherit',
                }}
              >
                −
              </button>
              <span style={{ 
                minWidth: 36, 
                textAlign: 'center', 
                fontWeight: 800, 
                fontSize: 15,
                color: '#1A1A1A',
              }}>
                {qty}
              </span>
              <button 
                onClick={() => { 
                  haptic('light'); 
                  setQty(qty + 1);
                }}
                style={{
                  width: 36, height: 36,
                  background: 'transparent',
                  border: 'none',
                  fontSize: 20,
                  fontWeight: 700,
                  cursor: 'pointer',
                  color: '#1F8B4C',
                  fontFamily: 'inherit',
                }}
              >
                +
              </button>
            </div>
          </div>
        )}
        
        <button className="btn-primary" onClick={addToCart} disabled={!hasStock}>
          {hasStock ? `Ajouter au panier · ${formatPrice(product.price * qty)} FCFA` : 'Indisponible'}
        </button>
      </div>
    </div>
  );
}