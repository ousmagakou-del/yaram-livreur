import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { getMyOrders, invalidateCache } from '../lib/supabase';
import { safeFormatDate } from '../lib/utils';
import TabBar from '../components/TabBar';
import PullToRefresh from '../components/PullToRefresh';
import './Orders.css';

export default function Orders() {
  const { navigate } = useNav();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getMyOrders();
      setOrders(data || []);
    } catch (e) {
      console.warn('[Orders] load failed:', e?.message);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  // Pull-to-refresh : invalide cache + reload
  const handlePullRefresh = async () => {
    try {
      const { supabase } = await import('../lib/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) invalidateCache(`my_orders_${session.user.id}`);
      await load();
      await new Promise(r => setTimeout(r, 300));
    } catch { /* silent */ }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyOrders();
        if (!cancelled) setOrders(data || []);
      } catch (e) {
        console.warn('[Orders] load failed:', e?.message);
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Auto-refresh sur retour navigation (popstate iOS)
    const handleRouteBack = (e) => {
      const target = e?.detail?.to?.name;
      if (target && target !== 'orders') return;
      load();
    };
    window.addEventListener('yaram-route-back', handleRouteBack);

    return () => {
      cancelled = true;
      window.removeEventListener('yaram-route-back', handleRouteBack);
    };
  }, []);

  return (
    <div className="orders-screen page-anim">
      <div className="orders-header">
        <button className="icon-back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1>Mes commandes</h1>
      </div>

      <div className="orders-scroll">
        <PullToRefresh onRefresh={handlePullRefresh}>
        {loading ? (
          <div style={{padding: 40, textAlign: 'center'}}>Chargement…</div>
        ) : orders.length === 0 ? (
          <div className="orders-empty">
            <div style={{fontSize: 64, opacity: 0.2}}>📦</div>
            <h3>Aucune commande</h3>
            <p>Tes commandes apparaîtront ici</p>
          </div>
        ) : (
          orders.map(o => (
            <button
              key={o.id}
              className="order-card"
              onClick={() => navigate({ name: 'order_tracking', params: { orderId: o.id } })}
            >
              <div className="order-card-head">
                <code>{o.id}</code>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {o.is_preorder && (
                    <span style={{
                      background: 'linear-gradient(135deg,#0066CC,#004999)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 6,
                      letterSpacing: 0.3,
                    }}>✈️ IMPORT</span>
                  )}
                  <span className={'order-status ' + o.status}>{o.status}</span>
                </div>
              </div>
              <div className="order-card-body">
                <span>{o.items.length} articles · {o.total.toLocaleString('fr-FR')} FCFA</span>
                <span>{safeFormatDate(o.created_at, { type: 'datetime' })}</span>
              </div>
              {o.is_preorder && o.expected_arrival_date && (
                <div style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px dashed var(--line)',
                  fontSize: 11,
                  color: 'var(--muted)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}>
                  <span>📅 Arrivée prévue : {safeFormatDate(o.expected_arrival_date)}</span>
                  <span style={{ color: '#0066CC', fontWeight: 600 }}>
                    {o.deposit_paid_at ? '✓ Acompte payé' : '⏳ Acompte en attente'}
                  </span>
                </div>
              )}
            </button>
          ))
        )}
        </PullToRefresh>
      </div>
      <TabBar />
    </div>
  );
}