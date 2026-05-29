import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { createOrder, getMyAddresses, validatePromoCode, applyPromoCode } from '../lib/supabase';
import { sendEmail, sendOrderEmail } from '../lib/emails';
import { formatPrice, getShippingZone } from '../lib/utils';
import { getPendingPromo, clearPendingPromo, getLoyaltyCredit, clearLoyaltyCredit } from '../lib/promoStorage';
import { getCart, clearCart } from '../lib/cart';
import { buildPreorderSummary } from '../lib/preorder';
import { toast } from '../lib/toast';
import './Checkout.css';

// ─── URLs des logos paiement (Supabase Storage) ───
// ⚠️ REMPLACE par tes vraies URLs après upload dans le bucket banner-images
const WAVE_LOGO = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/logo-wave.jpg';
const OM_LOGO   = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/logo-orange.png';

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

  // ─── Loyalty credit ───
  const [loyaltyCredit, setLoyaltyCredit] = useState(0);
  const [useLoyaltyCredit, setUseLoyaltyCredit] = useState(false);

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
        // Reseau/RLS qui casse : on ne laisse pas "Chargement..." infini
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
        <div className="check-header">
          <button className="icon-back-btn" onClick={() => navigate(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
          <h1>Commande</h1>
        </div>
        <div style={{padding: 40, textAlign: 'center', flex: 1}}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div>
          <p style={{ color: '#6B6B6B', marginBottom: 24 }}>Ton panier est vide</p>
          <button className="btn-primary" onClick={() => navigate('/')} style={{padding: '14px 28px'}}>
            Découvrir les produits →
          </button>
        </div>
      </div>
    );
  }

  const selectedAddr = addresses.find(a => a.id === selectedAddrId);
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const zone = getShippingZone(selectedAddr?.city || 'Dakar');
  const shipping = subtotal >= zone.freeFrom ? 0 : zone.price;

  const promoDiscount = appliedPromo?.discount || 0;
  const loyaltyDiscount = useLoyaltyCredit ? Math.min(loyaltyCredit, subtotal + shipping - promoDiscount) : 0;
  const total = Math.max(0, subtotal + shipping - promoDiscount - loyaltyDiscount);

  // ─── Preorder (Import) : détection + breakdown 50/50 ───
  const preorderSummary = buildPreorderSummary(items, shipping);
  const isPreorder = preorderSummary.isPreorder;
  // Si preorder : on facture l'acompte 50% maintenant, le solde sera demandé à l'arrivée
  const depositAmount = isPreorder
    ? Math.round((total * 50) / 100)
    : total;
  const balanceAmount = isPreorder ? total - depositAmount : 0;
  // Montant à PAYER LIVE = acompte (preorder) ou total (commande classique)
  const amountToPayNow = isPreorder ? depositAmount : total;

  const grouped = items.reduce((acc, it) => {
    if (!acc[it.pharmacyId]) acc[it.pharmacyId] = it.pharmacyName;
    return acc;
  }, {});
  const phCount = Object.keys(grouped).length;

  // ─── Apply promo ───
  const tryApplyPromo = async (code, silent = false) => {
    if (!code || !code.trim()) {
      if (!silent) setPromoMsg({ text: 'Entre un code', kind: 'err' });
      return;
    }
    setPromoLoading(true);
    setPromoMsg({ text: '', kind: '' });

    try {
      const result = await validatePromoCode(code.trim().toUpperCase(), user?.id, subtotal);
      if (!result.valid) {
        setPromoMsg({ text: result.error, kind: 'err' });
        setAppliedPromo(null);
      } else {
        setAppliedPromo({ promo: result.promo, discount: result.discount });
        setPromoMsg({ 
          text: `✓ Code ${result.promo.code} appliqué : -${formatPrice(result.discount)} FCFA`, 
          kind: 'ok',
        });
        clearPendingPromo();
      }
    } catch (e) {
      setPromoMsg({ text: 'Erreur : ' + e.message, kind: 'err' });
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

  // ─── Submit ───
  const handleSubmit = async () => {
    if (!selectedAddr) {
      toast.error('Sélectionne une adresse de livraison');
      return;
    }
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

        // Email confirmation commande (non-bloquant)
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
        // Notif email a CHAQUE pharmacie de l'order (resolu serveur-side)
        sendOrderEmail(order.id, 'pharmacyNewOrder')
          .catch(e => console.warn('pharma email failed:', e?.message));

        // Vague E — Realtime broadcast : ping admin + pharmas concernees pour
        // declencher leur refresh instant (au lieu d'attendre le polling 10-20s).
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

        // Vide le panier via lib/cart -> dispatch yaram-cart-updated -> badge TabBar a jour
        clearCart();
        clearPendingPromo();

        navigate({ name: 'payment', params: { orderId: order.id } });
      } else {
        toast.error('Erreur création commande');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Méthodes de paiement (avec logos officiels + fallback emoji) ───
  const PAYMENT_METHODS = [
    { id: 'wave', name: 'Wave',                 logoUrl: WAVE_LOGO, fallbackIcon: '🌊' },
    { id: 'om',   name: 'Orange Money',         logoUrl: OM_LOGO,   fallbackIcon: '🟠' },
    { id: 'cod',  name: 'Cash à la livraison',  fallbackIcon: '💵' },
    { id: 'card', name: 'Carte bancaire',       fallbackIcon: '💳' },
  ];

  return (
    <div className="check-screen page-anim">
      <div className="check-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1>Commande</h1>
      </div>

      <div className="check-scroll">
        <div className="check-section">
          <h3 className="section-title">📦 Récap commande</h3>
          <div className="check-info-banner">
            Commande chez <strong>{phCount} pharmacie{phCount > 1 ? 's' : ''}</strong> · 1 seule livraison YARAM
          </div>
          {Object.values(grouped).map((name, i) => (
            <div key={i} className="check-ph-row">🏥 {name}</div>
          ))}
        </div>

        <div className="check-section">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <h3 className="section-title">📍 Adresse de livraison</h3>
            <button
              onClick={() => navigate({ name: 'addresses', params: {} })}
              style={{fontSize: 12, color: 'var(--primary)', fontWeight: 600, background: 'transparent', border: 'none', cursor: 'pointer'}}
            >
              + Gérer
            </button>
          </div>

          {loading ? (
            <div style={{padding: 20, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13}}>Chargement...</div>
          ) : addresses.length === 0 ? (
            <div className="check-no-addr">
              <p style={{fontSize: 13, marginBottom: 12}}>Pas d'adresse enregistrée</p>
              <button className="btn-primary" onClick={() => navigate({ name: 'addresses', params: {} })}>
                + Ajouter une adresse
              </button>
            </div>
          ) : (
            <div className="check-addr-list">
              {addresses.map(a => (
                <button
                  key={a.id}
                  className={`check-addr-card ${selectedAddrId === a.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAddrId(a.id)}
                >
                  <div className="check-addr-radio">
                    {selectedAddrId === a.id && <div className="check-addr-dot" />}
                  </div>
                  <div className="check-addr-info">
                    <div className="check-addr-head">
                      <span>{a.icon}</span>
                      <strong>{a.label}</strong>
                      {a.is_default && <span className="check-addr-def">Défaut</span>}
                    </div>
                    <p>{a.line}</p>
                    <p style={{fontSize: 11, color: 'var(--ink-soft)', marginTop: 2}}>
                      {a.neighborhood ? `${a.neighborhood}, ` : ''}{a.city}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedAddr && (
            <div className="check-zone">
              📍 Zone : <strong>{zone.zone}</strong> · ⏱️ {zone.delay}
            </div>
          )}
        </div>

        {/* ════════ CODE PROMO ════════ */}
        <div className="check-section">
          <h3 className="section-title">🎁 Code promo</h3>

          {appliedPromo ? (
            <div style={{
              background: 'linear-gradient(135deg, #E8F5EC 0%, #C8EBD3 100%)',
              border: '1.5px dashed #1F8B4C',
              borderRadius: 12,
              padding: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <div style={{ fontSize: 24 }}>✅</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1F8B4C', fontFamily: 'monospace' }}>
                  {appliedPromo.promo.code}
                </div>
                <div style={{ fontSize: 11, color: '#166635', fontWeight: 600 }}>
                  {appliedPromo.promo.description || `Réduction de ${formatPrice(appliedPromo.discount)} FCFA`}
                </div>
              </div>
              <button
                onClick={removePromo}
                style={{
                  background: 'white',
                  border: 'none',
                  color: '#D9342B',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Retirer
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={promoInput}
                  onChange={e => { setPromoInput(e.target.value.toUpperCase()); setPromoMsg({ text: '', kind: '' }); }}
                  placeholder="BIENVENUE10, TEST20..."
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 10,
                    border: '1.5px solid #DDD',
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    letterSpacing: '0.05em',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={() => tryApplyPromo(promoInput)}
                  disabled={promoLoading || !promoInput.trim()}
                  style={{
                    background: promoLoading ? '#DDD' : '#1F8B4C',
                    color: 'white',
                    border: 'none',
                    padding: '0 18px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {promoLoading ? '...' : 'Appliquer'}
                </button>
              </div>
              {promoMsg.text && (
                <div style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: promoMsg.kind === 'err' ? '#FCE9E7' : '#E8F5EC',
                  color: promoMsg.kind === 'err' ? '#D9342B' : '#1F8B4C',
                }}>
                  {promoMsg.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* ════════ CRÉDIT FIDÉLITÉ ════════ */}
        {loyaltyCredit > 0 && (
          <div className="check-section">
            <h3 className="section-title">💚 Crédit fidélité</h3>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 14,
              background: useLoyaltyCredit ? '#E8F5EC' : '#F4F4F2',
              border: useLoyaltyCredit ? '1.5px solid #1F8B4C' : '1.5px solid #DDD',
              borderRadius: 12,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              <input
                type="checkbox"
                checked={useLoyaltyCredit}
                onChange={e => setUseLoyaltyCredit(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: '#1F8B4C' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1A1A' }}>
                  Utiliser {formatPrice(loyaltyCredit)} FCFA de crédit fidélité
                </div>
                <div style={{ fontSize: 11, color: '#6B6B6B' }}>
                  {useLoyaltyCredit ? `-${formatPrice(loyaltyDiscount)} FCFA appliqué` : 'Coché par défaut pour économiser'}
                </div>
              </div>
            </label>
          </div>
        )}

        {/* ════════ PAIEMENT avec LOGOS ════════ */}
        <div className="check-section">
          <h3 className="section-title">💳 Paiement</h3>
          {PAYMENT_METHODS.map(m => (
            <button
              key={m.id}
              className={'check-pay-btn ' + (payment === m.id ? 'active' : '')}
              onClick={() => setPayment(m.id)}
            >
              <span className="check-pay-icon" style={{
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: m.logoUrl ? 'white' : 'transparent',
                borderRadius: 8,
                overflow: 'hidden',
                border: m.logoUrl ? '1px solid #EEE' : 'none',
              }}>
                {m.logoUrl ? (
                  <img
                    src={m.logoUrl}
                    alt={m.name}
                    style={{ width: '85%', height: '85%', objectFit: 'contain' }}
                    onError={(e) => {
                      // Fallback emoji si l'image foire
                      e.target.style.display = 'none';
                      const parent = e.target.parentNode;
                      if (parent && !parent.querySelector('.fallback-icon')) {
                        const span = document.createElement('span');
                        span.className = 'fallback-icon';
                        span.textContent = m.fallbackIcon;
                        span.style.fontSize = '22px';
                        parent.appendChild(span);
                      }
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 22 }}>{m.fallbackIcon}</span>
                )}
              </span>
              <span>{m.name}</span>
              <div className="check-pay-radio">
                {payment === m.id && <div className="check-pay-dot" />}
              </div>
            </button>
          ))}
        </div>

        <div className="check-summary">
          <div className="cart-row"><span>Sous-total</span><strong>{formatPrice(subtotal)} FCFA</strong></div>
          <div className="cart-row"><span>Livraison ({zone.zone})</span><strong>{shipping === 0 ? 'Gratuit' : formatPrice(shipping) + ' FCFA'}</strong></div>
          {promoDiscount > 0 && (
            <div className="cart-row" style={{ color: '#1F8B4C' }}>
              <span>Code {appliedPromo.promo.code}</span>
              <strong>-{formatPrice(promoDiscount)} FCFA</strong>
            </div>
          )}
          {loyaltyDiscount > 0 && (
            <div className="cart-row" style={{ color: '#1F8B4C' }}>
              <span>💚 Crédit fidélité</span>
              <strong>-{formatPrice(loyaltyDiscount)} FCFA</strong>
            </div>
          )}
          <div className="cart-row cart-row-total"><span>Total</span><strong>{formatPrice(total)} FCFA</strong></div>

          {isPreorder && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
              <div className="cart-row" style={{ background: 'rgba(0,102,204,0.06)', padding: '6px 8px', borderRadius: 8, marginBottom: 6 }}>
                <span>💳 <strong>À payer maintenant (50%)</strong></span>
                <strong style={{ color: '#0066CC', fontSize: 16 }}>{formatPrice(depositAmount)} FCFA</strong>
              </div>
              <div className="cart-row" style={{ fontSize: 12, color: 'var(--muted)' }}>
                <span>📦 Solde à l'arrivée à Dakar (50%)</span>
                <strong>{formatPrice(balanceAmount)} FCFA</strong>
              </div>
              <div className="cart-row" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                <span>✈️ Arrivée estimée : <strong>{preorderSummary.expectedArrivalFormatted}</strong></span>
              </div>
            </div>
          )}
        </div>

        <div style={{height: 120}} />
      </div>

      <div className="check-cta">
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !selectedAddr}>
          {submitting
            ? 'Création...'
            : isPreorder
              ? `Payer l'acompte · ${formatPrice(amountToPayNow)} FCFA`
              : `Confirmer · ${formatPrice(total)} FCFA`}
        </button>
      </div>
    </div>
  );
}
