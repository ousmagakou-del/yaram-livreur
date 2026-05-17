import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { haptic } from '../lib/haptic';
import { getCartCount } from '../lib/cart';
import './TabBar.css';

export default function TabBar({ active = 'home', cartCount: overrideCount }) {
  const { navigate } = useNav();
  // Self-managed cart badge : on lit getCartCount() au mount et on s'abonne
  // a l'event 'yaram-cart-updated' (dispatche par lib/cart.js setCart).
  // Le prop cartCount, s'il est passe, override (back-compat).
  const [cartCount, setCartCount] = useState(() =>
    typeof overrideCount === 'number' ? overrideCount : getCartCount()
  );

  useEffect(() => {
    if (typeof overrideCount === 'number') {
      setCartCount(overrideCount);
      return;
    }
    const refresh = () => setCartCount(getCartCount());
    refresh(); // sync immediat au mount
    const onUpdate = (e) => {
      if (e?.detail?.items) {
        const total = e.detail.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
        setCartCount(total);
      } else {
        refresh();
      }
    };
    // Multi-tab : si un autre onglet modifie le panier
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

  const isActive = (n) => active === n;

  return (
    <div className="tabbar">
      <button className={`tab-item ${isActive('home') ? 'active' : ''}`} onClick={() => navigate('/')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>Accueil</span>
      </button>
      <button className={`tab-item ${isActive('search') ? 'active' : ''}`} onClick={() => navigate('/search')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span>Chercher</span>
      </button>
      <div className="tab-scan-wrap">
        <button className="tab-scan-btn" onClick={() => { haptic('medium'); navigate({ name: 'scan', params: {} }); }} aria-label="Scanner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
            <path d="M3 7V5a2 2 0 012-2h2"/>
            <path d="M17 3h2a2 2 0 012 2v2"/>
            <path d="M21 17v2a2 2 0 01-2 2h-2"/>
            <path d="M7 21H5a2 2 0 01-2-2v-2"/>
            <rect x="7" y="7" width="10" height="10" rx="1"/>
          </svg>
        </button>
      </div>
      <button className={`tab-item ${isActive('cart') ? 'active' : ''}`} onClick={() => navigate('/cart')}>
        <div style={{ position: 'relative' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
            <circle cx="9" cy="21" r="1"/>
            <circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
          </svg>
          {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
        </div>
        <span>Panier</span>
      </button>
      <button className={`tab-item ${isActive('profile') ? 'active' : ''}`} onClick={() => navigate('/profile')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <span>Profil</span>
      </button>
    </div>
  );
}
