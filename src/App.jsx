import { useState, createContext, useContext, useEffect } from 'react';
import { supabase, getCurrentUser } from './lib/supabase';
import Onboarding from './pages/Onboarding';
import SkinQuiz from './pages/SkinQuiz';
import Home from './pages/Home';
import Search from './pages/Search';
import Product from './pages/Product';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Payment from './pages/Payment';
import OrderTracking from './pages/OrderTracking';
import Orders from './pages/Orders';
import Profile from './pages/Profile';
import Pharmacies from './pages/Pharmacies';
import Scan from './pages/Scan';
import ScanResult from './pages/ScanResult';
import ScanHistory from './pages/ScanHistory';
import Addresses from './pages/Addresses';
import Favorites from './pages/Favorites';
import Payments from './pages/Payments';
import Evolution from './pages/Evolution';
import Categories from './pages/Categories';
import Admin from './pages/Admin';
import Pharma from './pages/Pharma';
import Livreur from './pages/Livreur';
import ClientConfirm from './pages/ClientConfirm';
import Loyalty from './pages/Loyalty';
import InstallPrompt from './components/InstallPrompt';

const NavContext = createContext(null);
export function useNav() { return useContext(NavContext); }

const UserContext = createContext(null);
export function useUser() { return useContext(UserContext); }

export default function App() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (params.has('admin')) return <Admin />;
  if (params.has('pharma')) return <Pharma />;
  if (params.has('livreur')) return <Livreur />;
  if (params.has('confirm')) return <ClientConfirm />;

  return <ClientApp />;
}

function ClientApp() {
  const [route, setRoute] = useState({ name: 'home', params: {} });
  const [history, setHistory] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    
    const init = async () => {
      try {
        console.log('App: init start');
        const u = await getCurrentUser();
        console.log('App: user', u);
        if (!cancelled) {
          setUser(u);
          setAuthChecked(true);
        }
      } catch (e) {
        console.error('App init error:', e);
        if (!cancelled) {
          setUser(null);
          setAuthChecked(true);
        }
      }
    };
    
    init();
    
    const timeout = setTimeout(() => {
      if (!cancelled) {
        console.warn('App: auth check timeout');
        setAuthChecked(true);
      }
    }, 3000);

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (session) {
          const u = await getCurrentUser();
          if (!cancelled) setUser(u);
        } else {
          if (!cancelled) setUser(null);
        }
      } catch (e) {
        console.error('Auth state change error:', e);
      }
    });
    
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const navigate = (target) => {
    if (target === -1) { goBack(); return; }
    setHistory(h => [...h, route]);
    if (typeof target === 'string') {
      const path = target.split('?')[0].replace(/^\//, '');
      if (path.startsWith('product/')) {
        setRoute({ name: 'product', params: { id: path.split('/')[1] } });
      } else {
        const map = { '': 'home', search: 'search', cart: 'cart', profile: 'profile', orders: 'orders', pharmacies: 'pharmacies', scan: 'scan' };
        if (map[path] !== undefined) setRoute({ name: map[path], params: {} });
      }
    } else if (typeof target === 'object') {
      setRoute(target);
    }
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(h => h.slice(0, -1));
      setRoute(prev);
    } else {
      setRoute({ name: 'home', params: {} });
    }
  };

  const refreshUser = async (directUser) => {
    if (directUser) { setUser(directUser); return; }
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch (e) {
      console.error('refreshUser error:', e);
    }
  };

  if (!authChecked) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 88, height: 88, borderRadius: '50%',
          background: 'rgba(255,255,255,0.2)', border: '3px solid white',
          color: 'white', fontSize: 44, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>D</div>
        <div style={{ color: 'white', marginTop: 24, fontSize: 12, opacity: 0.7, letterSpacing: '0.2em', fontWeight: 600 }}>DIAARA</div>
      </div>
    );
  }

  if (!user) {
    return (
      <NavContext.Provider value={{ navigate, goBack, route }}>
        <UserContext.Provider value={{ user, refreshUser }}>
          <div className="desktop-only-tag">DIAARA · Aperçu mobile</div>
          <div className="app-shell">
            <Onboarding onComplete={refreshUser} />
            <InstallPrompt />
          </div>
        </UserContext.Provider>
      </NavContext.Provider>
    );
  }

  if (user && !user.skin_type) {
    return (
      <NavContext.Provider value={{ navigate, goBack, route }}>
        <UserContext.Provider value={{ user, refreshUser }}>
          <div className="desktop-only-tag">DIAARA · Aperçu mobile</div>
          <div className="app-shell">
            <SkinQuiz onComplete={refreshUser} />
            <InstallPrompt />
          </div>
        </UserContext.Provider>
      </NavContext.Provider>
    );
  }

  let page;
  switch (route.name) {
    case 'search': page = <Search initialCategory={route.params?.category} />; break;
    case 'product': page = <Product id={route.params.id} />; break;
    case 'cart': page = <Cart />; break;
    case 'checkout': page = <Checkout items={route.params.items} paymentMethod={route.params.paymentMethod} />; break;
    case 'payment': page = <Payment orderId={route.params.orderId} />; break;
    case 'order_tracking': page = <OrderTracking orderId={route.params.orderId} />; break;
    case 'orders': page = <Orders />; break;
    case 'profile': page = <Profile />; break;
    case 'pharmacies': page = <Pharmacies />; break;
    case 'scan': page = <Scan />; break;
    case 'scan_result': page = <ScanResult scanId={route.params.scanId} />; break;
    case 'scan_history': page = <ScanHistory />; break;
    case 'addresses': page = <Addresses />; break;
    case 'favorites': page = <Favorites />; break;
    case 'payments': page = <Payments />; break;
    case 'evolution': page = <Evolution />; break;
    case 'categories': page = <Categories />; break;
    case 'quiz': page = <SkinQuiz onComplete={refreshUser} />; break;
    case 'loyalty': page = <Loyalty />; break;
    default: page = <Home />;
  }

  return (
    <NavContext.Provider value={{ navigate, goBack, route }}>
      <UserContext.Provider value={{ user, refreshUser }}>
        <div className="desktop-only-tag">DIAARA · Aperçu mobile</div>
        <div className="app-shell">
          {page}
          <InstallPrompt />
        </div>
      </UserContext.Provider>
    </NavContext.Provider>
  );
}