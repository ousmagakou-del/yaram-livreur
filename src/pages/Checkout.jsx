import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { createOrder, getMyAddresses, validatePromoCode, applyPromoCode } from '../lib/supabase';
import { formatPrice, getShippingZone } from '../lib/utils';
import { getPendingPromo, clearPendingPromo, getLoyaltyCredit, clearLoyaltyCredit } from '../lib/promoStorage';
import './Checkout.css';

export default function Checkout({ items, paymentMethod }) {
  const { navigate } = useNav();
  const { user } = useUser();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddrId, setSelectedAddrId] = useState(null);
  const [payment, setPayment] = useState(paymentMethod || 'wave');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // ─── Promo code ───
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null); // { promo, discount }
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoMsg, setPromoMsg] = useState({ text: '', kind: '' });

  // ─── Loyalty credit ───
  const [loyaltyCredit, setLoyaltyCredit] = useState(0);
  const [useLoyaltyCredit, setUseLoyaltyCredit] = useState(false);

  // ─── Load addresses + pending promo + loyalty credit ───
  useEffect(() => {
    (async () => {
      const addrs = await getMyAddresses();
      setAddresses(addrs);
      const def = addrs.find(a => a.is_default) || addrs[0];
      if (def) setSelectedAddrId(def.id);
      setLoading(false);

      // Check si une promo a ete posee par le Home / page Promos
      const pending = getPendingPromo();
      if (pending) {
        setPromoInput(pending);
        // Auto-apply dans 500ms (laisse le temps a items de se charger)
        setTimeout(() => tryApplyPromo(pending, true), 500);
      }

      // Check le credit fidelite
      const credit = getLoyaltyCredit();
      if (credit > 0) {
        setLoyaltyCredit(credit);
        setUseLoyaltyCredit(true); // active par defaut
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!items || items.length === 0) {
    return (
      <div style={{padding: 40, textAlign: 'center'}}>
        <p>Panier vide</p>
        <button className="btn-primary" onClick={() => navigate('/')} style={{marginTop: 20}}>Retour</button>
      </div>
    );
  }

  const selectedAddr = addresses.find(a => a.id === selectedAddrId);
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const zone = getShippingZone(selectedAddr?.city || 'Dakar');
  const shipping = subtotal >= zone.freeFrom ? 0 : zone.price;

  // ─── Calculs avec promo + loyalty ───
  const promoDiscount = appliedPromo?.discount || 0;
  const loyaltyDiscount = useLoyaltyCredit ? Math.min(loyaltyCredit, subtotal + shipping - promoDiscount) : 0;
  const totalBeforeDiscounts = subtotal + shipping;
  const total = Math.max(0, totalBeforeDiscounts - promoDiscount - loyaltyDiscount);

  const grouped = items.reduce((acc, it) => {
    if (!acc[it.pharmacyId]) acc[it.pharmacyId] = it.pharmacyName;
    return acc;
  }, {});
  const phCount = Object.keys(grouped).length;

  // ─── Apply promo code ───
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
        clearPendingPromo(); // un fois applique, on retire
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

  // ─── Submit commande ───
  const handleSubmit = async () => {
    if (!selectedAddr) {
      alert('Sélectionne une adresse de livraison');
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
      });

      if (order) {
        // Si une promo a ete appliquee, log dans promo_uses + increment uses_count
        if (appliedPromo?.promo?.id && user?.id) {
          await applyPromoCode(appliedPromo.promo.id, user.id, order.id, promoDiscount).catch(() => {});
        }

        // Si credit loyalty utilise, le clear (deja debite en DB par redeem)
        if (loyaltyDiscount > 0) {
          clearLoyaltyCredit();
        }

        localStorage.removeItem('yaram_cart');
        localStorage.removeItem('yaram_cart_last_added_at');
        clearPendingPromo();

        navigate({ name: 'payment', params: { orderId: order.id } });
      } else {
        alert('Erreur création commande');
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

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
              style={{fontSize: 12, color: 'var(--primary)', fontWeight: 600}}
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

        <div className="check-section">
          <h3 className="section-title">💳 Paiement</h3>
          {[
            { id: 'wave', name: 'Wave', icon: '🌊' },
            { id: 'om', name: 'Orange Money', icon: '🟠' },
            { id: 'cod', name: 'Cash à la livraison', icon: '💵' },
            { id: 'card', name: 'Carte bancaire', icon: '💳' },
          ].map(m => (
            <button
              key={m.id}
              className={'check-pay-btn ' + (payment === m.id ? 'active' : '')}
              onClick={() => setPayment(m.id)}
            >
              <span className="check-pay-icon">{m.icon}</span>
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
        </div>

        <div style={{height: 100}} />
      </div>

      <div className="check-cta">
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !selectedAddr}>
          {submitting ? 'Création...' : 'Confirmer · ' + formatPrice(total) + ' FCFA'}
        </button>
      </div>
    </div>
  );
}
