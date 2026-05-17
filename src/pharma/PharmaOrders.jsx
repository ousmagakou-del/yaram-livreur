import { useState, useEffect } from 'react';
import { getPharmacyOrders, acceptOrder, refuseOrder, markOrderReady, sendWhatsApp } from '../lib/supabase';
import { YARAM_WHATSAPP_INTL } from '../lib/utils';

const REFUSAL_REASONS = [
  'Produit en rupture de stock',
  'Produit indisponible chez nous',
  'Prix incorrect dans le catalogue',
  'Fermé pour le moment',
  'Autre',
];

export default function PharmaOrders({ pharmacyId, pharmacyName, onPendingChange }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [refusing, setRefusing] = useState(null);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [pharmacyId]);

  const refresh = async () => {
    try {
      const data = await getPharmacyOrders(pharmacyId);
      setOrders(data);
      const pending = data.filter(o => o.status === 'paid').length;
      onPendingChange?.(pending);
    } catch (e) {
      console.error('Refresh error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (order) => {
    if (!confirm(`Accepter cette commande ${order.id} ?`)) return;
    await acceptOrder(order.id, pharmacyId);
    
    // WhatsApp à la cliente
    if (order.address?.phone) {
      const msg = `Salut ${order.address.name} 💚\n\nTa commande ${order.id} a été acceptée par ${pharmacyName} et est en préparation. On te tient au courant !\n\nYARAM`;
      sendWhatsApp(order.address.phone, msg).then(r => console.log('Accept notif:', r));
    }
    
    setSelectedOrder(null);
    refresh();
  };

  const handleRefuse = async (order, reason) => {
    await refuseOrder(order.id, reason);
    
    // WhatsApp à la cliente
    if (order.address?.phone) {
      const msg = `Salut ${order.address.name}\n\nMalheureusement ${pharmacyName} ne peut pas honorer ta commande ${order.id} : ${reason}.\n\nYARAM va te rembourser et te proposer une autre pharmacie. On te recontacte rapidement.\n\nYARAM 💚`;
      sendWhatsApp(order.address.phone, msg).then(r => console.log('Refuse notif:', r));
    }
    
    // WhatsApp à YARAM admin
    sendWhatsApp(YARAM_WHATSAPP_INTL, `⚠️ REFUS YARAM\n\n${pharmacyName} a refusé la commande ${order.id}\nMotif : ${reason}\n\nClient : ${order.address?.name} · ${order.address?.phone}\nMontant : ${order.total?.toLocaleString('fr-FR')} FCFA`);
    
    setRefusing(null);
    setSelectedOrder(null);
    refresh();
  };

  const handleReady = async (order) => {
    if (!confirm('Marquer cette commande prête à livrer ?')) return;
    await markOrderReady(order.id);
    
    // WhatsApp à YARAM admin pour assigner livreur
    sendWhatsApp(YARAM_WHATSAPP_INTL, `✅ Commande ${order.id} prête chez ${pharmacyName}\n\nClient : ${order.address?.name}\n📍 ${order.address?.line}, ${order.address?.city}\n💰 ${order.total?.toLocaleString('fr-FR')} FCFA${order.payment_method === 'cod' ? ' (Cash)' : ''}\n\n👉 Assigne un livreur !`);
    
    refresh();
  };

  const filtered = orders.filter(o => {
    if (filter === 'pending') return o.status === 'paid';
    if (filter === 'preparing') return o.status === 'preparing';
    if (filter === 'ready') return o.status === 'ready';
    if (filter === 'shipped') return ['shipped', 'awaiting_cash', 'awaiting_confirm'].includes(o.status);
    if (filter === 'delivered') return o.status === 'delivered';
    if (filter === 'refused') return ['refused', 'cancelled'].includes(o.status);
    return true;
  });

  const counts = {
    pending: orders.filter(o => o.status === 'paid').length,
    preparing: orders.filter(o => o.status === 'preparing').length,
    ready: orders.filter(o => o.status === 'ready').length,
    shipped: orders.filter(o => ['shipped', 'awaiting_cash', 'awaiting_confirm'].includes(o.status)).length,
    delivered: orders.filter(o => o.status === 'delivered').length,
    refused: orders.filter(o => ['refused', 'cancelled'].includes(o.status)).length,
  };

  return (
    <div className="phar-section">
      <header className="phar-header">
        <div>
          <h1>Commandes</h1>
          <p>{orders.length} commande{orders.length > 1 ? 's' : ''} · refresh auto 15s</p>
        </div>
        <button className="phar-btn-sec" onClick={refresh}>🔄 Actualiser</button>
      </header>

      <div className="phar-filters">
        <button className={`phar-filter ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>
          🔔 À traiter ({counts.pending})
        </button>
        <button className={`phar-filter ${filter === 'preparing' ? 'active' : ''}`} onClick={() => setFilter('preparing')}>
          🛠️ En prépa ({counts.preparing})
        </button>
        <button className={`phar-filter ${filter === 'ready' ? 'active' : ''}`} onClick={() => setFilter('ready')}>
          ✅ Prêtes ({counts.ready})
        </button>
        <button className={`phar-filter ${filter === 'shipped' ? 'active' : ''}`} onClick={() => setFilter('shipped')}>
          🛵 En livraison ({counts.shipped})
        </button>
        <button className={`phar-filter ${filter === 'delivered' ? 'active' : ''}`} onClick={() => setFilter('delivered')}>
          🎉 Livrées ({counts.delivered})
        </button>
        <button className={`phar-filter ${filter === 'refused' ? 'active' : ''}`} onClick={() => setFilter('refused')}>
          ❌ Refusées ({counts.refused})
        </button>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center', padding: 40 }}>Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="phar-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>📦</div>
          <p>Aucune commande dans cette catégorie</p>
        </div>
      ) : (
        <div className="phar-orders-list">
          {filtered.map(o => {
            const myItems = (o.items || []).filter(it => it.pharmacyId === pharmacyId);
            const myRevenue = myItems.reduce((sum, it) => sum + (it.price || 0) * (it.qty || 1), 0);
            
            return (
              <div key={o.id} className="phar-order-card">
                <div className="phar-order-head">
                  <div>
                    <code>{o.id}</code>
                    <span className="phar-order-date">{new Date(o.created_at).toLocaleString('fr-FR')}</span>
                  </div>
                  <span className={`phar-badge phar-badge-${o.status}`}>
                    {o.status === 'paid' && '🔔 À traiter'}
                    {o.status === 'preparing' && '🛠️ En prépa'}
                    {o.status === 'ready' && '✅ Prête'}
                    {o.status === 'shipped' && '🛵 En route'}
                    {o.status === 'awaiting_cash' && '💵 Encaissement'}
                    {o.status === 'awaiting_confirm' && '⏳ Confirm cliente'}
                    {o.status === 'delivered' && '🎉 Livrée'}
                    {o.status === 'refused' && '❌ Refusée'}
                    {o.status === 'cancelled' && '❌ Annulée'}
                  </span>
                </div>

                <div className="phar-order-client">
                  <strong>👤 {o.address?.name}</strong>
                  <p>📞 <a href={`tel:${o.address?.phone}`}>{o.address?.phone}</a></p>
                  <p>📍 {o.address?.line}, {o.address?.city}</p>
                </div>

                <div className="phar-order-items">
                  {myItems.map((it, i) => (
                    <div key={i} className="phar-order-item">
                      <img src={it.img || 'https://placehold.co/40x40/F4F4F2/9B9B9B/png?text=?'} alt="" onError={(e) => e.target.style.display = 'none'} />
                      <div>
                        <strong>{it.name}</strong>
                        <span>×{it.qty} · {(it.price || 0).toLocaleString('fr-FR')} FCFA</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="phar-order-totals">
                  <div className="phar-order-row">
                    <span>Total à toi (ta part)</span>
                    <strong>{myRevenue.toLocaleString('fr-FR')} FCFA</strong>
                  </div>
                  <div className="phar-order-row phar-order-commission">
                    <span>Net après commission 8%</span>
                    <strong>{(myRevenue - Math.round(myRevenue * 0.08)).toLocaleString('fr-FR')} FCFA</strong>
                  </div>
                </div>

                {o.payment_method === 'cod' && (
                  <div className="phar-cod-alert">
                    💵 Cash à la livraison : {o.total?.toLocaleString('fr-FR')} FCFA
                  </div>
                )}

                {o.refusal_reason && (
                  <div className="phar-refused-box">
                    ⚠️ Motif refus : {o.refusal_reason}
                  </div>
                )}

                {/* ACTIONS */}
                <div className="phar-order-actions">
                  <a 
                    href={`https://wa.me/${(o.address?.phone || '').replace(/\D/g, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="phar-wa-btn"
                  >💬 WhatsApp cliente</a>
                  
                  {o.status === 'paid' && (
                    <>
                      <button className="phar-btn-success" onClick={() => handleAccept(o)}>
                        ✅ Accepter
                      </button>
                      <button className="phar-btn-danger" onClick={() => setRefusing(o)}>
                        ❌ Refuser
                      </button>
                    </>
                  )}
                  
                  {o.status === 'preparing' && (
                    <button className="phar-btn-success" onClick={() => handleReady(o)}>
                      ✅ Prête à livrer
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Refus */}
      {refusing && (
        <RefuseModal
          order={refusing}
          onRefuse={(reason) => handleRefuse(refusing, reason)}
          onCancel={() => setRefusing(null)}
        />
      )}
    </div>
  );
}

function RefuseModal({ order, onRefuse, onCancel }) {
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  const handleSubmit = () => {
    const final = reason === 'Autre' ? customReason : reason;
    if (!final.trim()) {
      alert('Sélectionne un motif');
      return;
    }
    onRefuse(final);
  };

  return (
    <div className="phar-modal-overlay" onClick={onCancel}>
      <div className="phar-modal" onClick={e => e.stopPropagation()}>
        <h3>❌ Refuser la commande {order.id}</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
          La cliente sera notifiée et remboursée si paiement digital
        </p>
        
        <div className="phar-refuse-reasons">
          {REFUSAL_REASONS.map(r => (
            <button
              key={r}
              className={`phar-refuse-reason ${reason === r ? 'active' : ''}`}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>

        {reason === 'Autre' && (
          <textarea
            value={customReason}
            onChange={e => setCustomReason(e.target.value)}
            placeholder="Précise la raison..."
            rows={3}
            style={{
              width: '100%', marginTop: 10, padding: 12,
              border: '1.5px solid #EEE', borderRadius: 10,
              fontSize: 13, fontFamily: 'inherit',
            }}
          />
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="phar-btn-sec" onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
          <button className="phar-btn-danger" onClick={handleSubmit} style={{ flex: 2 }}>
            ❌ Confirmer le refus
          </button>
        </div>
      </div>
    </div>
  );
}
