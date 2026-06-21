import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { createOrder, getMyAddresses, validatePromoCode, applyPromoCode } from '../lib/supabase';
import { sendEmail, sendOrderEmail } from '../lib/emails';
import { formatPrice, getShippingZone } from '../lib/utils';
import { getPendingPromo, clearPendingPromo, getLoyaltyCredit, clearLoyaltyCredit } from '../lib/promoStorage';
import { getCart, clearCart } from '../lib/cart';
import { buildPreorderSummary } from '../lib/preorder';
import { toast } from '../lib/toast';
import { trackEvent } from '../lib/analytics';
import './Checkout.css';

// ─── URLs des logos paiement (Supabase Storage) ───
const WAVE_LOGO = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/logo-wave.jpg';
const OM_LOGO   = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/logo-orange.png';

// ─── Modes de paiement (module-level, JAMAIS dans le component) ───
// AVANT : déclaré dans le component. Conséquence catastrophique : un useEffect
// au-dessus de la déclaration référençait ALL_PAYMENT_METHODS dans son corps ET
// `isPreorder` dans son dep array, déclenchant un TDZ "Cannot access K before
// initialization" au render → CRASH écran blanc sur Checkout (#bug du panier).
// En sortant la const ici, plus aucune référence avant initialization.
const ALL_PAYMENT_METHODS = [
  { id: 'wave',    name: 'Wave',                          logoUrl: WAVE_LOGO, fallbackIcon: '🌊', enabled: true,  preorderOk: true  },
  { id: 'cod',     name: 'Cash à la livraison',           fallbackIcon: '💵',                     enabled: true,  preorderOk: false },
  { id: 'om',      name: 'Orange Money',                  logoUrl: OM_LOGO,   fallbackIcon: '🟠', enabled: false, preorderOk: true  },
  { id: 'paytech', name: 'PayTech (Wave + OM + Carte)',   fallbackIcon: '🔒',                     enabled: false, preorderOk: true  },
  { id: 'card',    name: 'Carte bancaire',                fallbackIcon: '💳',                     enabled: false, preorderOk: true  },
];

