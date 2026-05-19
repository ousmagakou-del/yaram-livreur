import { useState, createContext, useContext, useEffect, useRef, lazy, Suspense } from 'react';
import { supabase, getCurrentUser } from './lib/supabase';
import { maybeSendWelcomeEmail } from './lib/emails';
import { checkAndNotifyCartAbandon, notifyWelcome } from './lib/notifications';
import SplashScreen from './components/SplashScreen';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Search from './pages/Search';
import Product from './pages/Product';
import Cart from './pages/Cart';
import Orders from './pages/Orders';
import Profile from './pages/Profile';
import Pharmacies from './pages/Pharmacies';
import PharmacyDetail from './pages/PharmacyDetail';
import Addresses from './pages/Addresses';
import Favorites from './pages/Favorites';
import Payments from './pages/Payments';
import Evolution from './pages/Evolution';
import Categories from './pages/Categories';
import Loyalty from './pages/Loyalty';
import Referral from './pages/Referral';
import NotifSettings from './pages/NotifSettings';
import Promos from './pages/Promos';
import InstallPrompt from './components/InstallPrompt';
import WhatsAppButton from './components/WhatsAppButton';
import Toaster from './components/Toaster';
import NetworkStatus from './components/NetworkStatus';

// ─── Lazy-load : pages lourdes / rarement visitees par le client lambda ───
// Ces chunks ne sont telecharges qu'au moment ou la page est demandee.
const SkinQuiz      = lazy(() => import('./pages/SkinQuiz'));
const Checkout      = lazy(() => import('./pages/Checkout'));
const Payment       = lazy(() => import('./pages/Payment'));
const OrderTracking = lazy(() => import('./pages/OrderTracking'));
const Scan          = lazy(() => import('./pages/Scan'));
const ScanResult    = lazy(() => import('./pages/ScanResult'));
const ScanHistory   = lazy(() => import('./pages/ScanHistory'));
const Admin         = lazy(() => import('./pages/Admin'));
const Pharma        = lazy(() => import('./pages/Pharma'));
const Livreur       = lazy(() => import('./pages/Livreur'));
const ClientConfirm = lazy(() => import('./pages/ClientConfirm'));
const PiSpiTest     = lazy(() => import('./pages/PiSpiTest'));
const Privacy       = lazy(() => import('./pages/Privacy'));
const Terms         = lazy(() => import('./pages/Terms'));
const DeleteAccount = lazy(() => import('./pages/DeleteAccount'));

// Fallback leger pour Suspense (evite de re-trigger le SplashScreen plein-ecran)
function LazyFallback() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      color: '#1F8B4C',
      fontSize: 14,
      fontWeight: 600,
    }}>
      Chargement…
    </div>
  );
}

const NavContext = createContext(null);
export function useNav() { return useContext(NavContext); }

const UserContext = createContext(null);
export function useUser() { return useContext(UserContext); }

// Splash minimum display time (pour que ce soit visible meme si le auth est ultra rapide)
const SPLASH_MIN_DURATION = 600;

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
  
  const simpleRoutes = ['search', 'cart', 'checkout', 'orders', 'profile', 'pharmacies', 'scan', 'scan_history', 'addresses', 'favorites', 'payments', 'evolution', 'categories', 'quiz', 'loyalty', 'referral', 'notifications', 'promos', 'privacy', 'terms', 'delete_account'];
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
  // Routes top-level (non-client) : chunks separes, wrap dans Suspense.
  // Toaster est monte autour pour que toast.*() marche partout (admin, pharma, livreur, etc.).
  if (params.has('admin'))   return <><Suspense fallback={<SplashScreen />}><Admin /></Suspense><Toaster /></>;
  if (params.has('pharma'))  return <><Suspense fallback={<SplashScreen />}><Pharma /></Suspense><Toaster /></>;
  if (params.has('livreur')) return <><Suspense fallback={<SplashScreen />}><Livreur /></Suspense><Toaster /></>;
  if (params.has('confirm')) return <><Suspense fallback={<SplashScreen />}><ClientConfirm /></Suspense><Toaster /></>;
  if (params.has('pispi'))   return <><Suspense fallback={<SplashScreen />}><PiSpiTest /></Suspense><Toaster /></>;

  return <ClientApp />;
}

