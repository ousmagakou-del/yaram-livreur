import { useState, useEffect, useRef, useCallback } from 'react';
import { useNav } from '../App';
import { formatPrice, getShippingZone } from '../lib/utils';
import { getCart, setCart } from '../lib/cart';
import { getMyAddresses } from '../lib/supabase';
import { buildPreorderSummary } from '../lib/preorder';
import TabBar from '../components/TabBar';
import { trackEvent } from '../lib/analytics';
import "./cart.css";

// ───────────────────────────────────────────────────────────────────
// Sub-component : Item card avec swipe-to-delete (mobile)
// On isole pour clean state du swipe (translateX, isDeleting, etc.)
// Pas de lib externe — touchstart/move/end + transform CSS.
// ───────────────────────────────────────────────────────────────────
function CartItem({ item, index, onQty, onRemove }) {
  const [translateX, setTranslateX] = useState(0);
  const [isRemoving, setIsRemoving] = useState(false);
  const [bumpKey, setBumpKey] = useState(0); // re-trigger pop sur qty
  const touchStart = useRef({ x: 0, y: 0, time: 0 });
  const isSwiping = useRef(false);
  const SWIPE_THRESHOLD = 80; // px pour declencher delete
  const MAX_SWIPE = 110;

  const handleTouchStart = useCallback((e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    // Lock direction : si plus horizontal que vertical, on swipe
    if (!isSwiping.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      isSwiping.current = true;
    }
    if (isSwiping.current && dx < 0) {
      // Clamp + rubber-band leger au-dela de MAX_SWIPE
      const clamped = Math.max(dx, -MAX_SWIPE - 20);
      setTranslateX(clamped);
    } else if (isSwiping.current && dx > 0 && translateX < 0) {
      // Permettre de revenir si deja swipe
      setTranslateX(Math.min(0, translateX + dx));
    }
  }, [translateX]);

  const handleTouchEnd = useCallback(() => {
    if (translateX <= -SWIPE_THRESHOLD) {
      // Anim de sortie puis remove
      setIsRemoving(true);
      setTranslateX(-window.innerWidth);
      setTimeout(() => onRemove(index), 260);
    } else {
      // Snap-back
      setTranslateX(0);
    }
    isSwiping.current = false;
  }, [translateX, index, onRemove]);

  const handleQty = (delta) => {
    onQty(index, delta);
    setBumpKey((k) => k + 1); // re-trigger pop animation
  };

  return (
    <div
      className={`cart-item-wrap ${isRemoving ? 'is-removing' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="cart-item-delete-bg" aria-hidden="true">
        <span className="cart-item-delete-icon">🗑</span>
        <span>Supprimer</span>
      </div>
      <div
        className="cart-item"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isSwiping.current ? 'none' : 'transform 220ms cubic-bezier(.25,.8,.25,1)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="cart-item-img-wrap">
          <img src={item.img} alt={item.name || 'Produit'} loading="lazy" decoding="async" />
          {item.is_imported && (
            <span className="cart-item-import-badge" aria-label="Produit importe">✈️</span>
          )}
        </div>
        <div className="cart-item-info">
          <div className="cart-item-brand">{item.brand}</div>
          <div className="cart-item-name">{item.name}</div>
          <div className="cart-item-price">{formatPrice(item.price)} FCFA</div>
        </div>
        <div className="cart-item-qty" key={bumpKey}>
          <button
            onClick={() => handleQty(-1)}
            aria-label="Diminuer la quantite"
            className="qty-btn qty-minus"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <span className="qty-count">{item.qty}</span>
          <button
            onClick={() => handleQty(1)}
            aria-label="Augmenter la quantite"
            className="qty-btn qty-plus"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Cart() {
  const { navigate } = useNav();
  const [items, setItems] = useState(() => getCart());
  const [defaultCity, setDefaultCity] = useState('Dakar');
  const [totalBumpKey, setTotalBumpKey] = useState(0);
  const prevTotal = useRef(null);

  // Sync si une autre vue modifie le panier (ex: badge TabBar)
  useEffect(() => {
    const onUpdate = (e) => {
      if (e?.detail?.items) setItems(e.detail.items);
      else setItems(getCart());
    };
    window.addEventListener('yaram-cart-updated', onUpdate);
    setItems(getCart());

    const handleRouteBack = (e) => {
      const target = e?.detail?.to?.name;
      if (target && target !== 'cart') return;
      setItems(getCart());
    };
    window.addEventListener('yaram-route-back', handleRouteBack);

    return () => {
      window.removeEventListener('yaram-cart-updated', onUpdate);
      window.removeEventListener('yaram-route-back', handleRouteBack);
    };
  }, []);

  // Charge l'adresse par defaut pour la zone de livraison correcte
  useEffect(() => {
    (async () => {
      try {
        const addrs = await getMyAddresses();
        const def = (addrs || []).find(a => a.is_default) || addrs?.[0];
        if (def?.city) setDefaultCity(def.city);
      } catch { /* user pas connecte, on garde Dakar */ }
    })();
  }, []);

  const updateQty = useCallback((idx, delta) => {
    setItems((curr) => {
      const next = [...curr];
      if (!next[idx]) return curr;
      next[idx] = { ...next[idx], qty: Math.max(0, (next[idx].qty || 0) + delta) };
      if (next[idx].qty === 0) next.splice(idx, 1);
      setCart(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((idx) => {
    setItems((curr) => {
      const removed = curr[idx];
      const next = curr.filter((_, i) => i !== idx);
      setCart(next);
      // ─── ANALYTICS : product_removed_from_cart ───
      try {
        if (removed) trackEvent('product_removed_from_cart', { product_id: removed.productId || removed.id });
      } catch {}
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    if (!window.confirm('Vider tout le panier ?')) return;
    setCart([]);
    setItems([]);
  }, []);

  // ─── BULLETPROOF compute (préservé tel quel)
  let grouped = {};
  let subtotal = 0;
  let zone = { zone: 'Dakar', price: 1500, freeFrom: 30000 };
  let shipping = 0;
  let total = 0;
  let preorderSummary = { isPreorder: false, breakdown: { depositAmount: 0, balanceAmount: 0 }, leadTimeDays: 1, expectedArrivalFormatted: '' };
  let isPreorder = false;

  try {
    grouped = items.reduce((acc, it) => {
      const pid = it?.pharmacyId || 'unknown';
      if (!acc[pid]) acc[pid] = { name: it?.pharmacyName || 'Pharmacie', items: [] };
      acc[pid].items.push(it);
      return acc;
    }, {});

    subtotal = items.reduce((s, it) => {
      const price = Number(it?.price) || 0;
      const qty = Number(it?.qty) || 0;
      const line = price * qty;
      return s + (Number.isFinite(line) ? line : 0);
    }, 0);
    subtotal = Number.isFinite(subtotal) ? Math.max(0, subtotal) : 0;
    zone = getShippingZone(defaultCity) || zone;
    const freeFrom = Number(zone?.freeFrom) || 0;
    const zonePrice = Number(zone?.price) || 0;
    shipping = subtotal > 0 && subtotal < freeFrom ? zonePrice : 0;
    total = Math.max(0, (Number(subtotal) || 0) + (Number(shipping) || 0));

    preorderSummary = buildPreorderSummary(items, shipping) || preorderSummary;
    isPreorder = !!preorderSummary?.isPreorder;
  } catch (e) {
    console.error('[Cart] compute error:', e);
  }

  // Pop anim sur le total quand il change
  useEffect(() => {
    if (prevTotal.current !== null && prevTotal.current !== total) {
      setTotalBumpKey((k) => k + 1);
    }
    prevTotal.current = total;
  }, [total]);

  const freeFromValue = Number(zone?.freeFrom) || 0;
  const remainingForFree = Math.max(0, freeFromValue - subtotal);
  const freeProgress = freeFromValue > 0 ? Math.min(100, (subtotal / freeFromValue) * 100) : 0;
  const showFreeProgress = subtotal > 0 && freeFromValue > 0 && subtotal < freeFromValue;

  const handleCheckout = () => {
    // Haptic leger si supporte
    try { if (navigator?.vibrate) navigator.vibrate(8); } catch { /* noop */ }
    navigate({ name: 'checkout', params: { items, total, subtotal, shipping, preorderSummary } });
  };

  // ─── ANALYTICS : cart_viewed à chaque mount (snapshot du panier au moment de la vue) ───
  useEffect(() => {
    try {
      trackEvent('cart_viewed', {
        items_count: items.length,
        total,
        has_preorder: !!isPreorder,
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) {
    return (
      <div className="cart-screen page-anim">
        <div className="cart-header cart-header-glass">
          <button className="icon-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div className="cart-header-title">
            <h1>Mon panier</h1>
          </div>
          <span className="cart-header-spacer" aria-hidden="true" />
        </div>
        <div className="cart-empty">
          <div className="cart-empty-illu">
            <div className="cart-empty-bubble" />
            <div className="cart-empty-emoji">🛒</div>
          </div>
          <h3>Ton panier est vide</h3>
          <p>Découvre notre catalogue et ajoute tes produits préférés</p>
          <button className="cart-empty-cta" onClick={() => navigate('/')}>
            Voir le catalogue
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>
        <TabBar active="cart" />
      </div>
    );
  }

  return (
    <div className="cart-screen page-anim">
      {/* ═══ Header sticky glass ═══ */}
      <div className="cart-header cart-header-glass">
        <button className="icon-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="cart-header-title">
          <h1>Mon panier</h1>
          <p>{items.length} article{items.length > 1 ? 's' : ''} · {Object.keys(grouped).length} pharmacie{Object.keys(grouped).length > 1 ? 's' : ''}</p>
        </div>
        <button className="cart-clear-btn" onClick={clearCart} aria-label="Vider le panier">
          Vider
        </button>
      </div>

      <div className="cart-scroll">
        {isPreorder && (
          <div className="cart-preorder-banner cart-fade-in">
            <div className="cart-preorder-icon">✈️</div>
            <div className="cart-preorder-text">
              <strong>Commande Import</strong>
              <p>
                Tu paies <strong>50% à la commande</strong>, le reste à l'arrivée à Dakar (environ {preorderSummary.leadTimeDays} jours).
              </p>
            </div>
          </div>
        )}

        {/* ═══ Items groupés par pharmacie ═══ */}
        {Object.entries(grouped).map(([phId, group], gIdx) => (
          <div
            key={phId}
            className="cart-group cart-fade-in"
            style={{ animationDelay: `${gIdx * 60}ms` }}
          >
            <div className="cart-group-head">
              <span className="cart-group-icon" aria-hidden="true">🏥</span>
              <span className="cart-group-name">{group.name}</span>
              <span className="cart-group-count">{group.items.length} article{group.items.length > 1 ? 's' : ''}</span>
            </div>
            <div className="cart-group-items">
              {group.items.map((it) => {
                const globalIdx = items.indexOf(it);
                return (
                  <CartItem
                    key={(it.productId || it.id || it.name) + '-' + phId}
                    item={it}
                    index={globalIdx}
                    onQty={updateQty}
                    onRemove={removeItem}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* ═══ Summary premium ═══ */}
        <div className="cart-summary cart-fade-in" style={{ animationDelay: '120ms' }}>
          <div className="cart-row">
            <span className="cart-row-label">Sous-total</span>
            <strong>{formatPrice(subtotal)} FCFA</strong>
          </div>
          <div className="cart-row">
            <span className="cart-row-label">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle', marginRight: 6}}>
                <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
              Livraison <span className="cart-zone-chip">{zone.zone}</span>
            </span>
            <strong className={shipping === 0 ? 'cart-shipping-free' : ''}>
              {shipping === 0 ? 'Gratuit' : `${formatPrice(shipping)} FCFA`}
            </strong>
          </div>

          {showFreeProgress && (
            <div className="cart-free-progress">
              <div className="cart-free-progress-label">
                <span>+{formatPrice(remainingForFree)} FCFA pour la <strong>livraison gratuite</strong></span>
              </div>
              <div className="cart-free-progress-bar">
                <div
                  className="cart-free-progress-fill"
                  style={{ width: `${freeProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="cart-row cart-row-total" key={totalBumpKey}>
            <span>Total</span>
            <strong className="cart-total-amount">{formatPrice(total)} FCFA</strong>
          </div>

          {isPreorder && (
            <div className="cart-preorder-breakdown">
              <div className="cart-row">
                <span className="cart-row-label">💳 Acompte maintenant (50%)</span>
                <strong style={{ color: '#0066CC' }}>{formatPrice(preorderSummary.breakdown.depositAmount)} FCFA</strong>
              </div>
              <div className="cart-row">
                <span className="cart-row-label">📦 Solde à l'arrivée Dakar (50%)</span>
                <strong>{formatPrice(preorderSummary.breakdown.balanceAmount)} FCFA</strong>
              </div>
              <div className="cart-preorder-eta">
                Arrivée estimée le {preorderSummary.expectedArrivalFormatted}
              </div>
            </div>
          )}
        </div>

        {Object.keys(grouped).length > 1 && (
          <div className="cart-info-banner cart-fade-in">
            <span aria-hidden="true">ℹ️</span>
            <span>Commande chez {Object.keys(grouped).length} pharmacies, livrée en une seule fois par YARAM</span>
          </div>
        )}

        <div className="cart-swipe-hint">← Glisse un article pour le supprimer</div>

        <div style={{height: 120}} />
      </div>

      {/* ═══ CTA bottom premium ═══ */}
      <div className="cart-cta">
        <button
          className="cart-cta-btn"
          onClick={handleCheckout}
          aria-label={isPreorder ? 'Payer l\'acompte' : 'Passer commande'}
        >
          <span className="cart-cta-label">
            {isPreorder ? "Payer l'acompte" : 'Passer commande'}
          </span>
          <span className="cart-cta-sep" aria-hidden="true">·</span>
          <span className="cart-cta-amount">
            {isPreorder
              ? `${formatPrice(preorderSummary.breakdown.depositAmount)} FCFA`
              : `${formatPrice(total)} FCFA`}
          </span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="cart-cta-arrow">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
