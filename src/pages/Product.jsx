import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { supabase, getProductAvailability, isFavorite, toggleFavorite } from '../lib/supabase';
import { scoreClass, formatPrice, getWhatsAppNumber } from '../lib/utils';
import { haptic } from '../lib/haptic';
import { addToCart as cartAddToCart } from '../lib/cart';
import { toast } from '../lib/toast';
import { usePageSEO, useJsonLd } from '../lib/seo';
import ProductTile from '../components/ProductTile';
import ReviewsSection from '../components/ReviewsSection';
import PullToRefresh from '../components/PullToRefresh';
import './Product.css';

// Skeleton qui matche la structure de la fiche produit pour eviter le flash
// "Chargement…" generique. Donne l'impression que la page se construit.
function ProductSkeleton() {
  const sk = { background: 'linear-gradient(90deg, #F4F4F2 0%, #EAEAE7 50%, #F4F4F2 100%)', backgroundSize: '200% 100%', animation: 'yaramShimmer 1.4s ease-in-out infinite', borderRadius: 8 };
  return (
    <div className="prod-screen page-anim">
      <style>{`@keyframes yaramShimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div className="prod-header">
        <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
          <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
          <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
        </div>
      </div>
      <div className="prod-scroll">
        <div style={{ ...sk, width: '100%', aspectRatio: '1/1', borderRadius: 0 }} />
        <div className="prod-info">
          <div style={{ ...sk, width: 90, height: 12, marginBottom: 8 }} />
          <div style={{ ...sk, width: '85%', height: 22, marginBottom: 8 }} />
          <div style={{ ...sk, width: '70%', height: 14, marginBottom: 16 }} />
          <div style={{ ...sk, width: 140, height: 16, marginBottom: 14 }} />
          <div style={{ ...sk, width: 180, height: 28, marginBottom: 24 }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <div style={{ ...sk, width: 80, height: 24, borderRadius: 999 }} />
            <div style={{ ...sk, width: 90, height: 24, borderRadius: 999 }} />
            <div style={{ ...sk, width: 70, height: 24, borderRadius: 999 }} />
          </div>
          <div style={{ ...sk, width: '100%', height: 80, marginBottom: 16 }} />
          <div style={{ ...sk, width: '60%', height: 18, marginBottom: 10 }} />
          <div style={{ ...sk, width: '100%', height: 70, marginBottom: 8 }} />
          <div style={{ ...sk, width: '100%', height: 70 }} />
        </div>
      </div>
    </div>
  );
}

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
  // Produits similaires (meme categorie, exclu le produit courant) — interne linking SEO
  const [similar, setSimilar] = useState([]);

  // SEO : titre + meta description + canonical
  usePageSEO({
    title: product ? `${product.brand} — ${product.name} · YARAM` : 'Produit · YARAM',
    description: product
      ? `${product.short_desc || product.name} · Score YARAM ${product.score}/100 · ${(product.price || 0).toLocaleString('fr-FR')} FCFA · Livraison Dakar`
      : undefined,
    canonical: `https://yaram.app/product/${id}`,
  });

  // Schema.org Product → rich snippets Google (prix, rating, dispo)
  useJsonLd(product ? {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.name,
    image: product.img,
    description: product.short_desc || product.long_desc,
    brand: { '@type': 'Brand', name: product.brand },
    sku: product.id,
    aggregateRating: (product.rating > 0 && product.review_count > 0) ? {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.review_count,
    } : undefined,
    offers: {
      '@type': 'Offer',
      url: `https://yaram.app/product/${id}`,
      priceCurrency: 'XOF',
      price: product.price,
      availability: pharmacies.length > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  } : null, `product-${id}`);

  // Schema.org BreadcrumbList → Google affiche le fil d'Ariane dans les SERP
  useJsonLd(product ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://yaram.app/' },
      ...(product.category ? [{
        '@type': 'ListItem',
        position: 2,
        name: product.category.charAt(0).toUpperCase() + product.category.slice(1),
        item: `https://yaram.app/search?category=${encodeURIComponent(product.category)}`,
      }] : []),
      { '@type': 'ListItem', position: product.category ? 3 : 2, name: product.name, item: `https://yaram.app/product/${id}` },
    ],
  } : null, `breadcrumb-${id}`);

  // Schema.org ItemList → les produits similaires aident Google a indexer plus de URLs
  useJsonLd(similar.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Produits similaires',
    itemListElement: similar.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `https://yaram.app/product/${p.id}`,
      name: p.name,
    })),
  } : null, `similar-${id}`);

  useEffect(() => {
    let cancelled = false;
    // Reset l'etat a chaque navigation vers un nouveau produit
    setLoading(true);
    setProduct(null);
    setPharmacies([]);
    setSelectedPh(null);
    setSimilar([]);

    (async () => {
      try {
        // Fetch UN seul produit (avant on telechargeait les 800+ pour en garder 1)
        const { data: p, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (cancelled) return;
        if (error || !p) {
          setProduct(null);
          return;
        }
        setProduct(p);
        const [av, isFav] = await Promise.all([
          getProductAvailability(p.id).catch(() => []),
          isFavorite(p.id).catch(() => false),
        ]);
        if (cancelled) return;
        setPharmacies(av || []);
        setFav(isFav);
        if (av && av.length > 0) setSelectedPh(av[0]);

        // ─── Produits similaires (meme categorie) ───
        // Boost SEO (internal linking) + dwell time + conversion
        if (p.category) {
          const { data: sim } = await supabase
            .from('products')
            .select('id, name, brand, img, price, rating, score, review_count')
            .eq('category', p.category)
            .eq('active', true)
            .neq('id', p.id)
            .order('review_count', { ascending: false })
            .limit(4);
          if (!cancelled) setSimilar(sim || []);
        }
      } catch (e) {
        console.warn('[Product] load failed:', e?.message);
      } finally {
        // setLoading(false) TOUJOURS, meme si erreur, pour ne pas rester sur le skeleton
        if (!cancelled) setLoading(false);
      }
    })();

    // Filet de securite : si le useEffect entier rame > 15s (ex: connexion morte),
    // on debloque le skeleton pour que l'user puisse au moins voir l'erreur / revenir.
    const safety = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
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
        toast.success('Lien copié ! Partage-le avec tes amies 💚');
      }
    } catch (e) {
      console.log('Share canceled');
    }
  };

  const addToCart = () => {
    // Pour les produits import : pas besoin de sélectionner une pharmacie,
    // c'est expédié par YARAM directement après import.
    if (!product.is_imported && !selectedPh) {
      toast.error('Sélectionne une pharmacie');
      return;
    }
    // Passe par lib/cart.js : dispatch yaram-cart-updated (badge TabBar)
    // + set le timestamp pour la notif WhatsApp "panier abandonne" (24h).
    const result = cartAddToCart({
      product,
      pharmacy: product.is_imported
        ? { id: 'yaram-import', name: 'YARAM (import direct)', city: 'Dakar' }
        : selectedPh.pharmacy,
      qty,
    });
    if (!result.success) {
      toast.error(result.error || 'Erreur panier');
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

  if (loading) return <ProductSkeleton />;

  if (!product) {
    return (
      <div style={{padding: 40, textAlign: 'center'}}>
        <p>Produit introuvable</p>
        <button className="btn-primary" onClick={() => navigate('/')} style={{ marginTop: 20 }}>Retour</button>
      </div>
    );
  }

  const sc = scoreClass(product.score);
  // Pour les produits IMPORT (preorder) : pas besoin de stock local, c'est commandé sur demande.
  // Pour les produits classiques : doit être dispo dans au moins 1 pharmacie.
  const hasStock = product.is_imported ? true : pharmacies.length > 0;
  const waUrl = `https://wa.me/${getWhatsAppNumber()}?text=` + encodeURIComponent("Bonjour, j'ai une question sur " + product.name);
  
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

  // Pull-to-refresh : refetch produit + dispos pharmacies + avis
  const handlePullRefresh = async () => {
    try {
      const { data: p } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (p) {
        setProduct(p);
        const av = await getProductAvailability(p.id).catch(() => []);
        setPharmacies(av || []);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn('[Product] pull refresh failed:', e?.message);
    }
  };

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
        <PullToRefresh onRefresh={handlePullRefresh}>
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
          {/* ────── Breadcrumb visuel + JSON-LD couvert plus haut ────── */}
          <nav aria-label="Fil d'Ariane" style={{
            fontSize: 11,
            color: 'var(--ink-soft)',
            marginBottom: 6,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}>
            <button
              onClick={() => navigate('/')}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
            >Accueil</button>
            {product.category && (
              <>
                <span aria-hidden="true">›</span>
                <button
                  onClick={() => navigate({ name: 'search', params: { category: product.category } })}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 'inherit', textTransform: 'capitalize' }}
                >{product.category}</button>
              </>
            )}
            <span aria-hidden="true">›</span>
            <span style={{ color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
              {product.name}
            </span>
          </nav>

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
            {product.is_imported ? (
              <>
                <h3 className="prod-section-title">🌍 Vendu et expédié par YARAM</h3>
                <div style={{
                  background: 'linear-gradient(135deg, rgba(0,102,204,0.06) 0%, rgba(0,102,204,0.02) 100%)',
                  border: '1px solid rgba(0,102,204,0.2)',
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: 24 }}>✈️</span>
                  <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
                    <strong style={{ color: '#0066CC', display: 'block', marginBottom: 4 }}>
                      Import direct YARAM · Livraison sous {product.lead_time_days || 15}j
                    </strong>
                    <span style={{ color: 'var(--muted)' }}>
                      Tu paies <b>50% à la commande</b>, le reste à l'arrivée à Dakar.
                      On t'avertit à chaque étape (commande, transit, arrivée).
                    </span>
                  </div>
                </div>
              </>
            ) : (
            <>
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
            </>
            )}
          </div>

          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="prod-wa-btn">
            💬 Conseil WhatsApp
          </a>

          {/* ────── Produits similaires (boost SEO + dwell time + conversion) ────── */}
          {similar.length > 0 && (
            <section className="prod-section" style={{ marginTop: 28 }}>
              <h3 className="prod-section-title">
                ✨ Tu pourrais aussi aimer
              </h3>
              <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: -4, marginBottom: 12 }}>
                {product.category ? `Dans la catégorie ${product.category}` : 'Dans le même style'}
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 10,
              }}>
                {similar.map(p => <ProductTile key={p.id} product={p} />)}
              </div>
            </section>
          )}
        </div>
        <div style={{ height: 160 }} />
        </PullToRefresh>
      </div>

      {/* TOAST "Ajouté au panier" (top-level, fixed position) */}
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

      {/* CTA avec quantité (HORS prod-scroll : reste fixe en bas) */}
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
          {!hasStock
            ? 'Indisponible'
            : product.is_imported
              ? `✈️ Précommander · ${formatPrice(product.price * qty)} FCFA`
              : `Ajouter au panier · ${formatPrice(product.price * qty)} FCFA`}
        </button>
      </div>
    </div>
  );
}