import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { haptic } from '../lib/haptic';
import { getCartCount } from '../lib/cart';
import './TabBar.css';

// Compteur live notifications profil (commandes en cours / notifs)
// Lis depuis window.__yaramNotifCount si dispo, sinon 0.
// Sync via 'yaram-notifications-updated' event (dispatch optionnel).
function getNotifCount() {
  try {
    if (typeof window !== 'undefined' && typeof window.__yaramNotifCount === 'number') {
      return window.__yaramNotifCount;
    }
  } catch {}
  return 0;
}

export default function TabBar({ active = 'home', cartCount: overrideCount }) {
  const { navigate } = useNav();

  // Cart badge (back-compat : on garde le badge live meme si pas affiche sur tab)
  const [cartCount, setCartCount] = useState(() =>
    typeof overrideCount === 'number' ? overrideCount : getCartCount()
  );
  // Notif badge live (commandes / profil)
  const [notifCount, setNotifCount] = useState(() => getNotifCount());
  // Animation bounce sur tab actif au mount/switch
  const [bounceKey, setBounceKey] = useState(active);

  useEffect(() => {
    setBounceKey(active);
  }, [active]);

  useEffect(() => {
    if (typeof overrideCount === 'number') {
      setCartCount(overrideCount);
      return;
    }
    const refresh = () => setCartCount(getCartCount());
    refresh();
    const onUpdate = (e) => {
      if (e?.detail?.items) {
        const total = e.detail.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
        setCartCount(total);
      } else {
        refresh();
      }
    };
    const onStorage = (e) => {
      if (e.key === 'yaram_cart') refresh();
    };
    window.addEventListener('yaram-cart-updated', onUpdate);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('yaram-cart-updated', onUpdate);
      window.removeEventListener('storage', onStorage);
    };
  }, [overrideCount]);

  useEffect(() => {
    const refresh = () => setNotifCount(getNotifCount());
    refresh();
    const onUpdate = (e) => {
      if (typeof e?.detail?.count === 'number') setNotifCount(e.detail.count);
      else refresh();
    };
    window.addEventListener('yaram-notifications-updated', onUpdate);
    return () => window.removeEventListener('yaram-notifications-updated', onUpdate);
  }, []);

  // Mapping : active="cart" ou "notifications" -> on highlight Profil (fallback)
  const resolvedActive = (() => {
    if (active === 'cart') return 'home'; // pas de tab cart -> fallback home
    if (active === 'notifications') return 'profile';
    return active;
  })();
  const isActive = (n) => resolvedActive === n;

  const onTap = (path) => {
    try { haptic('light'); } catch {}
    try { if (navigator?.vibrate) navigator.vibrate(15); } catch {}
    navigate(path);
  };

  const onScanTap = () => {
    try { haptic('medium'); } catch {}
    try { if (navigator?.vibrate) navigator.vibrate(20); } catch {}
    navigate({ name: 'scan', params: {} });
  };

  return (
    <div className="tabbar tabbar-glass">
      <button
        className={`tab-item ${isActive('home') ? 'active' : ''}`}
        onClick={() => onTap('/')}
        aria-label="Accueil"
      >
        <span className={`tab-ico ${isActive('home') ? 'bounce' : ''}`} key={`home-${bounceKey}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </span>
        <span className="tab-label">Accueil</span>
      </button>

      <button
        className={`tab-item ${isActive('search') ? 'active' : ''}`}
        onClick={() => onTap('/search')}
        aria-label="Recherche"
      >
        <span className={`tab-ico ${isActive('search') ? 'bounce' : ''}`} key={`search-${bounceKey}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <span className="tab-label">Recherche</span>
      </button>

      <div className="tab-scan-wrap">
        <button
          className="tab-scan-btn"
          onClick={onScanTap}
          aria-label="Scanner"
        >
          <span className="tab-scan-glow" aria-hidden="true" />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26">
            <path d="M12 3l1.6 3.4L17 8l-3.4 1.6L12 13l-1.6-3.4L7 8l3.4-1.6L12 3z"/>
            <path d="M19 14l.9 1.9L22 17l-2.1.9L19 20l-.9-2.1L16 17l1.9-1.1L19 14z"/>
            <path d="M5 15l.7 1.5L7 17l-1.3.5L5 19l-.7-1.5L3 17l1.3-.5L5 15z"/>
          </svg>
        </button>
      </div>

      <button
        className={`tab-item ${isActive('orders') ? 'active' : ''}`}
        onClick={() => onTap('/orders')}
        aria-label="Commandes"
      >
        <span className={`tab-ico ${isActive('orders') ? 'bounce' : ''}`} key={`orders-${bounceKey}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          {notifCount > 0 && <span className="tab-badge">{notifCount > 9 ? '9+' : notifCount}</span>}
        </span>
        <span className="tab-label">Commandes</span>
      </button>

      <button
        className={`tab-item ${isActive('profile') ? 'active' : ''}`}
        onClick={() => onTap('/profile')}
        aria-label="Profil"
      >
        <span className={`tab-ico ${isActive('profile') ? 'bounce' : ''}`} key={`profile-${bounceKey}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          {cartCount > 0 && <span className="tab-badge tab-badge-cart" title={`${cartCount} article(s) dans le panier`}>{cartCount > 9 ? '9+' : cartCount}</span>}
        </span>
        <span className="tab-label">Profil</span>
      </button>
    </div>
  );
}
