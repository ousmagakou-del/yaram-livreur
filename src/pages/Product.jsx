import { useState, useEffect, useRef, useMemo } from 'react';
import { useNav } from '../App';
import { supabase, getProductAvailability, isFavorite, toggleFavorite } from '../lib/supabase';
import { scoreClass, formatPrice, getWhatsAppNumber } from '../lib/utils';
import { haptic } from '../lib/haptic';
import { addToCart as cartAddToCart } from '../lib/cart';
import { toast } from '../lib/toast';
import { usePageSEO, useJsonLd } from '../lib/seo';
import { trackEvent } from '../lib/analytics';
import ProductTile from '../components/ProductTile';
import ReviewsSection from '../components/ReviewsSection';
import PullToRefresh from '../components/PullToRefresh';
import './Product.css';

// Skeleton premium qui matche la nouvelle structure (galerie + info card)
function ProductSkeleton() {
  const sk = { background: 'linear-gradient(90deg, #F4F4F2 0%, #EAEAE7 50%, #F4F4F2 100%)', backgroundSize: '200% 100%', animation: 'yaramShimmer 1.4s ease-in-out infinite', borderRadius: 8 };
  return (
    <div className="prod-screen page-anim">
      <style>{`@keyframes yaramShimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
      <div className="prod-header prod-header--transparent">
        <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
          <div style={{ ...sk, width: 40, height: 40, borderRadius: '50%' }} />
        </div>
      </div>
      <div className="prod-scroll">
        <div style={{ ...sk, width: '100%', aspectRatio: '1/1', borderRadius: 0 }} />
        <div className="prod-info">
          <div style={{ ...sk, width: 90, height: 12, marginBottom: 10 }} />
          <div style={{ ...sk, width: '85%', height: 26, marginBottom: 10 }} />
          <div style={{ ...sk, width: 140, height: 16, marginBottom: 16 }} />
          <div style={{ ...sk, width: 200, height: 32, marginBottom: 24 }} />
          <div style={{ ...sk, width: '100%', height: 60, marginBottom: 14, borderRadius: 14 }} />
          <div style={{ ...sk, width: '100%', height: 60, marginBottom: 14, borderRadius: 14 }} />
          <div style={{ ...sk, width: '100%', height: 60, borderRadius: 14 }} />
        </div>
      </div>
    </div>
  );
}

// Section collapsible premium (smooth height transition via max-height)
function Collapse({ title, icon, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef(null);
  return (
    <div className={`prod-collapse ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="prod-collapse-head"
        onClick={() => { haptic('light'); setOpen(o => !o); }}
        aria-expanded={open}
      >
        <span className="prod-collapse-title">
          {icon && <span className="prod-collapse-icon" aria-hidden>{icon}</span>}
          {title}
        </span>
        <svg className="prod-collapse-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div
        ref={bodyRef}
        className="prod-collapse-body"
        style={{ maxHeight: open ? (bodyRef.current?.scrollHeight ? bodyRef.current.scrollHeight + 40 : 2000) : 0 }}
      >
        <div className="prod-collapse-inner">{children}</div>
      </div>
    </div>
  );
}

export default function Product({ id }) {
  const { navigate } = useNav();
  const [product, setProduct] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPh, setSelectedPh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fav, setFav] = useState(false);
  const [favAnim, setFavAnim] = useState(false);
  const [qty, setQty] = useState(1);
  const [showCartToast, setShowCartToast] = useState(false);
  const [flashSuccess, setFlashSuccess] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [topReviews, setTopReviews] = useState([]);
  const [similar, setSimilar] = useState([]);

  const scrollRef = useRef(null);
  const galleryTrackRef = useRef(null);

  // SEO
  usePageSEO({
    title: product ? `${product.brand} — ${product.name} · YARAM` : 'Produit · YARAM',
    description: product
      ? `${product.short_desc || product.name} · Score YARAM ${product.score}/100 · ${(product.price || 0).toLocaleString('fr-FR')} FCFA · Livraison Dakar`
      : undefined,
    canonical: `https://yaram.app/product/${id}`,
  });

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

  // Fetch produit + pharmacies + similaires + top reviews
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProduct(null);
    setPharmacies([]);
    setSelectedPh(null);
    setSimilar([]);
    setTopReviews([]);
    setGalleryIdx(0);

    (async () => {
      try {
        const { data: p, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (cancelled) return;
        if (error || !p) { setProduct(null); return; }
        setProduct(p);

        // ─── ANALYTICS : product_viewed ───
        try {
          trackEvent('product_viewed', {
            product_id: p.id,
            name: p.name,
            brand: p.brand,
            price: p.price,
            category: p.category,
          });
        } catch {}

        const [av, isFav] = await Promise.all([
          getProductAvailability(p.id).catch(() => []),
          isFavorite(p.id).catch(() => false),
        ]);
        if (cancelled) return;
        setPharmacies(av || []);
        setFav(isFav);
        if (av && av.length > 0) setSelectedPh(av[0]);

        // Produits similaires (meme categorie OU meme brand en fallback)
        if (p.category) {
          const { data: sim } = await supabase
            .from('products')
            .select('id, name, brand, img, price, rating, score, review_count')
            .eq('category', p.category)
            .eq('active', true)
            .neq('id', p.id)
            .order('review_count', { ascending: false })
            .limit(8);
          if (!cancelled) setSimilar(sim || []);
        }

        // Top 3 reviews (best-effort, ignore si table absente)
        try {
          const { data: rev } = await supabase
            .from('reviews')
            .select('id, rating, comment, user_name, created_at')
            .eq('product_id', p.id)
            .order('rating', { ascending: false })
            .limit(3);
          if (!cancelled && rev) setTopReviews(rev);
        } catch (_) { /* table reviews optionnelle */ }
      } catch (e) {
        console.warn('[Product] load failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const safety = setTimeout(() => { if (!cancelled) setLoading(false); }, 15000);
    return () => { cancelled = true; clearTimeout(safety); };
  }, [id]);

  // Scroll listener pour header glass + sticky CTA reveal
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const y = el.scrollTop;
      setScrolled(y > 60);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [product]);

  // Construit la galerie : array d'images (priorité product.images, fallback img)
  const galleryImages = useMemo(() => {
    if (!product) return [];
    if (Array.isArray(product.images) && product.images.length > 0) {
      return product.images.filter(Boolean);
    }
    return [product.img].filter(Boolean);
  }, [product]);

  // Synchronise galleryIdx avec scroll horizontal de la galerie
  useEffect(() => {
    const track = galleryTrackRef.current;
    if (!track) return;
    const onScroll = () => {
      const w = track.clientWidth || 1;
      const i = Math.round(track.scrollLeft / w);
      setGalleryIdx(i);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [galleryImages.length]);

  const goToImage = (i) => {
    const track = galleryTrackRef.current;
    if (!track) return;
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  };

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
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success('Lien copié ! Partage-le avec tes amies 💚');
      }
    } catch (e) { /* canceled */ }
  };

  const addToCart = () => {
    if (!product.is_imported && !selectedPh) {
      toast.error('Sélectionne une pharmacie');
      return;
    }
    const result = cartAddToCart({
      product,
      pharmacy: product.is_imported
        ? { id: 'yaram-import', name: 'YARAM (import direct)', city: 'Dakar' }
        : selectedPh.pharmacy,
      qty,
    });
    if (!result.success) { toast.error(result.error || 'Erreur panier'); return; }
    // ─── ANALYTICS : product_added_to_cart ───
    try {
      trackEvent('product_added_to_cart', {
        product_id: product.id,
        name: product.name,
        price: product.price,
        qty,
        pharmacy_id: product.is_imported ? 'yaram-import' : selectedPh?.pharmacy?.id,
      });
    } catch {}
    haptic('success');
    setFlashSuccess(true);
    setShowCartToast(true);
    setTimeout(() => setFlashSuccess(false), 900);
    setTimeout(() => setShowCartToast(false), 2500);
  };

  const goToCart = () => { setShowCartToast(false); navigate('/cart'); };

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
  const hasStock = product.is_imported ? true : pharmacies.length > 0;
  const waUrl = `https://wa.me/${getWhatsAppNumber()}?text=` + encodeURIComponent("Bonjour, j'ai une question sur " + product.name);

  const isTopSeller = (product.review_count || 0) >= 500;
  const isNew = product.created_at && (Date.now() - new Date(product.created_at).getTime()) < 30 * 24 * 60 * 60 * 1000;
  const safePrice = Number(product.price) || 0;
  const safeOldPrice = Number(product.old_price) || 0;
  const hasOldPrice = safeOldPrice > 0 && safeOldPrice > safePrice;
  const discount = hasOldPrice ? Math.round(((safeOldPrice - safePrice) / safeOldPrice) * 100) : 0;
  const totalPrice = safePrice * (Number(qty) || 1);

  const stars = [1, 2, 3, 4, 5].map(i => {
    const full = product.rating >= i;
    const half = product.rating >= i - 0.5 && product.rating < i;
    return (
      <span key={i} className="prod-star" style={{ color: full || half ? '#F4B53A' : '#E2E2DE' }}>★</span>
    );
  });

  // Avantages clés (parse depuis product.key_benefits si array, sinon fallback default)
  const benefits = Array.isArray(product.key_benefits) && product.key_benefits.length > 0
    ? product.key_benefits
    : (product.badges && product.badges.length > 0 ? product.badges : null);

  const handlePullRefresh = async () => {
    try {
      const { data: p } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
      if (p) {
        setProduct(p);
        const av = await getProductAvailability(p.id).catch(() => []);
        setPharmacies(av || []);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) { console.warn('[Product] pull refresh failed:', e?.message); }
  };

  return (
    <div className="prod-screen page-anim">
      {/* HEADER : transparent en haut, glass sticky au scroll */}
      <div className={`prod-header ${scrolled ? 'prod-header--glass' : 'prod-header--transparent'}`}>
        <button className="prod-icon-btn" onClick={() => { haptic('light'); navigate(-1); }} aria-label="Retour">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>

        {scrolled && (
          <div className="prod-header-title" aria-hidden>
            <div className="prod-header-brand">{product.brand}</div>
            <div className="prod-header-name">{product.name}</div>
          </div>
        )}

        <div className="prod-header-actions">
          <button
            className={`prod-icon-btn ${fav ? 'is-fav' : ''}`}
            onClick={handleFav}
            aria-label={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            style={{ animation: favAnim ? 'heartPulse 0.6s ease-out' : 'none' }}
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill={fav ? '#D9342B' : 'none'} stroke={fav ? '#D9342B' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
          </button>
          <button className="prod-icon-btn" onClick={handleShare} aria-label="Partager">
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="prod-scroll" ref={scrollRef}>
        <PullToRefresh onRefresh={handlePullRefresh}>

        {/* ────────── GALERIE IMMERSIVE ────────── */}
        <div className="prod-gallery">
          <div className="prod-gallery-track" ref={galleryTrackRef}>
            {galleryImages.map((src, i) => (
              <div key={i} className="prod-gallery-slide">
                <img src={src} alt={`${product.name} — ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} />
              </div>
            ))}
          </div>

          {/* Score badge */}
          <div className={`prod-score ${sc}`}>
            <div className="prod-score-num">{product.score}</div>
            <div className="prod-score-lbl">/100</div>
          </div>

          {/* Badges promo / top / new */}
          <div className="prod-floating-badges">
            {isTopSeller && <div className="prod-fb prod-fb--hot">🔥 Top vente</div>}
            {isNew && <div className="prod-fb prod-fb--new">✨ Nouveau</div>}
            {discount > 0 && <div className="prod-fb prod-fb--promo">-{discount}%</div>}
          </div>

          {/* Indicateurs (dots) */}
          {galleryImages.length > 1 && (
            <div className="prod-gallery-dots">
              {galleryImages.map((_, i) => (
                <button
                  key={i}
                  className={`prod-gallery-dot ${i === galleryIdx ? 'is-active' : ''}`}
                  onClick={() => goToImage(i)}
                  aria-label={`Image ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* ────────── INFO CARD ────────── */}
        <div className="prod-info">
          {/* Breadcrumb */}
          <nav aria-label="Fil d'Ariane" className="prod-breadcrumb">
            <button onClick={() => navigate('/')}>Accueil</button>
            {product.category && (
              <>
                <span aria-hidden>›</span>
                <button onClick={() => navigate({ name: 'search', params: { category: product.category } })} style={{ textTransform: 'capitalize' }}>{product.category}</button>
              </>
            )}
            <span aria-hidden>›</span>
            <span className="prod-breadcrumb-current">{product.name}</span>
          </nav>

          <div className="prod-brand">{product.brand}</div>
          <h1 className="prod-name">{product.name}</h1>

          <div className="prod-rating">
            <div className="prod-stars">{stars}</div>
            <span className="prod-rating-num">{product.rating}</span>
            <span className="prod-rating-count">· {product.review_count} avis</span>
          </div>

          {/* Prix */}
          <div className="prod-price">
            <strong>{formatPrice(product.price)}</strong>
            <small>FCFA</small>
            {hasOldPrice && (
              <span className="prod-price-old">{formatPrice(product.old_price)} FCFA</span>
            )}
          </div>

          {/* Import badge */}
          {product.is_imported && (
            <div className="prod-import-badge">
              <span className="prod-import-icon">✈️</span>
              <div>
                <strong>Import {product.lead_time_days || 15}j</strong>
                <span>Expédié par YARAM · 50% à la commande</span>
              </div>
            </div>
          )}

          {/* Pharmacie + lien (uniquement si pas import) */}
          {!product.is_imported && hasStock && selectedPh && (
            <div className="prod-pharma-line">
              <span className="prod-pharma-pin">📍</span>
              <div className="prod-pharma-info">
                <strong>{selectedPh.pharmacy.name}</strong>
                <span>{selectedPh.pharmacy.neighborhood}, {selectedPh.pharmacy.city} · {selectedPh.stock} en stock</span>
              </div>
              {pharmacies.length > 1 && (
                <button className="prod-pharma-change" onClick={() => {
                  haptic('light');
                  const next = pharmacies[(pharmacies.findIndex(p => p.id === selectedPh.id) + 1) % pharmacies.length];
                  setSelectedPh(next);
                }}>Changer</button>
              )}
            </div>
          )}
          {!product.is_imported && !hasStock && (
            <div className="prod-no-stock-pill">😢 Aucune pharmacie en stock</div>
          )}

          {/* ────────── QUANTITE + ADD TO CART (inline) ────────── */}
          <div className="prod-buy-row">
            <div className="prod-qty">
              <button
                onClick={() => { haptic('light'); setQty(Math.max(1, qty - 1)); }}
                disabled={qty === 1}
                aria-label="Diminuer"
              >−</button>
              <span>{qty}</span>
              <button
                onClick={() => { haptic('light'); setQty(qty + 1); }}
                aria-label="Augmenter"
              >+</button>
            </div>
            <button
              className={`prod-add-btn ${flashSuccess ? 'is-success' : ''}`}
              onClick={addToCart}
              disabled={!hasStock}
            >
              {flashSuccess ? (
                <span className="prod-add-check">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Ajouté !
                </span>
              ) : !hasStock ? (
                'Indisponible'
              ) : product.is_imported ? (
                <>✈️ Précommander · <b>{formatPrice(totalPrice)}</b> FCFA</>
              ) : (
                <>Ajouter · <b>{formatPrice(totalPrice)}</b> FCFA</>
              )}
            </button>
          </div>

          {/* ────────── SECTIONS COLLAPSE ────────── */}
          <div className="prod-collapses">
            {product.long_desc && (
              <Collapse title="Description" icon="📝" defaultOpen={true}>
                <p className="prod-prose">{product.long_desc}</p>
                {product.reason && (
                  <div className="prod-reason">
                    💡 <strong>Pourquoi pour toi :</strong> {product.reason}
                  </div>
                )}
              </Collapse>
            )}

            {(product.composition || product.inci) && (
              <Collapse title="Composition / INCI" icon="🧪">
                <p className="prod-prose prod-prose--mono">
                  {product.composition || product.inci}
                </p>
              </Collapse>
            )}

            {(product.usage || product.how_to_use) && (
              <Collapse title="Mode d'emploi" icon="📖">
                <p className="prod-prose">{product.usage || product.how_to_use}</p>
              </Collapse>
            )}

            {benefits && benefits.length > 0 && (
              <Collapse title="Avantages clés" icon="✨" defaultOpen={true}>
                <ul className="prod-benefits">
                  {benefits.map((b, i) => (
                    <li key={i} style={{ animationDelay: `${i * 60}ms` }}>
                      <span className="prod-benefit-check">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </Collapse>
            )}

            <Collapse title={`Avis clients ${product.review_count ? `(${product.review_count})` : ''}`} icon="⭐">
              {topReviews.length > 0 ? (
                <>
                  <div className="prod-top-reviews">
                    {topReviews.map(r => (
                      <div key={r.id} className="prod-review-card">
                        <div className="prod-review-head">
                          <strong>{r.user_name || 'Cliente YARAM'}</strong>
                          <span className="prod-review-stars">
                            {[1,2,3,4,5].map(i => (
                              <span key={i} style={{ color: r.rating >= i ? '#F4B53A' : '#E2E2DE' }}>★</span>
                            ))}
                          </span>
                        </div>
                        <p>{r.comment}</p>
                      </div>
                    ))}
                  </div>
                  <ReviewsSection productId={product.id} />
                </>
              ) : (
                <ReviewsSection productId={product.id} />
              )}
            </Collapse>
          </div>

          {/* WhatsApp */}
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="prod-wa-btn">
            💬 Conseil WhatsApp
          </a>

          {/* ────────── TU POURRAIS AIMER (carrousel horizontal) ────────── */}
          {similar.length > 0 && (
            <section className="prod-similar">
              <div className="prod-similar-head">
                <h3 className="prod-section-title">✨ Tu pourrais aimer</h3>
                <p className="prod-similar-sub">
                  {product.category ? `Dans ${product.category}` : 'Sélection pour toi'}
                </p>
              </div>
              <div className="prod-similar-track">
                {similar.map((p, i) => (
                  <div key={p.id} className="prod-similar-card" style={{ animationDelay: `${i * 70}ms` }}>
                    <ProductTile product={p} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div style={{ height: 140 }} />
        </PullToRefresh>
      </div>

      {/* TOAST "Ajouté au panier" */}
      {showCartToast && (
        <div className="prod-cart-toast" onClick={goToCart}>
          <span className="prod-cart-toast-check">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          <div>
            <div>Ajouté au panier !</div>
            <div className="prod-cart-toast-sub">Tap pour voir le panier →</div>
          </div>
        </div>
      )}

      {/* ────────── STICKY BOTTOM CTA BAR ────────── */}
      <div className={`prod-sticky-cta ${scrolled ? 'is-visible' : ''}`}>
        <div className="prod-sticky-price">
          <small>Total</small>
          <strong>{formatPrice(totalPrice)} <em>FCFA</em></strong>
        </div>
        <button
          className={`prod-sticky-btn ${flashSuccess ? 'is-success' : ''}`}
          onClick={addToCart}
          disabled={!hasStock}
        >
          {flashSuccess ? (
            <>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Ajouté
            </>
          ) : !hasStock ? 'Indisponible' : product.is_imported ? '✈️ Précommander' : 'Ajouter'}
        </button>
      </div>

      <style>{`
        @keyframes heartPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }
        @keyframes slideInUp {
          from { transform: translate(-50%, 30px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes flashSuccess {
          0% { background: #1F8B4C; }
          40% { background: #16A34A; box-shadow: 0 0 0 6px rgba(31,139,76,0.18); }
          100% { background: #1F8B4C; box-shadow: 0 0 0 0 rgba(31,139,76,0); }
        }
        @keyframes benefitIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes similarIn {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
