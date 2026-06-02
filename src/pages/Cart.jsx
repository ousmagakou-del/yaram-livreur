import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { formatPrice, getShippingZone } from '../lib/utils';
import { getCart, setCart } from '../lib/cart';
import { getMyAddresses } from '../lib/supabase';
import { buildPreorderSummary } from '../lib/preorder';
import TabBar from '../components/TabBar';
import "./cart.css";

export default function Cart() {
  const { navigate } = useNav();
  const [items, setItems] = useState(() => getCart());
  // Adresse par defaut de la cliente pour calculer la vraie zone de livraison
  // (avant on hardcodait 1500 FCFA peu importe la ville).
  const [defaultCity, setDefaultCity] = useState('Dakar');

  // Sync si une autre vue modifie le panier (ex: badge TabBar)
  useEffect(() => {
    const onUpdate = (e) => {
      if (e?.detail?.items) setItems(e.detail.items);
      else setItems(getCart());
    };
    window.addEventListener('yaram-cart-updated', onUpdate);
    // Aussi : si le user revient sur cette page apres edit ailleurs
    setItems(getCart());

    // Auto-refresh sur retour navigation (popstate iOS)
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

  const updateQty = (idx, delta) => {
    const next = [...items];
    next[idx].qty = Math.max(0, (next[idx].qty || 0) + delta);
    if (next[idx].qty === 0) next.splice(idx, 1);
    setCart(next); // dispatch yaram-cart-updated -> badge TabBar a jour
    setItems(next);
  };

  const removeItem = (idx) => {
    const next = items.filter((_, i) => i !== idx);
    setCart(next);
    setItems(next);
  };

  const grouped = items.reduce((acc, it) => {
    if (!acc[it.pharmacyId]) acc[it.pharmacyId] = { name: it.pharmacyName, items: [] };
    acc[it.pharmacyId].items.push(it);
    return acc;
  }, {});

  // SAFETY : price ou qty peuvent être null/string ; éviter NaN qui propage partout
  const subtotal = items.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty) || 0)), 0);
  // Vraie zone de livraison (Dakar 1500, Thies 2500, autre Senegal 3500…)
  // + gratuit au-dessus du seuil de la zone.
  const zone = getShippingZone(defaultCity);
  const shipping = subtotal > 0 && subtotal < zone.freeFrom ? zone.price : 0;
  const total = subtotal + shipping;

  // Detecte si la commande contient des produits import (preorder 50/50)
  const preorderSummary = buildPreorderSummary(items, shipping);
  const isPreorder = preorderSummary.isPreorder;

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
        <TabBar active="cart" />
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
        {isPreorder && (
          <div className="cart-preorder-banner">
            <div className="cart-preorder-icon">✈️</div>
            <div className="cart-preorder-text">
              <strong>Commande Import</strong>
              <p>
                Tu paies <strong>50% à la commande</strong>, le reste à l'arrivée à Dakar (environ {preorderSummary.leadTimeDays} jours).
              </p>
            </div>
          </div>
        )}

        {Object.entries(grouped).map(([phId, group]) => (
          <div key={phId} className="cart-group">
            <div className="cart-group-head">🏥 {group.name}</div>
            {group.items.map((it) => {
              const globalIdx = items.indexOf(it);
              return (
                <div key={it.productId + phId} className="cart-item">
                  <img src={it.img} alt={it.name || 'Produit'} loading="lazy" decoding="async" />
                  <div className="cart-item-info">
                    <div className="cart-item-brand">
                      {it.brand}
                      {it.is_imported && (
                        <span className="cart-item-import-tag">✈️ Import {it.lead_time_days || 15}j</span>
                      )}
                    </div>
                    <div className="cart-item-name">{it.name}</div>
                    <div className="cart-item-price">{formatPrice(it.price)} FCFA</div>
                  </div>
                  <div className="cart-item-qty">
                    <button onClick={() => updateQty(globalIdx, -1)} aria-label="Diminuer">−</button>
                    <span>{it.qty}</span>
                    <button onClick={() => updateQty(globalIdx, 1)} aria-label="Augmenter">+</button>
                  </div>
                  <button
                    onClick={() => removeItem(globalIdx)}
                    aria-label="Supprimer cet article"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#D9342B',
                      fontSize: 18,
                      cursor: 'pointer',
                      padding: '4px 6px',
                      marginLeft: 4,
                    }}
                  >🗑</button>
                </div>
              );
            })}
          </div>
        ))}

        <div className="cart-summary">
          <div className="cart-row"><span>Sous-total</span><strong>{formatPrice(subtotal)} FCFA</strong></div>
          <div className="cart-row">
            <span>Livraison ({zone.zone})</span>
            <strong>{shipping === 0 ? 'Gratuit' : `${formatPrice(shipping)} FCFA`}</strong>
          </div>
          {subtotal > 0 && subtotal < zone.freeFrom && (
            <div className="cart-row" style={{ fontSize: 11, color: '#1F8B4C' }}>
              <span>+{formatPrice(zone.freeFrom - subtotal)} FCFA pour la livraison gratuite</span>
            </div>
          )}
          <div className="cart-row cart-row-total"><span>Total</span><strong>{formatPrice(total)} FCFA</strong></div>

          {isPreorder && (
            <div className="cart-preorder-breakdown">
              <div className="cart-row">
                <span>💳 Acompte à payer maintenant (50%)</span>
                <strong style={{ color: '#0066CC' }}>{formatPrice(preorderSummary.breakdown.depositAmount)} FCFA</strong>
              </div>
              <div className="cart-row">
                <span>📦 Solde à l'arrivée à Dakar (50%)</span>
                <strong>{formatPrice(preorderSummary.breakdown.balanceAmount)} FCFA</strong>
              </div>
              <div className="cart-row" style={{ fontSize: 11, color: 'var(--muted)' }}>
                <span>Arrivée estimée : {preorderSummary.expectedArrivalFormatted}</span>
              </div>
            </div>
          )}
        </div>

        {Object.keys(grouped).length > 1 && (
          <div className="cart-info-banner">
            ℹ️ Commande chez {Object.keys(grouped).length} pharmacies, livrée en une seule fois par YARAM
          </div>
        )}

        <div style={{height: 100}} />
      </div>

      <div className="cart-cta">
        <button
          className="btn-primary"
          onClick={() => navigate({ name: 'checkout', params: { items, total, subtotal, shipping, preorderSummary } })}
        >
          {isPreorder
            ? `Payer l'acompte · ${formatPrice(preorderSummary.breakdown.depositAmount)} FCFA →`
            : `Passer commande · ${formatPrice(total)} FCFA →`}
        </button>
      </div>
    </div>
  );
}
