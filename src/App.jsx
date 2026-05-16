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
import PharmacyDetail from './pages/PharmacyDetail';
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
import PiSpiTest from './pages/PiSpiTest';
import Loyalty from './pages/Loyalty';
import Referral from './pages/Referral';
import NotifSettings from './pages/NotifSettings';
import Promos from './pages/Promos';
import InstallPrompt from './components/InstallPrompt';
import WhatsAppButton from './components/WhatsAppButton';

const NavContext = createContext(null);
export function useNav() { return useContext(NavContext); }

const UserContext = createContext(null);
export function useUser() { return useContext(UserContext); }

// ─── Helpers route ↔ URL ───
function routeToPath(route) {
  if (!route || !route.name || route.name === 'home') return '/';
  const params = route.params || {};
  switch (route.name) {
    case 'product': return `/product/${params.id}`;
    case 'pharmacy_detail': return `/pharmacy/${params.id}`;
    case 'order_tracking': return `/order/${params.orderId}`;
    case 'scan_result': return `/scan/result/${params.scanId}`;
    case 'payment': return `/payment/${params.orderId}`;
    case 'search': 
      if (params.category) return `/search?category=${encodeURIComponent(params.category)}`;
      if (params.brand) return `/search?brand=${encodeURIComponent(params.brand)}`;
      return '/search';
    default: return `/${route.name}`;
  }
}

function pathToRoute(pathname, search = '') {
  const path = pathname.replace(/^\//, '');
  const searchParams = new URLSearchParams(search);
  
  if (path === '' || path === '/') return { name: 'home', params: {} };
  
  const parts = path.split('/');
  
  if (parts[0] === 'product' && parts[1]) return { name: 'product', params: { id: parts[1] } };
  if (parts[0] === 'pharmacy' && parts[1]) return { name: 'pharmacy_detail', params: { id: parts[1] } };
  if (parts[0] === 'order' && parts[1]) return { name: 'order_tracking', params: { orderId: parts[1] } };
  if (parts[0] === 'scan' && parts[1] === 'result' && parts[2]) return { name: 'scan_result', params: { scanId: parts[2] } };
  if (parts[0] === 'payment' && parts[1]) return { name: 'payment', params: { orderId: parts[1] } };
  
  const simpleRoutes = ['search', 'cart', 'checkout', 'orders', 'profile', 'pharmacies', 'scan', 'scan_history', 'addresses', 'favorites', 'payments', 'evolution', 'categories', 'quiz', 'loyalty', 'referral', 'notifications', 'promos'];
  if (simpleRoutes.includes(parts[0])) {
    const params = {};
    if (parts[0] === 'search') {
      const cat = searchParams.get('category');
      if (cat) params.category = cat;
      const br = searchParams.get('brand');
      if (br) params.brand = br;
    }
    return { name: parts[0], params };
  }
  
  return { name: 'home', params: {} };
}

export default function App() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (params.has('admin')) return <Admin />;
  if (params.has('pharma')) return <Pharma />;
  if (params.has('livreur')) return <Livreur />;
  if (params.has('confirm')) return <ClientConfirm />;
  if (params.has('pispi')) return <PiSpiTest />;

  return <ClientApp />;
}

