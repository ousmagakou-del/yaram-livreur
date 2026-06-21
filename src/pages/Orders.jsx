import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { getMyOrders, invalidateCache, supabase } from '../lib/supabase';
import { safeFormatDate } from '../lib/utils';
import TabBar from '../components/TabBar';
import PullToRefresh from '../components/PullToRefresh';
import './Orders.css';

export default function Orders() {
  const { navigate } = useNav();
  const { user } = useUser();
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
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) invalidateCache(`my_orders_${session.user.id}`);
      await load();
      await new Promise(r => setTimeout(r, 300));
    } catch { /* silent */ }
  };

  useEffect(() => {
    let cancelled = false;
    // FIX juin 2026 v2 : le useEffect attendait []. Si user n'était pas
    // encore prêt au 1er mount → return [] → cache poison → page reste vide.
    // Maintenant : on dépend de user?.id, on skip si pas user, et on re-fetch
    // dès que user devient disponible.
    if (!user?.id) {
      setLoading(true);
      return;
    }
    (async () => {
      try {
        // Purge brute force tout cache 'my_orders_*' (toutes versions LS)
        try {
          invalidateCache(`my_orders_${user.id}`);
          const toDel = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && /^yaram_cache_v\d+_my_orders_/.test(k)) toDel.push(k);
          }
          toDel.forEach(k => localStorage.removeItem(k));
        } catch {}

        const data = await getMyOrders();
        if (!cancelled) setOrders(data || []);
      } catch (e) {
        console.warn('[Orders] load failed:', e?.message);
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // ─── Auto-refresh sur retour navigation (popstate iOS) ───
    // FIX : la condition etait inversee → la page ne se rafraichissait jamais
    // apres avoir passe une commande (retour depuis Checkout/OrderTracking).
    // Maintenant : on rafraichit quand la destination est 'orders' OU quand
    // 'to' est absent (popstate sans detail) → couvre les deux cas.
    // Avant cache : `if (target && target !== 'orders') return;` ← inversé/cassé.
    const handleRouteBack = (e) => {
      const target = e?.detail?.to?.name;
      // Si on connait la destination et que ce n'est PAS orders, on skip.
      // Sinon (destination = orders, ou destination inconnue), on reload.
      if (target && target !== 'orders') return;
      // Invalide le cache avant de recharger pour forcer un vrai re-fetch DB.
      // Sans ca, cachedFetch ressert l'ancien resultat → la nouvelle commande
      // n'apparait pas tant que le TTL n'a pas expire.
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) invalidateCache(`my_orders_${session.user.id}`);
        } catch { /* silent */ }
        load();
      })();
    };
    window.addEventListener('yaram-route-back', handleRouteBack);

    // FIX v7 : refresh aussi au resume app (Capacitor / PWA)
    const handleAppResumed = () => {
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) invalidateCache(`my_orders_${session.user.id}`);
        } catch { /* silent */ }
        load();
      })();
    };
    window.addEventListener('yaram-app-resumed', handleAppResumed);

    return () => {
      cancelled = true;
      window.removeEventListener('yaram-route-back', handleRouteBack);
      window.removeEventListener('yaram-app-resumed', handleAppResumed);
    };
  }, [user?.id]);

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
          /* PERF : skeleton rows qui ressemblent à des order cards */
          <div style={{ padding: '12px 16px' }}>
            {[0, 1, 2].map((i) => (
              <div key={'sk-' + i} style={{
                display: 'flex', gap: 12, padding: 14, marginBottom: 12,
                background: '#fff', borderRadius: 14, border: '1px solid #eef3f0', opacity: 0.6,
              }}>
                <div style={{ width: 48, height: 48, borderRadius: 8, background: 'linear-gradient(90deg, #eef3f0 0%, #f7faf8 50%, #eef3f0 100%)', backgroundSize: '200% 100%', animation: 'yaramShimmer 1.4s linear infinite' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ width: '70%', height: 14, background: '#eef3f0', borderRadius: 4, marginBottom: 8 }} />
                  <div style={{ width: '40%', height: 11, background: '#eef3f0', borderRadius: 4 }} />
                </div>
              </div>
            ))}
            <style>{`@keyframes yaramShimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
          </div>
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
                <span>{(o.items?.length || 0)} articles · {Number(o.total || 0).toLocaleString('fr-FR')} FCFA</span>
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