function ClientApp() {
  const initialRoute = typeof window !== 'undefined' 
    ? pathToRoute(window.location.pathname, window.location.search)
    : { name: 'home', params: {} };
  
  const [route, setRoute] = useState(initialRoute);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  // Splash minimum duration
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), SPLASH_MIN_DURATION);
    return () => clearTimeout(t);
  }, []);

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
    let isFirstLoad = true;
    
    // 1. Premier chargement : check session + fetch profil une seule fois
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        // Optim : passe la session deja recuperee a getCurrentUser pour eviter
        // un 2eme appel reseau (gain ~150ms au boot)
        getCurrentUser(session).then(u => {
          if (!cancelled) {
            const userObj = u || { id: session.user.id, email: session.user.email };
            setUser(userObj);
            setAuthChecked(true);
            // Welcome email si jamais envoye (Google OAuth, magic link, etc.)
            maybeSendWelcomeEmail(userObj).catch(() => { /* non-bloquant */ });
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

    // 2. Auth state change : NE FETCH QUE sur SIGN_IN ou SIGN_OUT, pas sur TOKEN_REFRESHED
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;
      // Ignore le premier event (INITIAL_SESSION) car deja gere ci-dessus
      // SAUF si c'est SIGNED_OUT : on doit toujours forcer la deconnexion (cas rare ou
      // signOut() arrive AVANT que getSession() initial ne termine).
      if (isFirstLoad && event !== 'SIGNED_OUT') { isFirstLoad = false; return; }
      isFirstLoad = false;
      // Ignore les refresh de token qui ne changent pas l'user
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
      
      if (session?.user) {
        try {
          const u = await getCurrentUser();
          if (!cancelled) {
            const userObj = u || { id: session.user.id, email: session.user.email };
            setUser(userObj);
            // Welcome email si jamais envoye (couvre Google OAuth + signup email/password)
            maybeSendWelcomeEmail(userObj).catch(() => { /* non-bloquant */ });
          }
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

  // ─── NOTIFICATIONS WHATSAPP : 1 SEULE FOIS PAR SESSION ───
  const notifsSentRef = useRef(false);
  useEffect(() => {
    if (!authChecked || !user?.id || !user?.phone) return;
    if (notifsSentRef.current) return; // Deja envoye dans cette session
    notifsSentRef.current = true;

    const welcomeTimer = setTimeout(() => {
      notifyWelcome({
        userId: user.id,
        phone: user.phone,
        firstName: user.first_name || user.name || 'toi',
      }).catch(() => {});
    }, 2000);

    const cartTimer = setTimeout(() => {
      checkAndNotifyCartAbandon({
        userId: user.id,
        phone: user.phone,
        firstName: user.first_name || 'toi',
      }).catch(() => {});
    }, 4000);

    return () => {
      clearTimeout(welcomeTimer);
      clearTimeout(cartTimer);
    };
  }, [authChecked, user?.id, user?.phone]);

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
    // Permet refreshUser(null) explicite pour deconnecter immediatement
    if (directUser !== undefined) { setUser(directUser); return; }
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch (e) {
      console.error('refreshUser error:', e);
    }
  };

  // ─── SPLASH (auth pas check OU splash min duration pas atteint) ───
  if (!authChecked || !splashDone) {
    return <SplashScreen />;
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
          <Toaster />
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
            <Suspense fallback={<LazyFallback />}>
              <SkinQuiz onComplete={refreshUser} />
            </Suspense>
            <InstallPrompt />
            <WhatsAppButton />
          </div>
          <Toaster />
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
    case 'privacy': page = <Suspense fallback={<LazyFallback />}><Privacy /></Suspense>; break;
    case 'terms': page = <Suspense fallback={<LazyFallback />}><Terms /></Suspense>; break;
    case 'delete_account': page = <Suspense fallback={<LazyFallback />}><DeleteAccount /></Suspense>; break;
    default: page = <Home />;
  }

  return (
    <NavContext.Provider value={{ navigate, goBack, route }}>
      <UserContext.Provider value={{ user, refreshUser }}>
        <div className="desktop-only-tag">YARAM · Aperçu mobile</div>
        <div className="app-shell">
          <Suspense fallback={<LazyFallback />}>{page}</Suspense>
          <InstallPrompt />
          <WhatsAppButton />
        </div>
        <NetworkStatus />
        <Toaster />
      </UserContext.Provider>
    </NavContext.Provider>
  );
}
