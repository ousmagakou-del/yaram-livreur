import { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from '../lib/supabase';
import { adminLogin, adminLogout, getAdminSession, changeAdminPin } from '../lib/adminAuth';
import { adminListOrders } from '../lib/adminApi';

// Lazy sections : chargement à la demande pour réduire le shell Admin
const DashboardSection           = lazy(() => import('../admin/DashboardSection'));
const OrdersSection              = lazy(() => import('../admin/OrdersSection'));
const FinancesSection            = lazy(() => import('../admin/FinancesSection'));
const PerformanceSection         = lazy(() => import('../admin/PerformanceSection'));
const SkinScansSection           = lazy(() => import('../admin/SkinScansSection'));
const AdminUsersSection          = lazy(() => import('../admin/AdminUsersSection'));
const AdminLogsSection           = lazy(() => import('../admin/AdminLogsSection'));
const PharmaciesSection          = lazy(() => import('../admin/PharmaciesSection'));
const ProductsSection            = lazy(() => import('../admin/ProductsSection'));
const BrandsSection              = lazy(() => import('../admin/BrandsSection'));
const StatsSection               = lazy(() => import('../admin/StatsSection'));
const PromosSection              = lazy(() => import('../admin/PromosSection'));
const MarketingSection           = lazy(() => import('../admin/MarketingSection'));
const ImportsSection             = lazy(() => import('../admin/ImportsSection'));
const PromosSplashSection        = lazy(() => import('../admin/PromosSplashSection'));
const ReviewsSection             = lazy(() => import('../admin/ReviewsSection'));
const UsersSection               = lazy(() => import('../admin/UsersSection'));
const DeliveriesSection          = lazy(() => import('../admin/DeliveriesSection'));
const StaffSection               = lazy(() => import('../admin/StaffSection'));
const HistorySection             = lazy(() => import('../admin/HistorySection'));
const SettingsSection            = lazy(() => import('../admin/SettingsSection'));
const ProductsValidationSection  = lazy(() => import('../admin/ProductsValidationSection'));
const CommissionsSection         = lazy(() => import('../admin/CommissionsSection'));
const BannersSection             = lazy(() => import('../admin/BannersSection'));
const StoriesSection             = lazy(() => import('../admin/StoriesSection'));
const CategoriesSection          = lazy(() => import('../admin/CategoriesSection'));
const LoyaltySection             = lazy(() => import('../admin/LoyaltySection'));
const NotificationsSection       = lazy(() => import('../admin/NotificationsSection'));
const PushBroadcastSection       = lazy(() => import('../admin/PushBroadcastSection'));
const NewsletterSection          = lazy(() => import('../admin/NewsletterSection'));
const IntlRequestsSection        = lazy(() => import('../admin/IntlRequestsSection'));
// ─── Nouvelles sections (juin 2026) ────────────────────────────────────────
const ArticlesSection            = lazy(() => import('../admin/ArticlesSection'));
const RoutinesSection            = lazy(() => import('../admin/RoutinesSection'));
const SubscriptionsSection       = lazy(() => import('../admin/SubscriptionsSection'));
const SupportSection             = lazy(() => import('../admin/SupportSection'));
const ProductReviewsSection      = lazy(() => import('../admin/ProductReviewsSection'));
const CounterfeitSection         = lazy(() => import('../admin/CounterfeitSection'));
const VerifyRequestsSection      = lazy(() => import('../admin/VerifyRequestsSection'));
const InventorySection           = lazy(() => import('../admin/InventorySection'));
const RestockAlertsSection       = lazy(() => import('../admin/RestockAlertsSection'));
const PharmacistSessionsSection  = lazy(() => import('../admin/PharmacistSessionsSection'));
const DistributorsSection        = lazy(() => import('../admin/DistributorsSection'));

import './Admin.css';

function AdminSectionFallback() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#999', fontSize: 14 }}>
      Chargement…
    </div>
  );
}

