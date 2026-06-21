import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotificationsCount,
} from '../lib/supabase';
import TabBar from '../components/TabBar';
import { toast } from '../lib/toast';
import './Notifications.css';

// ─── Page Notifications — liste des notifs reçues ─────────────────────
// - Lit `public.notifications` filtré par user (RLS auto via auth.uid())
// - Real-time : nouvelle notif arrive → liste se met à jour sans refresh
// - Tap sur notif → marque comme lue + navigue vers notif.url si défini
// - Bouton "Tout marquer lu" en haut à droite
// - Empty state propre + skeleton loading
// ─────────────────────────────────────────────────────────────────────────

function timeAgo(date) {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `il y a ${Math.floor(diff / 86400)} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function typeIcon(type) {
  switch ((type || '').toLowerCase()) {
    case 'order_status':
    case 'order':       return '📦';
    case 'payment':     return '💳';
    case 'delivery':    return '🛵';
    case 'promo':       return '🎉';
    case 'welcome':     return '👋';
    case 'review':      return '⭐';
    case 'reminder':    return '⏰';
    default:            return '🔔';
  }
}

export default function Notifications() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = async () => {
    try {
      const list = await getMyNotifications(100);
      setNotifs(list);
    } catch (e) {
      console.warn('[Notifs] load error:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // ─── Real-time subscription : nouvelle notif arrive → refresh liste ───
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeNotificationsCount(user.id, () => {
      load();
    });
    return unsub;
  }, [user?.id]);

  const handleTap = async (notif) => {
    if (!notif.read) {
      // Optimistic UI
      setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
      markNotificationRead(notif.id).catch(() => { /* swallow */ });
    }
    // Navigation : url = chemin interne (/order/abc) ou route name
    if (notif.url) {
      if (notif.url.startsWith('/')) {
        // chemin → on convertit en route via pathToRoute
        window.history.pushState(null, '', notif.url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        navigate({ name: notif.url, params: {} });
      }
    }
  };

  const handleMarkAll = async () => {
    if (markingAll) return;
    setMarkingAll(true);
    // Optimistic
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    const count = await markAllNotificationsRead();
    setMarkingAll(false);
    if (count > 0) toast.success(`${count} notification${count > 1 ? 's' : ''} marquée${count > 1 ? 's' : ''} lue${count > 1 ? 's' : ''}`);
  };

  const unreadCount = notifs.filter(n => !n.read).length;

  return (
    <div className="notif-screen page-anim">
      <header className="notif-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="notif-header-title">
          <h1>Notifications</h1>
          {unreadCount > 0 && <p>{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</p>}
        </div>
        {unreadCount > 0 && (
          <button
            className="notif-mark-all"
            onClick={handleMarkAll}
            disabled={markingAll}
            aria-busy={markingAll}
          >
            {markingAll ? '…' : 'Tout lire'}
          </button>
        )}
      </header>

      <main className="notif-main">
        {loading && (
          <div className="notif-skeletons">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="notif-skeleton" />
            ))}
          </div>
        )}

        {!loading && notifs.length === 0 && (
          <div className="notif-empty">
            <div className="notif-empty-icon">🔕</div>
            <h3>Pas de notifications</h3>
            <p>Tu seras prévenu·e ici quand on a quelque chose pour toi : promos, suivi de commande, livraison…</p>
            <button className="btn-primary" onClick={() => navigate({ name: 'home', params: {} })}>
              Découvrir le catalogue →
            </button>
          </div>
        )}

        {!loading && notifs.length > 0 && (
          <ul className="notif-list">
            {notifs.map((n) => (
              <li
                key={n.id}
                className={`notif-item ${n.read ? 'read' : 'unread'}`}
                onClick={() => handleTap(n)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTap(n); }}
              >
                <div className="notif-item-icon">
                  {n.icon ? <img src={n.icon} alt="" /> : <span>{typeIcon(n.type)}</span>}
                </div>
                <div className="notif-item-body">
                  <div className="notif-item-head">
                    <strong className="notif-item-title">{n.title || 'YARAM'}</strong>
                    <span className="notif-item-time">{timeAgo(n.sent_at)}</span>
                  </div>
                  {n.body && <p className="notif-item-text">{n.body}</p>}
                </div>
                {!n.read && <span className="notif-item-dot" aria-label="Non lue" />}
              </li>
            ))}
          </ul>
        )}

        <div style={{ height: 100 }} />
      </main>

      <TabBar active="notifications" />
    </div>
  );
}
