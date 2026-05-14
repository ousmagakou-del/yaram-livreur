import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { createOrder, getMyAddresses } from '../lib/supabase';
import { formatPrice, getShippingZone } from '../lib/utils';
import './Checkout.css';

export default function Checkout({ items, paymentMethod }) {
  const { navigate } = useNav();
  const { user } = useUser();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddrId, setSelectedAddrId] = useState(null);
  const [payment, setPayment] = useState(paymentMethod || 'wave');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const addrs = await getMyAddresses();
      setAddresses(addrs);
      const def = addrs.find(a => a.is_default) || addrs[0];
      if (def) setSelectedAddrId(def.id);
      setLoading(false);
    })();
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
  const total = subtotal + shipping;
  const grouped = items.reduce((acc, it) => {
    if (!acc[it.pharmacyId]) acc[it.pharmacyId] = it.pharmacyName;
    return acc;
  }, {});
  const phCount = Object.keys(grouped).length;

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
        subtotal, shipping, total,
      });
      if (order) {
        localStorage.removeItem('yaram_cart');
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