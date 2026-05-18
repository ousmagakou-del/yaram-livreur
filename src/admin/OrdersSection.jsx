import { useState, useEffect } from 'react';
import { supabase, updateOrderStatus, getCachedSetting } from '../lib/supabase';
import { confirmDialog } from '../lib/toast';

// Flow lineaire des statuts "normaux" d'une commande. Une commande peut sortir
// de ce flow (refused, cancelled, disputed...) et ne plus etre "avancable".
const STATUS_FLOW = ['pending_payment', 'paid', 'preparing', 'ready', 'shipped', 'awaiting_confirm', 'delivered'];
const STATUS_LABELS = {
  pending_payment:   { label: 'Paiement en attente',  color: 'medium',    emoji: '⏳' },
  paid:              { label: 'Payée',                color: 'good',      emoji: '✅' },
  preparing:         { label: 'En préparation',       color: 'good',      emoji: '📦' },
  ready:             { label: 'Prête à livrer',       color: 'good',      emoji: '✔️' },
  shipped:           { label: 'En route',             color: 'excellent', emoji: '🛵' },
  awaiting_cash:     { label: 'Encaissement cash',    color: 'medium',    emoji: '💵' },
  awaiting_confirm:  { label: 'Confirm cliente',      color: 'medium',    emoji: '⌛' },
  client_confirmed:  { label: 'Confirmée cliente',    color: 'excellent', emoji: '🤝' },
  delivered:         { label: 'Livrée',               color: 'excellent', emoji: '🎉' },
  cancelled:         { label: 'Annulée',              color: 'bad',       emoji: '❌' },
  refused:           { label: 'Refusée',              color: 'bad',       emoji: '🚫' },
  disputed:          { label: 'Litige',               color: 'bad',       emoji: '⚠️' },
};

const PAGE_SIZE = 50;

export default function OrdersSection() {
  const [orders, setOrders] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Re-fetch quand on change de page OU de filtre
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, filter]);

  const refresh = async () => {
    setLoading(true);
    // ─── Server-side pagination + filtrage par statut ───
    // (Avant : on chargeait TOUTES les commandes a chaque fois — pas tenable a 10k+.)
    let q = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (filter === 'active') {
      q = q.not('status', 'in', '(delivered,cancelled,refused,disputed)');
    } else if (filter !== 'all') {
      q = q.eq('status', filter);
    }

    const { data, count } = await q;
    setOrders(data || []);
    setTotalCount(count || 0);
    if (selected) {
      const upd = (data || []).find(o => o.id === selected.id);
      if (upd) setSelected(upd);
    }
    setLoading(false);
  };

  // Reset page a 0 quand on change de filtre (via setFilter helper)
  const changeFilter = (f) => { setFilter(f); setPage(0); };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const advance = async (order) => {
    const idx = STATUS_FLOW.indexOf(order.status);
    // Safe guard : si le statut n'est pas dans le flow (refused, cancelled, disputed,
    // awaiting_cash, etc.), on ne fait rien plutot que de retrograder a pending_payment.
    if (idx === -1 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    await updateOrderStatus(order.id, next);
    refresh();
  };

  const cancel = async (order) => {
    if (!await confirmDialog('Annuler cette commande ?')) return;
    await updateOrderStatus(order.id, 'cancelled');
    refresh();
  };

  // Le filtrage par statut est deja fait cote serveur via .range/.eq.
  // La recherche reste cote client mais SEULEMENT sur la page courante.
  let filtered = orders;
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
          <p>
            {totalCount} commande{totalCount > 1 ? 's' : ''} au total
            {totalPages > 1 && ` · page ${page + 1}/${totalPages}`}
          </p>
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
            onClick={() => changeFilter(f.id)}
          >
            {f.label}
            {/* Compteur de la page courante uniquement — pour le total appliquer le filtre */}
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

          {/* ─── Pagination ─── */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 8px',
              borderTop: '1px solid #EEE',
              fontSize: 12,
            }}>
              <button
                className="adm-btn-sec"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                style={{ minWidth: 80 }}
              >← Préc.</button>
              <span style={{ color: '#6B6B6B', fontWeight: 600 }}>
                {page + 1} / {totalPages}
              </span>
              <button
                className="adm-btn-sec"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
                style={{ minWidth: 80 }}
              >Suiv. →</button>
            </div>
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
  const flowIdx = STATUS_FLOW.indexOf(order.status);
  // canAdvance vrai SEULEMENT si le statut est dans le flow ET n'est pas le dernier.
  // Sinon (refused, cancelled, disputed, etc.), le bouton "Avancer" est cache.
  const canAdvance = flowIdx >= 0 && flowIdx < STATUS_FLOW.length - 1;
  const nextStatus = canAdvance ? STATUS_LABELS[STATUS_FLOW[flowIdx + 1]] : null;
  // Taux commission dynamique depuis settings (fallback 8%)
  const rate = getCachedSetting('commission', 8) / 100;
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
        <div className="adm-row commission"><span>Commission YARAM ({rate * 100}%)</span><strong>{Math.round(order.total * rate).toLocaleString('fr-FR')} FCFA</strong></div>
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
