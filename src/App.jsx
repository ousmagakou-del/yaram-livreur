import { useState, createContext, useContext, useEffect, useRef, lazy, Suspense } from 'react';
import { supabase, getCurrentUser, getAllProducts, getAllBrands, getProductCategorySlugs } from './lib/supabase';
import { maybeSendWelcomeEmail } from './lib/emails';
import { checkAndNotifyCartAbandon, notifyWelcome } from './lib/notifications';
import { initPush, setupPushForUser } from './lib/push';
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
import InterstitialPromo from './components/InterstitialPromo';
import { getNextPromo, computeUserStats } from './lib/promos';
import NetworkStatus from './components/NetworkStatus';
import ErrorBoundary from './components/ErrorBoundary';

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
const International = lazy(() => import('./pages/International'));

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
  
  const simpleRoutes = ['search', 'cart', 'checkout', 'orders', 'profile', 'pharmacies', 'scan', 'scan_history', 'addresses', 'favorites', 'payments', 'evolution', 'categories', 'quiz', 'loyalty', 'referral', 'notifications', 'promos', 'privacy', 'terms', 'delete_account', 'international'];
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

  // PERF : pre-warm du cache des qu'on est cote client.
  // Fire-and-forget : declenche les requetes les plus communes en parallele
  // pendant que le splash est encore affiche. Resultat : quand l'user clique
  // sur Search / Categories, les donnees sont DEJA en cache memoire (instant).
  // Sur 4G Senegal ca economise 1-3 sec de wait sur les 2 premiers ecrans.
  useEffect(() => {
    // setTimeout(0) = ne pas bloquer le render initial
    const t = setTimeout(() => {
      getAllProducts().catch(() => { /* silent : sera retry au vrai usage */ });
      getAllBrands().catch(() => { /* silent */ });
      getProductCategorySlugs().catch(() => { /* silent */ });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // PUSH NOTIFICATIONS : init OneSignal SDK au boot (no-op sur web).
  // Ne demande PAS la permission encore (on le fera après login pour avoir
  // un meilleur taux d'acceptation : "j'ai mon compte, j'autorise les notifs").
  useEffect(() => {
    initPush().catch(() => { /* silent : push optionnel, ne doit pas bloquer */ });
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  //  REPRISE APRÈS BACKGROUND (fix lenteur quand on revient sur l'app)
  // ═══════════════════════════════════════════════════════════════════
  // Quand iOS / Android mettent l'app en background pendant 5+ min :
  //   - La JS context peut être gelée (fetches en attente bloqués)
  //   - Le JWT Supabase expire (par défaut 1h)
  //   - Les realtime channels sont coupés
  // Au retour, l'app paraît "stuck" : les fetches relancés tombent sur des
  // sessions périmées et hang sans erreur.
  //
  // Fix : on détecte la reprise, on refresh la session, et on dispatche un
  // event que les pages peuvent écouter pour relancer leur loadData.
  const [resumeCount, setResumeCount] = useState(0);
  useEffect(() => {
    let lastHiddenAt = null;
    const RESUME_THRESHOLD_MS = 60 * 1000; // 1 min : si on revient après ça, on refresh

    const handleVisibility = async () => {
      if (document.hidden) {
        lastHiddenAt = Date.now();
        return;
      }
      // L'app revient au foreground
      const awayDuration = lastHiddenAt ? Date.now() - lastHiddenAt : 0;
      if (awayDuration < RESUME_THRESHOLD_MS) return; // <1 min : pas besoin

      console.log('[App] Resume after', Math.round(awayDuration / 1000), 's away — refreshing...');
      try {
        // 1. Refresh la session Supabase (re-valide le JWT, refresh si expiré)
        const { error } = await supabase.auth.refreshSession();
        if (error) {
          console.warn('[App] session refresh failed:', error.message);
          if (error.message?.includes('refresh_token') || error.message?.includes('expired')) {
            window.location.reload();
            return;
          }
        }

        // 2. Invalide les caches critiques qui peuvent être obsolètes
        //    + purge les promises en-vol zombies (TCP fermé par iOS)
        try {
          const supabaseMod = await import('./lib/supabase');
          // Invalide les caches data qui changent (produits, pharmas, brands, banners)
          ['all_products', 'all_pharmacies', 'all_brands', 'all_banners', 'active_banners', 'site_settings']
            .forEach(k => supabaseMod.invalidateCache?.(k));

          // Purge les fetches en-vol zombies (>10s) qui bloqueraient les nouveaux appelants
          const cacheMod = await import('./lib/dataCache');
          cacheMod.purgeStaleInflight?.();
        } catch { /* noop */ }

        // 3. Dispatch event que les pages peuvent écouter pour reload
        window.dispatchEvent(new CustomEvent('yaram-app-resumed', {
          detail: { awayDuration },
        }));

        // 4. Force remount de la page courante en bumpant le compteur
        // (inclus dans pageKey plus bas → toute la page se reload "from scratch")
        setResumeCount(c => c + 1);
      } catch (e) {
        console.warn('[App] resume handler error:', e?.message);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) handleVisibility();
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const newRoute = pathToRoute(window.location.pathname, window.location.search);
      // Scroll en haut + set route en même temps pour un retour fluide
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
      setRoute(newRoute);

      // ─── Auto-refresh sur retour iOS ───
      // Note : avec le key={pageKey} dans <Suspense>, chaque navigation force
      // un remount complet de la page, donc useEffect re-fetch les données auto.
      // Le yaram-route-back reste utile pour les pages qui veulent un refresh
      // sans remount complet (rare).
      try {
        window.dispatchEvent(new CustomEvent('yaram-route-back', {
          detail: { to: newRoute },
        }));
      } catch { /* ignore */ }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ─── Universal Links iOS / App Links Android ───
  // Quand un user clique sur https://yaram.app/order/XXX dans son email ou WhatsApp,
  // iOS ouvre directement l'app YARAM (si AASA bien hébergé + entitlement OK)
  // au lieu de Safari. On reçoit l'URL ici et on route vers la bonne page.
  useEffect(() => {
    let sub = null;
    (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        sub = await CapApp.addListener('appUrlOpen', ({ url }) => {
          try {
            console.log('[YARAM] appUrlOpen:', url);
            const u = new URL(url);
            const newRoute = pathToRoute(u.pathname, u.search);
            window.history.pushState(null, '', u.pathname + u.search);
            window.scrollTo(0, 0);
            setRoute(newRoute);
          } catch (e) {
            console.warn('[YARAM] appUrlOpen parse error:', e?.message);
          }
        });
      } catch {
        // Web build : @capacitor/app pas disponible, on no-op
      }
    })();
    return () => { try { sub?.remove?.(); } catch {} };
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

  // ─── PUSH NOTIFICATIONS : setup après login (popup permission iOS + save device en DB) ───
  // Délai de 3 secondes pour laisser l'user "atterrir" sur l'app avant de
  // lui demander la permission (= meilleur taux d'acceptation).
  // No-op sur web (le helper isNativeApp() check ça).
  const pushSetupRef = useRef(false);
  useEffect(() => {
    if (!authChecked || !user?.id) return;
    if (pushSetupRef.current) return;
    pushSetupRef.current = true;

    // PERF : pre-charge les favoris du user dans le cache global immédiatement
    // pour que tous les ProductTile soient instant sans queries individuelles.
    import('./lib/supabase').then(mod => mod.preloadFavorites?.()).catch(() => {});

    const t = setTimeout(() => {
      setupPushForUser(user).catch(() => { /* silent : push optionnel, ne doit pas bloquer */ });
    }, 3000);
    return () => clearTimeout(t);
  }, [authChecked, user?.id]);

  // ─── Interstitial Promos : fetch + affichage au boot Home ───
  // Affiche une promo plein écran 1.5s après l'arrivée sur Home (laisse le temps
  // à l'écran de rendre, puis interstitiel). Frequency contrôlée DB-side.
  const [activePromo, setActivePromo] = useState(null);
  const promoFetchRef = useRef(false);
  useEffect(() => {
    if (!authChecked) return;
    if (promoFetchRef.current) return;
    // Ne fetch qu'au 1er render Home (pas sur les pages internes)
    if (route?.name && route.name !== 'home') return;
    promoFetchRef.current = true;

    const t = setTimeout(async () => {
      try {
        const userStats = user?.id ? await computeUserStats(user) : {};
        const promo = await getNextPromo({
          placement: 'home',
          user,
          userStats,
        });
        if (promo) setActivePromo(promo);
      } catch { /* silent */ }
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user?.id, route?.name]);

  const navigate = (target) => {
    if (target === -1) { goBack(); return; }
    
    let newRoute;
    
    if (typeof target === 'string') {
      const path = target.split('?')[0].replace(/^\//, '');
      if (path.startsWith('product/')) {
        newRoute = { name: 'product', params: { id: path.split('/')[1] } };
      } else {
        // Map exhaustif : couvre TOUTES les routes du switch principal
        // (sinon route inconnue → fallback home silencieux, gros source de bugs)
        const map = {
          '': 'home',
          home: 'home',
          search: 'search',
          cart: 'cart',
          profile: 'profile',
          orders: 'orders',
          pharmacies: 'pharmacies',
          scan: 'scan',
          scan_history: 'scan_history',
          scan_result: 'scan_result',
          promos: 'promos',
          loyalty: 'loyalty',
          referral: 'referral',
          addresses: 'addresses',
          favorites: 'favorites',
          payments: 'payments',
          evolution: 'evolution',
          categories: 'categories',
          quiz: 'quiz',
          notifications: 'notifications',
          international: 'international',
          privacy: 'privacy',
          terms: 'terms',
          delete_account: 'delete_account',
        };
        const routeName = map[path];
        if (!routeName) {
          console.warn('[nav] Route inconnue:', path, '→ fallback home');
          newRoute = { name: 'home', params: {} };
        } else {
          newRoute = { name: routeName, params: {} };
        }
      }
    } else if (typeof target === 'object') {
      // Garantit params: {} si pas fourni (sinon key={pageKey} produit un key incohérent)
      newRoute = { ...target, params: target.params || {} };
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
    // Si on est déjà sur Home (root), faire un back n'a aucun sens et peut
    // bloquer iOS (history vide → rien). On gère le cas explicitement.
    if (route?.name === 'home' || !route?.name) {
      return; // déjà à la racine
    }
    // Si window.history a au moins 1 entry à revenir → back normal
    if (window.history.length > 1) {
      window.history.back();
      // Fallback : si après 200ms popstate n'a pas fire (cas rare iOS),
      // on force le navigate vers home pour ne pas laisser l'user bloqué.
      const before = window.location.pathname;
      setTimeout(() => {
        if (window.location.pathname === before) {
          // popstate n'a pas marché → on force le retour Home
          navigate('/');
        }
      }, 200);
    } else {
      // Pas d'historique → navigate direct vers Home
      navigate('/');
    }
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
    case 'international': page = <Suspense fallback={<LazyFallback />}><International /></Suspense>; break;
    case 'privacy': page = <Suspense fallback={<LazyFallback />}><Privacy /></Suspense>; break;
    case 'terms': page = <Suspense fallback={<LazyFallback />}><Terms /></Suspense>; break;
    case 'delete_account': page = <Suspense fallback={<LazyFallback />}><DeleteAccount /></Suspense>; break;
    default: page = <Home />;
  }

  // PERF/STABILITY : key unique par route force le remount complet de la page.
  // Évite le bug "page ne se charge pas au retour" causé par du state React
  // stuck d'un précédent rendu (loading=true jamais reset, fetch perdu, etc.)
  // + Inclut resumeCount : après reprise du background avec session refresh,
  //   la page se remount → tous les fetches repartent avec le nouveau JWT.
  const pageKey = route.name + (route.params ? JSON.stringify(route.params) : '') + '-r' + resumeCount;

  return (
    <NavContext.Provider value={{ navigate, goBack, route }}>
      <UserContext.Provider value={{ user, refreshUser }}>
        <div className="desktop-only-tag">YARAM · Aperçu mobile</div>
        <div className="app-shell">
          {/* ErrorBoundary global : capture les exceptions de render et affiche
              un fallback visible au lieu d'écran blanc silencieux. */}
          <ErrorBoundary key={pageKey + '-eb'}>
            <Suspense fallback={<LazyFallback />} key={pageKey}>{page}</Suspense>
          </ErrorBoundary>
          <InstallPrompt />
          <WhatsAppButton />
        </div>
        <NetworkStatus />
        <Toaster />
        {activePromo && (
          <InterstitialPromo
            promo={activePromo}
            onClose={() => setActivePromo(null)}
          />
        )}
      </UserContext.Provider>
    </NavContext.Provider>
  );
}