const NAV = [
  { id: 'dashboard',   icon: '📊', label: "Vue d'ensemble" },
  { id: 'orders',      icon: '📦', label: 'Commandes', badge: true },
  { id: 'stats',       icon: '📈', label: 'Statistiques' },
  { id: 'pharmacies',  icon: '🏥', label: 'Pharmacies' },
  { id: 'performance', icon: '📊', label: 'Performance' },
  { id: 'skinscans',   icon: '🧠', label: 'Stats Scans IA' },
  { id: 'commissions', icon: '💰', label: 'Commissions' },
  { id: 'distributors', icon: '🏭', label: 'Distributeurs' },
  { id: 'finances',    icon: '💸', label: 'Finances' },
  { id: 'loyalty',     icon: '💚', label: 'Fidélité' },
  { id: 'subscriptions', icon: '👑', label: 'Abonnements YARAM+', badge: true },
  { id: 'notifications', icon: '📲', label: 'Notifications WhatsApp' },
  { id: 'push',          icon: '🔔', label: 'Push iOS' },
  { id: 'newsletter',    icon: '📬', label: 'Newsletter' },
  { id: 'intl_requests', icon: '🌍', label: 'Demandes Intl' },
  { id: 'products',    icon: '🛍️', label: 'Produits' },
  { id: 'validation',  icon: '✨', label: 'Validation produits', badge: true },
  { id: 'brands',      icon: '🏷️', label: 'Marques' },
  { id: 'banners',     icon: '🎨', label: 'Bannières' },
  { id: 'stories',     icon: '📸', label: 'Stories' },
  { id: 'articles',    icon: '📝', label: 'Articles' },
  { id: 'routines',    icon: '🧴', label: 'Routines beauté' },
  { id: 'categories',  icon: '📂', label: 'Catégories' },
  { id: 'promos',      icon: '🎁', label: 'Codes promo' },
  { id: 'marketing',   icon: '📣', label: 'Marketing' },
  { id: 'imports',     icon: '✈️', label: 'Imports' },
  { id: 'splash',      icon: '✨', label: 'Splash Promos' },
  { id: 'reviews',     icon: '⭐', label: 'Modération avis' },
  { id: 'product_reviews', icon: '⭐', label: 'Modération avis produits' },
  { id: 'counterfeit', icon: '🚨', label: 'Contrefaçons', badge: true },
  { id: 'users',       icon: '👥', label: 'Utilisatrices' },
  { id: 'support',     icon: '🆘', label: 'Tickets support', badge: true },
  { id: 'verify',      icon: '🔍', label: 'Vérifications Tier 3' },
  { id: 'deliveries',  icon: '🛵', label: 'Livraisons' },
  { id: 'staff',       icon: '👷', label: 'Équipe' },
  { id: 'pharmacist_sessions', icon: '🔐', label: 'Sessions pharmaciens' },
  { id: 'inventory',   icon: '📦', label: 'Inventaire global' },
  { id: 'restock',     icon: '⚠️', label: 'Alertes restock', badge: true },
  { id: 'history',     icon: '📜', label: 'Historique' },
  { id: 'settings',    icon: '⚙️', label: 'Paramètres' },
  { id: 'adminusers',  icon: '👥', label: 'Gestion admins' },
  { id: 'adminlogs',   icon: '📜', label: 'Logs activité' },
];