export default function Checkout({ items: propsItems, paymentMethod }) {
  const { navigate } = useNav();
  const { user } = useUser();

  // ─── Fallback panier : si pas d'items en props (reload F5), prend localStorage ───
  const [items, setItems] = useState(() => {
    if (Array.isArray(propsItems) && propsItems.length > 0) return propsItems;
    const fromCart = getCart();
    return Array.isArray(fromCart) ? fromCart : [];
  });

  // Si les props items changent (navigation classique), update
  useEffect(() => {
    if (Array.isArray(propsItems) && propsItems.length > 0) {
      setItems(propsItems);
    }
  }, [propsItems]);

  const [addresses, setAddresses] = useState([]);
  const [selectedAddrId, setSelectedAddrId] = useState(null);
  const [payment, setPayment] = useState(paymentMethod || 'wave');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // ─── Promo code ───
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoMsg, setPromoMsg] = useState({ text: '', kind: '' });
  const [promoShake, setPromoShake] = useState(false);

  // ─── Loyalty credit ───
  const [loyaltyCredit, setLoyaltyCredit] = useState(0);
  const [useLoyaltyCredit, setUseLoyaltyCredit] = useState(false);

  // ─── Address switch highlight ───
  const [addrFlash, setAddrFlash] = useState(null);

  // ─── Load addresses + pending promo + loyalty credit ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const addrs = await getMyAddresses();
        if (cancelled) return;
        const list = addrs || [];
        setAddresses(list);
        const def = list.find(a => a.is_default) || list[0];
        if (def) setSelectedAddrId(def.id);
      } catch (e) {
        console.warn('[Checkout] addresses load failed:', e?.message);
        if (!cancelled) setAddresses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }

      try {
        const pending = getPendingPromo();
        if (pending && !cancelled) {
          setPromoInput(pending);
          setTimeout(() => { if (!cancelled) tryApplyPromo(pending, true); }, 500);
        }
        const credit = getLoyaltyCredit();
        if (credit > 0 && !cancelled) {
          setLoyaltyCredit(credit);
          setUseLoyaltyCredit(true);
        }
      } catch (e) {
        console.warn('[Checkout] promo/loyalty load failed:', e?.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Panier vide ? ───
  if (!items || items.length === 0) {
    return (
      <div className="check-screen page-anim">
        <div className="check-header-glass">
          <button className="icon-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <div className="check-header-title">
            <h1>Commande</h1>
          </div>
          <div style={{width: 40}} />
        </div>
        <div className="check-empty">
          <div className="check-empty-icon">🛒</div>
          <p className="check-empty-text">Ton panier est vide</p>
          <button className="btn-primary check-empty-cta" onClick={() => navigate('/')}>
            Découvrir les produits →
          </button>
        </div>
      </div>
    );
  }

  // SAFETY : addresses peut être null/empty ; selectedAddrId peut être undefined
  const selectedAddr = addresses?.find(a => a.id === selectedAddrId) || addresses?.[0] || null;
  // SAFETY : price/qty peuvent être null/string ; éviter NaN qui propage partout.
  const subtotalRaw = items.reduce((s, it) => {
    const price = Number(it?.price) || 0;
    const qty = Number(it?.qty) || 0;
    const line = price * qty;
    return s + (Number.isFinite(line) ? line : 0);
  }, 0);
  const subtotal = Number.isFinite(subtotalRaw) ? Math.max(0, subtotalRaw) : 0;
  const zone = getShippingZone(selectedAddr?.city || 'Dakar') || { zone: 'Dakar', price: 1500, freeFrom: 30000, delay: '24h' };
  const zoneFreeFrom = Number(zone?.freeFrom) || 0;
  const zonePrice = Number(zone?.price) || 0;
  const shipping = subtotal >= zoneFreeFrom && zoneFreeFrom > 0 ? 0 : zonePrice;

  const promoDiscount = Number(appliedPromo?.discount) || 0;
  // SAFETY : loyaltyCredit > (subtotal + shipping - promoDiscount) sinon le total
  // descendrait en négatif. On clamp à >= 0 AVANT d'appliquer la fidélité.
  const totalBeforeLoyalty = Math.max(0, subtotal + shipping - promoDiscount);
  const loyaltyDiscount = useLoyaltyCredit
    ? Math.max(0, Math.min(Number(loyaltyCredit) || 0, totalBeforeLoyalty))
    : 0;
  // Final clamp : total >= 0 toujours, jamais NaN.
  const totalRaw = subtotal + shipping - promoDiscount - loyaltyDiscount;
  const total = Number.isFinite(totalRaw) ? Math.max(0, totalRaw) : 0;

  // ─── Preorder (Import) : détection + breakdown 50/50 ───
  const preorderSummary = buildPreorderSummary(items, shipping);
  const isPreorder = preorderSummary.isPreorder;

  // Force payment fallback à 'wave' si la sélection actuelle n'est plus disponible
  useEffect(() => {
    const stillValid = ALL_PAYMENT_METHODS.find(m => m.id === payment);
    if (!stillValid || !stillValid.enabled) {
      setPayment('wave');
      return;
    }
    if (isPreorder && !stillValid.preorderOk) {
      setPayment('wave');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreorder, payment]);

  // Si preorder : on facture l'acompte 50% maintenant.
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const depositAmount = isPreorder
    ? Math.round((safeTotal * 50) / 100)
    : safeTotal;
  const balanceAmount = isPreorder ? Math.max(0, safeTotal - depositAmount) : 0;
  const amountToPayNow = isPreorder ? depositAmount : safeTotal;

  const grouped = items.reduce((acc, it) => {
    if (!acc[it.pharmacyId]) acc[it.pharmacyId] = it.pharmacyName;
    return acc;
  }, {});
  const phCount = Object.keys(grouped).length;

  // ─── Apply promo ───
  const tryApplyPromo = async (code, silent = false) => {
    if (!code || !code.trim()) {
      if (!silent) {
        setPromoMsg({ text: 'Entre un code', kind: 'err' });
        setPromoShake(true);
        setTimeout(() => setPromoShake(false), 400);
      }
      return;
    }
    setPromoLoading(true);
    setPromoMsg({ text: '', kind: '' });

    try {
      const result = await validatePromoCode(code.trim().toUpperCase(), user?.id, subtotal);
      if (!result.valid) {
        setPromoMsg({ text: result.error, kind: 'err' });
        setAppliedPromo(null);
        setPromoShake(true);
        setTimeout(() => setPromoShake(false), 400);
      } else {
        setAppliedPromo({ promo: result.promo, discount: result.discount });
        setPromoMsg({
          text: `✓ Code ${result.promo.code} appliqué : -${formatPrice(result.discount)} FCFA`,
          kind: 'ok',
        });
        clearPendingPromo();
        // ─── ANALYTICS : promo_code_applied ───
        try {
          trackEvent('promo_code_applied', {
            code: result.promo.code,
            discount_amount: result.discount,
          });
        } catch {}
      }
      if (!result.valid) {
        // ─── ANALYTICS : promo_code_failed ───
        try {
          trackEvent('promo_code_failed', {
            code: code.trim().toUpperCase(),
            reason: result.error,
          });
        } catch {}
      }
    } catch (e) {
      setPromoMsg({ text: 'Erreur : ' + e.message, kind: 'err' });
      setPromoShake(true);
      setTimeout(() => setPromoShake(false), 400);
      try { trackEvent('promo_code_failed', { code: code?.trim?.()?.toUpperCase?.() || code, reason: e?.message }); } catch {}
    } finally {
      setPromoLoading(false);
    }
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setPromoInput('');
    setPromoMsg({ text: '', kind: '' });
    clearPendingPromo();
  };

  const selectAddress = (id) => {
    if (id === selectedAddrId) return;
    setSelectedAddrId(id);
    setAddrFlash(id);
    setTimeout(() => setAddrFlash(null), 600);
  };

  // ─── Submit ───
  const handleSubmit = async () => {
    if (!selectedAddr) {
      toast.error('Sélectionne une adresse de livraison');
      return;
    }
    // Haptic léger (si supporté)
    try { if (navigator?.vibrate) navigator.vibrate(8); } catch (_) {}
    // ─── ANALYTICS : checkout_started (au click "Passer commande") ───
    try {
      trackEvent('checkout_started', {
        items_count: items.length,
        total,
        payment_method: payment,
      });
    } catch {}
    setSubmitting(true);
    try {
      const order = await createOrder({
        items,
        address: {
          name: selectedAddr.name,
          phone: selectedAddr.phone,
          city: selectedAddr.city,
          neighborhood: selectedAddr.neighborhood,
          line: selectedAddr.line,
        },
        paymentMethod: payment,
        subtotal,
        shipping,
        total,
        promoCode: appliedPromo?.promo?.code || null,
        promoDiscount: promoDiscount || 0,
        // ─── Preorder (Import) ───
        isPreorder,
        depositAmount: isPreorder ? depositAmount : null,
        balanceAmount: isPreorder ? balanceAmount : null,
        expectedArrivalDate: isPreorder ? preorderSummary.expectedArrival?.toISOString().slice(0, 10) : null,
      });

      if (order) {
        if (appliedPromo?.promo?.id && user?.id) {
          await applyPromoCode(appliedPromo.promo.id, user.id, order.id, promoDiscount).catch(() => {});
        }
        if (loyaltyDiscount > 0) clearLoyaltyCredit();

        // ─── NE PAS envoyer les notifs maintenant (sauf COD) ───
        const isCashOnDelivery = payment === 'cod';
        if (isCashOnDelivery) {
          if (user?.email) {
            sendEmail({
              to: user.email,
              template: 'orderConfirmed',
              params: {
                firstName: user.first_name || selectedAddr.name?.split(' ')[0] || 'Toi',
                order,
              },
            }).catch(e => console.warn('order email failed:', e?.message));
          }
          sendOrderEmail(order.id, 'pharmacyNewOrder')
            .catch(e => console.warn('pharma email failed:', e?.message));
          try {
            const pharmaIds = [...new Set((items || []).map(it => it.pharmacyId).filter(Boolean))];
            await supabase.channel('yaram-new-orders').send({
              type: 'broadcast',
              event: 'new_order',
              payload: {
                order_id: order.id,
                total: order.total,
                pharmacy_ids: pharmaIds,
                created_at: order.created_at,
              },
            });
          } catch (e) {
            console.warn('broadcast new_order failed:', e?.message);
          }
        }

        clearCart();
        clearPendingPromo();

        // ─── ANALYTICS : order_completed (commande créée DB-side, paiement à venir
        //     sauf COD où la commande est considérée comme finalisée) ───
        try {
          trackEvent('order_completed', {
            order_id: order.id,
            total: order.total,
            payment_method: payment,
          });
        } catch {}

        if (isCashOnDelivery) {
          navigate({ name: 'order_tracking', params: { orderId: order.id } });
        } else {
          navigate({ name: 'payment', params: { orderId: order.id } });
        }
      } else {
        toast.error('Erreur création commande');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Méthodes de paiement filtrées (Wave + COD si non-preorder) ───
  const PAYMENT_METHODS = ALL_PAYMENT_METHODS.filter(m => {
    if (!m.enabled) return false;
    if (isPreorder && !m.preorderOk) return false;
    return true;
  });

  // ─── CTA label ───
  const ctaLabel = submitting
    ? 'Création de la commande...'
    : !selectedAddr
      ? 'Ajoute une adresse pour continuer'
      : isPreorder
        ? `Payer l'acompte · ${formatPrice(amountToPayNow)} FCFA`
        : `Passer commande · ${formatPrice(total)} FCFA`;

  return (
    <div className="check-screen page-anim">
      {/* ════════ HEADER GLASS STICKY ════════ */}
      <div className="check-header-glass">
        <button className="icon-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="check-header-title">
          <h1>Commande</h1>
          <span className="check-step-tag">Étape 2/3</span>
        </div>
        <div style={{width: 40}} />
      </div>

      {/* ════════ STEPPER ════════ */}
      <div className="check-stepper">
        <div className="check-step check-step-done">
          <div className="check-step-dot">✓</div>
          <span>Panier</span>
        </div>
        <div className="check-step-line check-step-line-done" />
        <div className="check-step check-step-active">
          <div className="check-step-dot">2</div>
          <span>Livraison</span>
        </div>
        <div className="check-step-line" />
        <div className="check-step">
          <div className="check-step-dot">3</div>
          <span>Paiement</span>
        </div>
      </div>

      <div className="check-scroll">
        {/* ════════ RÉCAP COMMANDE ════════ */}
        <div className="check-section premium-card stagger-1">
          <h3 className="section-title">
            <span className="section-emoji">📦</span> Récap commande
            <span className="section-meta">{items.length} article{items.length > 1 ? 's' : ''}</span>
          </h3>
          <div className="check-info-banner">
            Commande chez <strong>{phCount} pharmacie{phCount > 1 ? 's' : ''}</strong> · 1 seule livraison YARAM
          </div>

          <div className="check-items-list">
            {items.map((it, i) => {
              const price = Number(it?.price) || 0;
              const qty = Number(it?.qty) || 0;
              const line = price * qty;
              return (
                <div key={it.id || i} className="check-item-row">
                  <div className="check-item-thumb">
                    {it.image ? (
                      <img src={it.image} alt={it.name} loading="lazy" decoding="async" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <span>💊</span>
                    )}
                  </div>
                  <div className="check-item-info">
                    <div className="check-item-name">{it.name || 'Article'}</div>
                    <div className="check-item-meta">
                      <span className="check-item-qty">×{qty}</span>
                      <span className="check-item-price-each">{formatPrice(price)} FCFA</span>
                    </div>
                  </div>
                  <div className="check-item-total">{formatPrice(line)} FCFA</div>
                </div>
              );
            })}
          </div>

          <div className="check-items-sum">
            <span>Sous-total articles</span>
            <strong>{formatPrice(subtotal)} FCFA</strong>
          </div>
        </div>

        {/* ════════ ADRESSE LIVRAISON ════════ */}
        <div className="check-section premium-card stagger-2">
          <h3 className="section-title">
            <span className="section-emoji">📍</span> Adresse de livraison
            {addresses.length > 0 && (
              <button
                className="section-link"
                onClick={() => navigate({ name: 'addresses', params: {} })}
              >
                Gérer
              </button>
            )}
          </h3>

          {loading ? (
            <div className="check-loading">
              <div className="check-spinner" />
              <span>Chargement des adresses...</span>
            </div>
          ) : addresses.length === 0 ? (
            <button
              className="check-addr-empty"
              onClick={() => navigate({ name: 'addresses', params: {} })}
            >
              <div className="check-addr-empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div className="check-addr-empty-text">
                <strong>Ajouter mon adresse</strong>
                <span>On a besoin d'où te livrer</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="check-addr-empty-chev">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ) : (
            <>
              <div className="check-addr-list">
                {addresses.map(a => (
                  <button
                    key={a.id}
                    className={`check-addr-card ${selectedAddrId === a.id ? 'selected' : ''} ${addrFlash === a.id ? 'flash' : ''}`}
                    onClick={() => selectAddress(a.id)}
                  >
                    <div className="check-addr-radio">
                      {selectedAddrId === a.id && <div className="check-addr-dot" />}
                    </div>
                    <div className="check-addr-info">
                      <div className="check-addr-head">
                        <span className="check-addr-emoji">{a.icon || '📍'}</span>
                        <strong>{a.label}</strong>
                        {a.is_default && <span className="check-addr-def">Défaut</span>}
                      </div>
                      <p className="check-addr-line">{a.line}</p>
                      <p className="check-addr-sub">
                        {a.neighborhood ? `${a.neighborhood}, ` : ''}{a.city}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <button
                className="check-addr-add"
                onClick={() => navigate({ name: 'addresses', params: {} })}
              >
                <span className="check-addr-add-plus">+</span>
                Nouvelle adresse
              </button>
            </>
          )}

          {selectedAddr && (
            <div className="check-zone">
              <span className="check-zone-icon">🚚</span>
              <div className="check-zone-text">
                <strong>{zone.zone}</strong> — livraison {zone.delay}
              </div>
              <div className="check-zone-price">
                {shipping === 0 ? 'Gratuit' : `${formatPrice(shipping)} FCFA`}
              </div>
            </div>
          )}
        </div>

        {/* ════════ PROMO + FIDÉLITÉ ════════ */}
        <div className="check-section premium-card check-card-tinted stagger-3">
          <h3 className="section-title">
            <span className="section-emoji">💚</span> Promo & Fidélité
          </h3>

          {/* Code promo */}
          {appliedPromo ? (
            <div className="check-promo-applied appear">
              <div className="check-promo-applied-icon">✓</div>
              <div className="check-promo-applied-info">
                <div className="check-promo-applied-code">{appliedPromo.promo.code}</div>
                <div className="check-promo-applied-desc">
                  {appliedPromo.promo.description || `Réduction de ${formatPrice(appliedPromo.discount)} FCFA`}
                </div>
              </div>
              <button onClick={removePromo} className="check-promo-remove" aria-label="Retirer">
                Retirer
              </button>
            </div>
          ) : (
            <div className={`check-promo-input-row ${promoShake ? 'shake' : ''}`}>
              <input
                type="text"
                className="check-promo-input"
                value={promoInput}
                onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoMsg({ text: '', kind: '' }); }}
                placeholder="Code promo"
                onKeyDown={e => { if (e.key === 'Enter') tryApplyPromo(promoInput); }}
              />
              <button
                onClick={() => tryApplyPromo(promoInput)}
                disabled={promoLoading || !promoInput.trim()}
                className="check-promo-btn"
              >
                {promoLoading ? '...' : 'Appliquer'}
              </button>
            </div>
          )}
          {promoMsg.text && !appliedPromo && (
            <div className={`check-promo-msg appear ${promoMsg.kind === 'err' ? 'err' : 'ok'}`}>
              {promoMsg.text}
            </div>
          )}
          {appliedPromo && (
            <div className="check-promo-line-anim appear">
              <span>Réduction appliquée</span>
              <strong>-{formatPrice(promoDiscount)} FCFA</strong>
            </div>
          )}

          {/* Fidélité */}
          {loyaltyCredit > 0 && (
            <label className={`check-loyalty-toggle ${useLoyaltyCredit ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={useLoyaltyCredit}
                onChange={e => setUseLoyaltyCredit(e.target.checked)}
              />
              <div className="check-loyalty-check">
                {useLoyaltyCredit && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <div className="check-loyalty-info">
                <div className="check-loyalty-title">
                  Utiliser {formatPrice(loyaltyCredit)} FCFA de fidélité
                </div>
                <div className="check-loyalty-sub">
                  {useLoyaltyCredit
                    ? `−${formatPrice(loyaltyDiscount)} FCFA appliqué`
                    : 'Coche pour économiser'}
                </div>
              </div>
            </label>
          )}
        </div>

        {/* ════════ PAIEMENT ════════ */}
        <div className="check-section premium-card stagger-4">
          <h3 className="section-title">
            <span className="section-emoji">💳</span> Paiement
          </h3>
          <div className="check-pay-list">
            {PAYMENT_METHODS.map(m => (
              <button
                key={m.id}
                className={'check-pay-card ' + (payment === m.id ? 'active' : '')}
                onClick={() => setPayment(m.id)}
              >
                <span className="check-pay-icon">
                  {m.logoUrl ? (
                    <img
                      src={m.logoUrl}
                      alt={m.name}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        const parent = e.target.parentNode;
                        if (parent && !parent.querySelector('.fallback-icon')) {
                          const span = document.createElement('span');
                          span.className = 'fallback-icon';
                          span.textContent = m.fallbackIcon;
                          parent.appendChild(span);
                        }
                      }}
                    />
                  ) : (
                    <span className="fallback-icon">{m.fallbackIcon}</span>
                  )}
                </span>
                <div className="check-pay-name">
                  <strong>{m.name}</strong>
                  {m.id === 'wave' && <span className="check-pay-sub">Paiement instantané</span>}
                  {m.id === 'cod' && <span className="check-pay-sub">Tu paies au livreur</span>}
                </div>
                <div className="check-pay-radio">
                  {payment === m.id && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ════════ RÉCAP FINAL ════════ */}
        <div className="check-summary premium-card stagger-5">
          <div className="cart-row"><span>Sous-total</span><strong>{formatPrice(subtotal)} FCFA</strong></div>
          <div className="cart-row">
            <span>Livraison ({zone.zone})</span>
            <strong>{shipping === 0 ? 'Gratuit' : formatPrice(shipping) + ' FCFA'}</strong>
          </div>
          {promoDiscount > 0 && (
            <div className="cart-row cart-row-discount">
              <span>Code {appliedPromo.promo.code}</span>
              <strong>−{formatPrice(promoDiscount)} FCFA</strong>
            </div>
          )}
          {loyaltyDiscount > 0 && (
            <div className="cart-row cart-row-discount">
              <span>💚 Crédit fidélité</span>
              <strong>−{formatPrice(loyaltyDiscount)} FCFA</strong>
            </div>
          )}
          <div className="cart-row cart-row-total">
            <span>Total</span>
            <strong>{formatPrice(total)} FCFA</strong>
          </div>

          {isPreorder && (
            <div className="check-preorder-block">
              <div className="check-preorder-row check-preorder-now">
                <span>💳 <strong>À payer maintenant (50%)</strong></span>
                <strong>{formatPrice(depositAmount)} FCFA</strong>
              </div>
              <div className="check-preorder-row check-preorder-balance">
                <span>📦 Solde à l'arrivée à Dakar (50%)</span>
                <strong>{formatPrice(balanceAmount)} FCFA</strong>
              </div>
              <div className="check-preorder-row check-preorder-eta">
                <span>✈️ Arrivée estimée : <strong>{preorderSummary.expectedArrivalFormatted}</strong></span>
              </div>
            </div>
          )}
        </div>

        <div style={{height: 140}} />
      </div>

      {/* ════════ CTA STICKY BOTTOM ════════ */}
      <div className="check-cta">
        {!selectedAddr && !loading && (
          <div className="check-cta-warn">
            ⚠️ Ajoute une adresse de livraison pour continuer
          </div>
        )}
        <button
          className="btn-primary check-cta-btn"
          onClick={handleSubmit}
          disabled={submitting || !selectedAddr}
        >
          <span className="check-cta-label">{ctaLabel}</span>
          {!submitting && selectedAddr && (
            <svg className="check-cta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
