import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { formatPrice } from '../lib/utils';
import TabBar from '../components/TabBar';
import "./cart.css";
export default function Cart() {
  const { navigate } = useNav();
  const [items, setItems] = useState([]);

  useEffect(() => { refresh(); }, []);
  const refresh = () => {
    try {
      const c = JSON.parse(localStorage.getItem('yaram_cart') || '[]');
      setItems(c);
    } catch { setItems([]); }
  };

  const updateQty = (idx, delta) => {
    const next = [...items];
    next[idx].qty = Math.max(0, next[idx].qty + delta);
    if (next[idx].qty === 0) next.splice(idx, 1);
    localStorage.setItem('yaram_cart', JSON.stringify(next));
    setItems(next);
  };

  const removeItem = (idx) => {
    const next = items.filter((_, i) => i !== idx);
    localStorage.setItem('yaram_cart', JSON.stringify(next));
    setItems(next);
  };

  const grouped = items.reduce((acc, it) => {
    if (!acc[it.pharmacyId]) acc[it.pharmacyId] = { name: it.pharmacyName, items: [] };
    acc[it.pharmacyId].items.push(it);
    return acc;
  }, {});

  const subtotal = items.reduce((s, it) => s + (it.price * it.qty), 0);
  const shipping = subtotal > 0 ? 1500 : 0;
  const total = subtotal + shipping;

  if (items.length === 0) {
    return (
      <div className="cart-screen page-anim">
        <div className="cart-empty">
          <div style={{fontSize: 64, opacity: 0.2}}>🛒</div>
          <h3>Ton panier est vide</h3>
          <p>Découvre notre catalogue et ajoute des produits</p>
          <button className="btn-primary" onClick={() => navigate('/')} style={{maxWidth: 240, marginTop: 24}}>
            Voir le catalogue →
          </button>
        </div>
        <TabBar active="cart" cartCount={0} />
      </div>
    );
  }

  return (
    <div className="cart-screen page-anim">
      <div className="cart-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1>Mon panier</h1>
          <p>{items.length} article{items.length > 1 ? 's' : ''} · {Object.keys(grouped).length} pharmacie{Object.keys(grouped).length > 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="cart-scroll">
        {Object.entries(grouped).map(([phId, group]) => (
          <div key={phId} className="cart-group">
            <div className="cart-group-head">🏥 {group.name}</div>
            {group.items.map((it, idx) => {
              const globalIdx = items.indexOf(it);
              return (
                <div key={it.productId + phId} className="cart-item">
                  <img src={it.img} alt="" />
                  <div className="cart-item-info">
                    <div className="cart-item-brand">{it.brand}</div>
                    <div className="cart-item-name">{it.name}</div>
                    <div className="cart-item-price">{formatPrice(it.price)} FCFA</div>
                  </div>
                  <div className="cart-item-qty">
                    <button onClick={() => updateQty(globalIdx, -1)}>−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => updateQty(globalIdx, 1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div className="cart-summary">
          <div className="cart-row"><span>Sous-total</span><strong>{formatPrice(subtotal)} FCFA</strong></div>
          <div className="cart-row"><span>Livraison YARAM</span><strong>{formatPrice(shipping)} FCFA</strong></div>
          <div className="cart-row cart-row-total"><span>Total</span><strong>{formatPrice(total)} FCFA</strong></div>
        </div>

        {Object.keys(grouped).length > 1 && (
          <div className="cart-info-banner">
            ℹ️ Commande chez {Object.keys(grouped).length} pharmacies, livrée en une seule fois par YARAM
          </div>
        )}

        <div style={{height: 100}} />
      </div>

      <div className="cart-cta">
        <button className="btn-primary" onClick={() => navigate({ name: 'checkout', params: { items, total, subtotal, shipping } })}>
          Passer commande · {formatPrice(total)} FCFA →
        </button>
      </div>
    </div>
  );
}