export default function Admin() {
  const [session, setSession] = useState(() => getAdminSession());
  const [email, setEmail] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  // Persiste la section active : on revient pile où on était après un refresh
  const [section, setSectionRaw] = useState(() => {
    try { return localStorage.getItem('yaram-admin-section') || 'dashboard'; }
    catch { return 'dashboard'; }
  });
  const setSection = (s) => {
    setSectionRaw(s);
    try { localStorage.setItem('yaram-admin-section', s); } catch {}
  };
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [pendingValidationCount, setPendingValidationCount] = useState(0);

  const [pinModal, setPinModal] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinModalError, setPinModalError] = useState('');
  const [pinModalOk, setPinModalOk] = useState('');

  // ─── Sonnerie nouvelle commande admin (Web Audio, mute persistant) ───
  const [adminMuted, setAdminMutedState] = useState(() => {
    try { return localStorage.getItem('yaram-admin-mute') === '1'; } catch { return false; }
  });
  const setAdminMuted = (v) => {
    setAdminMutedState(v);
    try { localStorage.setItem('yaram-admin-mute', v ? '1' : '0'); } catch {}
  };
  const playAdminAlarm = () => {
    if (adminMuted) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume?.();
      [880, 1320, 1760].forEach((freq, i) => {
        const t0 = ctx.currentTime + i * 0.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.5, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + (i === 2 ? 0.28 : 0.18));
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.32);
      });
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
      // Notif système (best effort si permission accordée)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🛍️ Nouvelle commande YARAM', {
          body: 'Une nouvelle commande vient d\'arriver.',
          tag: 'yaram-admin-new-order',
          icon: '/icon-192.png',
        });
      }
      setTimeout(() => ctx.close().catch(() => {}), 1200);
    } catch { /* no-op */ }
  };

  useEffect(() => {
    if (!session) return;
    // PERF : 3 couches de détection nouvelle commande (du + rapide au + lent) :
    //   1. broadcast realtime (instant, déclenché par client)
    //   2. postgres_changes INSERT sur orders (instant, déclenché par DB)
    //   3. polling 120s safety net (au cas où realtime tombe)
    const onNewOrder = () => {
      setNewOrdersCount(c => c + 1);
      playAdminAlarm();
    };
    const channel = supabase
      .channel('yaram-new-orders')
      .on('broadcast', { event: 'new_order' }, onNewOrder)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        onNewOrder
      )
      .subscribe();

    // Polling 120s comme filet (rare, juste si realtime down)
    let lastSeen = null;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await adminListOrders({ limit: 1, offset: 0 });
        if (cancelled) return;
        const row = (data || [])[0];
        if (!row) return;
        if (lastSeen && row.created_at !== lastSeen && row.created_at > lastSeen) {
          setNewOrdersCount(c => c + 1);
          playAdminAlarm();
        }
        lastSeen = row.created_at;
      } catch { /* silencieux */ }
    };
    tick();
    const id = setInterval(tick, 120000);
    return () => {
      cancelled = true;
      clearInterval(id);
      supabase.removeChannel(channel);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const refresh = async () => {
      try {
        const { count } = await supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');
        setPendingValidationCount(count || 0);
      } catch (e) {}
    };
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [session]);

  useEffect(() => {
    if (section === 'orders') setNewOrdersCount(0);
  }, [section]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    const result = await adminLogin(email, pinInput);
    setLoginLoading(false);
    if (result.success) {
      setSession(result.admin);
      setPinInput('');
    } else {
      setLoginError(result.error);
      setPinInput('');
    }
  };

  const handleLogout = async () => {
    await adminLogout();
    setSession(null);
    setEmail('');
    setPinInput('');
  };

  const handleChangePin = async () => {
    setPinModalError('');
    setPinModalOk('');
    if (newPin !== confirmPin) {
      setPinModalError('Les deux PIN ne correspondent pas');
      return;
    }
    const result = await changeAdminPin(oldPin, newPin);
    if (result.success) {
      setPinModalOk('✓ PIN modifié avec succès');
      setOldPin(''); setNewPin(''); setConfirmPin('');
      setTimeout(() => { setPinModal(false); setPinModalOk(''); }, 1500);
    } else {
      setPinModalError(result.error);
    }
  };

  // ────────── LOGIN ──────────
  if (!session) {
    return (
      <div className="adm-login">
        <div className="adm-login-card">
          <div className="adm-login-logo">D</div>
          <h1>Admin YARAM</h1>
          <p>Connexion sécurisée</p>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              className="adm-pin-input"
              style={{ fontSize: 14, letterSpacing: 'normal', textAlign: 'left', marginBottom: 10 }}
              value={email}
              onChange={e => { setEmail(e.target.value); setLoginError(''); }}
              placeholder="ton@email.com"
              autoFocus
              autoComplete="username"
              required
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`adm-pin-input ${loginError ? 'error' : ''}`}
              value={pinInput}
              onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setLoginError(''); }}
              placeholder="••••"
              maxLength={6}
              autoComplete="current-password"
              required
            />
            {loginError && <p className="adm-pin-error">{loginError}</p>}
            <button type="submit" className="adm-pin-btn" disabled={loginLoading}>
              {loginLoading ? 'Connexion…' : 'Se connecter →'}
            </button>
          </form>
          <a href="/" className="adm-back-link">← Retour à l'app cliente</a>
        </div>
      </div>
    );
  }

  // ────────── ADMIN ──────────
  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-side-head">
          <div className="adm-side-logo">D</div>
          <div>
            <div className="adm-side-brand">YARAM</div>
            <div className="adm-side-role">{session.name || 'Admin'}</div>
          </div>
        </div>
        <nav className="adm-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`adm-nav-item ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              <span className="adm-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'orders' && newOrdersCount > 0 && (
                <span className="adm-nav-badge">{newOrdersCount}</span>
              )}
              {item.id === 'validation' && pendingValidationCount > 0 && (
                <span className="adm-nav-badge">{pendingValidationCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <button
            className="adm-app-link"
            onClick={() => setAdminMuted(!adminMuted)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            title="Active/désactive la sonnerie pour les nouvelles commandes"
          >
            {adminMuted ? '🔕 Sonnerie OFF' : '🔔 Sonnerie ON'}
          </button>
          <button
            className="adm-app-link"
            onClick={playAdminAlarm}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            title="Tester la sonnerie"
          >
            🎵 Test sonnerie
          </button>
          <button
            className="adm-app-link"
            onClick={() => setPinModal(true)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
          >
            🔑 Changer mon PIN
          </button>
          <a href="/" className="adm-app-link">👁️ Voir l'app cliente</a>
          <button className="adm-logout-btn" onClick={handleLogout}>🔒 Déconnecter</button>
        </div>
      </aside>

      <main className="adm-main">
        <Suspense fallback={<AdminSectionFallback />}>
          {section === 'dashboard'     && <DashboardSection setSection={setSection} />}
          {section === 'orders'        && <OrdersSection />}
          {section === 'stats'         && <StatsSection />}
          {section === 'pharmacies'    && <PharmaciesSection />}
          {section === 'performance'   && <PerformanceSection />}
          {section === 'skinscans'     && <SkinScansSection />}
          {section === 'commissions'   && <CommissionsSection />}
          {section === 'finances'      && <FinancesSection />}
          {section === 'loyalty'       && <LoyaltySection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'push'          && <PushBroadcastSection />}
          {section === 'newsletter'    && <NewsletterSection />}
          {section === 'intl_requests' && <IntlRequestsSection />}
          {section === 'products'      && <ProductsSection />}
          {section === 'validation'    && <ProductsValidationSection />}
          {section === 'brands'        && <BrandsSection />}
          {section === 'banners'       && <BannersSection />}
          {section === 'stories'       && <StoriesSection />}
          {section === 'categories'    && <CategoriesSection />}
          {section === 'promos'        && <PromosSection />}
          {section === 'marketing'     && <MarketingSection />}
          {section === 'imports'       && <ImportsSection />}
          {section === 'splash'        && <PromosSplashSection />}
          {section === 'reviews'       && <ReviewsSection />}
          {section === 'users'         && <UsersSection />}
          {section === 'deliveries'    && <DeliveriesSection />}
          {section === 'staff'         && <StaffSection />}
          {section === 'history'       && <HistorySection />}
          {section === 'settings'      && <SettingsSection />}
          {section === 'adminusers'    && <AdminUsersSection />}
          {section === 'adminlogs'     && <AdminLogsSection />}
          {/* ─── Nouvelles sections (juin 2026) ─────────────────────────── */}
          {section === 'articles'             && <ArticlesSection />}
          {section === 'routines'             && <RoutinesSection />}
          {section === 'subscriptions'        && <SubscriptionsSection />}
          {section === 'support'              && <SupportSection />}
          {section === 'product_reviews'      && <ProductReviewsSection />}
          {section === 'counterfeit'          && <CounterfeitSection />}
          {section === 'verify'               && <VerifyRequestsSection />}
          {section === 'inventory'            && <InventorySection />}
          {section === 'restock'              && <RestockAlertsSection />}
          {section === 'pharmacist_sessions'  && <PharmacistSessionsSection />}
          {section === 'distributors'         && <DistributorsSection />}
        </Suspense>
      </main>

      {pinModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
        }}>
          <div style={{
            background: 'white', borderRadius: 16, padding: 24,
            maxWidth: 380, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>🔑 Changer mon PIN</h2>
            <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
              Choisis un nouveau code à 4-6 chiffres
            </p>
            <input
              type="password" inputMode="numeric" maxLength={6}
              placeholder="Ancien PIN" value={oldPin}
              onChange={e => { setOldPin(e.target.value.replace(/\D/g, '')); setPinModalError(''); }}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
              autoFocus
            />
            <input
              type="password" inputMode="numeric" maxLength={6}
              placeholder="Nouveau PIN" value={newPin}
              onChange={e => { setNewPin(e.target.value.replace(/\D/g, '')); setPinModalError(''); }}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
            />
            <input
              type="password" inputMode="numeric" maxLength={6}
              placeholder="Confirme le nouveau PIN" value={confirmPin}
              onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setPinModalError(''); }}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
              onKeyDown={e => e.key === 'Enter' && handleChangePin()}
            />
            {pinModalError && (
              <div style={{ background: '#FCE9E7', color: '#D9342B', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
                ⚠️ {pinModalError}
              </div>
            )}
            {pinModalOk && (
              <div style={{ background: '#E8F5EC', color: '#1F8B4C', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
                {pinModalOk}
              </div>
            )}
            <button
              onClick={handleChangePin}
              style={{ width: '100%', padding: 12, background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >
              Modifier mon PIN
            </button>
            <button
              onClick={() => { setPinModal(false); setOldPin(''); setNewPin(''); setConfirmPin(''); setPinModalError(''); }}
              style={{ width: '100%', padding: 10, marginTop: 8, background: '#F4F4F2', color: '#1A1A1A', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
