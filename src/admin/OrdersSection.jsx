import { useState, useEffect } from 'react';
import { supabase, updateOrderStatus } from '../lib/supabase';

const STATUS_FLOW = ['pending_payment', 'paid', 'preparing', 'shipped', 'delivered'];
const STATUS_LABELS = {
  pending_payment: { label: 'Paiement en attente', color: 'medium', emoji: '⏳' },
  paid: { label: 'Payée', color: 'good', emoji: '✅' },
  preparing: { label: 'En préparation', color: 'good', emoji: '📦' },
  shipped: { label: 'En route', color: 'excellent', emoji: '🛵' },
  delivered: { label: 'Livrée', color: 'excellent', emoji: '🎉' },
  cancelled: { label: 'Annulée', color: 'bad', emoji: '❌' },
};

export default function OrdersSection() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    setOrders(data || []);
    if (selected) {
      const upd = (data || []).find(o => o.id === selected.id);
      if (upd) setSelected(upd);
    }
    setLoading(false);
  };

  const advance = async (order) => {
    const idx = STATUS_FLOW.indexOf(order.status);
    if (idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    await updateOrderStatus(order.id, next);
    refresh();
  };

  const cancel = async (order) => {
    if (!confirm('Annuler cette commande ?')) return;
    await updateOrderStatus(order.id, 'cancelled');
    refresh();
  };

  let filtered = filter === 'all' ? orders
    : filter === 'active' ? orders.filter(o => !['delivered', 'cancelled'].includes(o.status))
    : orders.filter(o => o.status === filter);

  if (search.trim()) {
    const s = search.toLowerCase();
    filtered = filtered.filter(o =>
      o.id.toLowerCase().includes(s) ||
      o.address?.name?.toLowerCase().includes(s) ||
      o.address?.phone?.toLowerCase().includes(s)
    );
  }

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Commandes</h1>
          <p>{orders.length} commandes au total</p>
        </div>
        <button className="adm-btn-sec" onClick={refresh}>🔄 Actualiser</button>
      </header>

      <input
        type="text"
        className="adm-search-input"
        placeholder="🔍 Rechercher par n° commande, nom, téléphone..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="adm-filters">
        {[
          { id: 'all', label: 'Toutes' },
          { id: 'active', label: 'En cours' },
          { id: 'pending_payment', label: '⏳ Paiement' },
          { id: 'paid', label: '✅ Payées' },
          { id: 'preparing', label: '📦 Prépa' },
          { id: 'shipped', label: '🛵 En route' },
          { id: 'delivered', label: '🎉 Livrées' },
        ].map(f => (
          <button
            key={f.id}
            className={`adm-filter ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="adm-filter-count">
              {f.id === 'all' ? orders.length
                : f.id === 'active' ? orders.filter(o => !['delivered', 'cancelled'].includes(o.status)).length
                : orders.filter(o => o.status === f.id).length}
            </span>
          </button>
        ))}
      </div>

      <div className="adm-split">
        <div className="adm-list">
          {loading ? (
            <div className="adm-empty">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="adm-empty">
              <div style={{ fontSize: 48, opacity: 0.2 }}>📦</div>
              <p>Aucune commande</p>
            </div>
          ) : (
            filtered.map(o => {
              const s = STATUS_LABELS[o.status];
              return (
                <button
                  key={o.id}
                  className={`adm-list-item ${selected?.id === o.id ? 'active' : ''}`}
                  onClick={() => setSelected(o)}
                >
                  <div className="adm-list-row">
                    <code>{o.id}</code>
                    <span className={`adm-badge ${s?.color}`}>{s?.emoji}</span>
                  </div>
                  <div className="adm-list-name">{o.address?.name || 'Anonyme'}</div>
                  <div className="adm-list-meta">
                    <span>{o.items?.length || 0} art. · {o.total?.toLocaleString('fr-FR')} FCFA</span>
                    <span>{new Date(o.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="adm-detail">
          {!selected ? (
            <div className="adm-empty" style={{ height: '100%' }}>
              <div style={{ fontSize: 48, opacity: 0.2 }}>👈</div>
              <p>Sélectionne une commande</p>
            </div>
          ) : (
            <OrderDetail order={selected} onAdvance={() => advance(selected)} onCancel={() => cancel(selected)} />
          )}
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ order, onAdvance, onCancel }) {
  const s = STATUS_LABELS[order.status];
  const canAdvance = STATUS_FLOW.indexOf(order.status) < STATUS_FLOW.length - 1;
  const nextStatus = canAdvance ? STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1]] : null;
  const waUrl = order.address?.phone ? 'https://wa.me/' + order.address.phone.replace(/\D/g, '') : null;

  return (
    <div className="adm-detail-content">
      <div className="adm-detail-head">
        <div>
          <code>{order.id}</code>
          <div className="adm-detail-date">{new Date(order.created_at).toLocaleString('fr-FR')}</div>
        </div>
        <span className={`adm-badge ${s?.color}`}>{s?.emoji} {s?.label}</span>
      </div>

      <div className="adm-detail-card">
        <h3>👤 Cliente</h3>
        <p><strong>{order.address?.name}</strong></p>
        <p>📞 <a href={`tel:${order.address?.phone}`}>{order.address?.phone}</a></p>
        <p>📍 {order.address?.line}</p>
        <p>{order.address?.neighborhood}, {order.address?.city}</p>
        {waUrl && (
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className="adm-wa-btn">
            💬 WhatsApp la cliente
          </a>
        )}
      </div>

      <div className="adm-detail-card">
        <h3>📦 Articles ({order.items?.length})</h3>
        {order.items?.map((it, i) => (
          <div key={i} className="adm-detail-item">
            <img src={it.img} alt="" />
            <div style={{ flex: 1 }}>
              <strong>{it.name}</strong>
              <div className="adm-detail-item-meta">
                <span>🏥 {it.pharmacyName}</span>
                <span>{it.qty} × {it.price.toLocaleString('fr-FR')} FCFA</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="adm-detail-card">
        <h3>💰 Total</h3>
        <div className="adm-row"><span>Sous-total</span><strong>{order.subtotal?.toLocaleString('fr-FR')} FCFA</strong></div>
        <div className="adm-row"><span>Livraison</span><strong>{order.shipping?.toLocaleString('fr-FR')} FCFA</strong></div>
        <div className="adm-row"><span>Paiement</span><strong>{order.payment_method}</strong></div>
        <div className="adm-row total"><span>Total</span><strong>{order.total?.toLocaleString('fr-FR')} FCFA</strong></div>
        <div className="adm-row commission"><span>Commission YARAM (17.5%)</span><strong>{Math.round(order.total * 0.175).toLocaleString('fr-FR')} FCFA</strong></div>
      </div>

      <div className="adm-detail-actions">
        {canAdvance && (
          <button className="adm-btn-pri" onClick={onAdvance}>
            ⚡ Passer à {nextStatus.emoji} {nextStatus.label}
          </button>
        )}
        {order.status !== 'delivered' && order.status !== 'cancelled' && (
          <button className="adm-btn-danger" onClick={onCancel}>Annuler</button>
        )}
      </div>
    </div>
  );
}