function ClientApp() {
  const initialRoute = typeof window !== 'undefined' 
    ? pathToRoute(window.location.pathname, window.location.search)
    : { name: 'home', params: {} };
  
  const [route, setRoute] = useState(initialRoute);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const handlePopState = () => {
      const newRoute = pathToRoute(window.location.pathname, window.location.search);
      setRoute(newRoute);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        getCurrentUser().then(u => {
          if (!cancelled) {
            setUser(u || { id: session.user.id, email: session.user.email });
            setAuthChecked(true);
          }
        }).catch(() => {
          if (!cancelled) {
            setUser({ id: session.user.id, email: session.user.email });
            setAuthChecked(true);
          }
        });
      } else {
        setUser(null);
        setAuthChecked(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setUser(null);
        setAuthChecked(true);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      if (session?.user) {
        try {
          const u = await getCurrentUser();
          if (!cancelled) setUser(u || { id: session.user.id, email: session.user.email });
        } catch (e) {
          if (!cancelled) setUser({ id: session.user.id, email: session.user.email });
        }
      } else {
        if (!cancelled) setUser(null);
      }
    });
    
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const navigate = (target) => {
    if (target === -1) { goBack(); return; }
    
    let newRoute;
    
    if (typeof target === 'string') {
      const path = target.split('?')[0].replace(/^\//, '');
      if (path.startsWith('product/')) {
        newRoute = { name: 'product', params: { id: path.split('/')[1] } };
      } else {
        const map = { '': 'home', search: 'search', cart: 'cart', profile: 'profile', orders: 'orders', pharmacies: 'pharmacies', scan: 'scan', promos: 'promos', loyalty: 'loyalty' };
        newRoute = { name: map[path] || 'home', params: {} };
      }
    } else if (typeof target === 'object') {
      newRoute = target;
    } else {
      return;
    }
    
    const newPath = routeToPath(newRoute);
    if (newPath !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', newPath);
    }
    
    setRoute(newRoute);
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  const goBack = () => {
    window.history.back();
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

  // ─── SPLASH SCREEN YARAM ───
  if (!authChecked) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          color: 'white',
          fontSize: 56,
          fontWeight: 900,
          letterSpacing: '0.15em',
          textShadow: '0 4px 24px rgba(0,0,0,0.3)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>YARAM</div>
        <div style={{ 
          color: 'white', 
          marginTop: 16, 
          fontSize: 11, 
          opacity: 0.7, 
          letterSpacing: '0.3em', 
          fontWeight: 500,
        }}>BEAUTÉ SÉNÉGAL</div>
      </div>
    );
  }

  if (!user) {
    return (
      <NavContext.Provider value={{ navigate, goBack, route }}>
        <UserContext.Provider value={{ user, refreshUser }}>
          <div className="desktop-only-tag">YARAM · Aperçu mobile</div>
          <div className="app-shell">
            <Onboarding onComplete={refreshUser} />
            <InstallPrompt />
            <WhatsAppButton />
          </div>
        </UserContext.Provider>
      </NavContext.Provider>
    );
  }

  if (user && !user.skin_type) {
    return (
      <NavContext.Provider value={{ navigate, goBack, route }}>
        <UserContext.Provider value={{ user, refreshUser }}>
          <div className="desktop-only-tag">YARAM · Aperçu mobile</div>
          <div className="app-shell">
            <SkinQuiz onComplete={refreshUser} />
            <InstallPrompt />
            <WhatsAppButton />
          </div>
        </UserContext.Provider>
      </NavContext.Provider>
    );
  }

  let page;
  switch (route.name) {
    case 'search': page = <Search initialCategory={route.params?.category} initialBrand={route.params?.brand} />; break;
    case 'product': page = <Product id={route.params.id} />; break;
    case 'cart': page = <Cart />; break;
    case 'checkout': page = <Checkout items={route.params.items} paymentMethod={route.params.paymentMethod} />; break;
    case 'payment': page = <Payment orderId={route.params.orderId} />; break;
    case 'order_tracking': page = <OrderTracking orderId={route.params.orderId} />; break;
    case 'orders': page = <Orders />; break;
    case 'profile': page = <Profile />; break;
    case 'pharmacies': page = <Pharmacies />; break;
    case 'pharmacy_detail': page = <PharmacyDetail pharmacyId={route.params.id} />; break;
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
    case 'referral': page = <Referral />; break;
    case 'notifications': page = <NotifSettings />; break;
    case 'promos': page = <Promos />; break;
    default: page = <Home />;
  }

  return (
    <NavContext.Provider value={{ navigate, goBack, route }}>
      <UserContext.Provider value={{ user, refreshUser }}>
        <div className="desktop-only-tag">YARAM · Aperçu mobile</div>
        <div className="app-shell">
          {page}
          <InstallPrompt />
          <WhatsAppButton />
        </div>
      </UserContext.Provider>
    </NavContext.Provider>
  );
}
