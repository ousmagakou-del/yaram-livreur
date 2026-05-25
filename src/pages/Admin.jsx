import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { adminLogin, adminLogout, getAdminSession, changeAdminPin } from '../lib/adminAuth';
import { adminListOrders } from '../lib/adminApi';
import DashboardSection from '../admin/DashboardSection';
import OrdersSection from '../admin/OrdersSection';
import FinancesSection from '../admin/FinancesSection';
import PerformanceSection from '../admin/PerformanceSection';
import SkinScansSection from '../admin/SkinScansSection';
import AdminUsersSection from '../admin/AdminUsersSection';
import AdminLogsSection from '../admin/AdminLogsSection';
import PharmaciesSection from '../admin/PharmaciesSection';
import ProductsSection from '../admin/ProductsSection';
import BrandsSection from '../admin/BrandsSection';
import StatsSection from '../admin/StatsSection';
import PromosSection from '../admin/PromosSection';
import MarketingSection from '../admin/MarketingSection';
import ReviewsSection from '../admin/ReviewsSection';
import UsersSection from '../admin/UsersSection';
import DeliveriesSection from '../admin/DeliveriesSection';
import StaffSection from '../admin/StaffSection';
import HistorySection from '../admin/HistorySection';
import SettingsSection from '../admin/SettingsSection';
import ProductsValidationSection from '../admin/ProductsValidationSection';
import CommissionsSection from '../admin/CommissionsSection';
import BannersSection from '../admin/BannersSection';
import CategoriesSection from '../admin/CategoriesSection';
import LoyaltySection from '../admin/LoyaltySection';
import NotificationsSection from '../admin/NotificationsSection';
import PushBroadcastSection from '../admin/PushBroadcastSection';
import './Admin.css';

const NAV = [
  { id: 'dashboard',   icon: '📊', label: "Vue d'ensemble" },
  { id: 'orders',      icon: '📦', label: 'Commandes', badge: true },
  { id: 'stats',       icon: '📈', label: 'Statistiques' },
  { id: 'pharmacies',  icon: '🏥', label: 'Pharmacies' },
  { id: 'performance', icon: '📊', label: 'Performance' },
  { id: 'skinscans',   icon: '🧠', label: 'Stats Scans IA' },
  { id: 'commissions', icon: '💰', label: 'Commissions' },
  { id: 'finances',    icon: '💸', label: 'Finances' },
  { id: 'loyalty',     icon: '💚', label: 'Fidélité' },
  { id: 'notifications', icon: '📲', label: 'Notifications WhatsApp' },
  { id: 'push',          icon: '🔔', label: 'Push iOS' },
  { id: 'products',    icon: '🛍️', label: 'Produits' },
  { id: 'validation',  icon: '✨', label: 'Validation produits', badge: true },
  { id: 'brands',      icon: '🏷️', label: 'Marques' },
  { id: 'banners',     icon: '🎨', label: 'Bannières' },
  { id: 'categories',  icon: '📂', label: 'Catégories' },
  { id: 'promos',      icon: '🎁', label: 'Codes promo' },
  { id: 'marketing',   icon: '📣', label: 'Marketing' },
  { id: 'reviews',     icon: '⭐', label: 'Modération avis' },
  { id: 'users',       icon: '👥', label: 'Utilisatrices' },
  { id: 'deliveries',  icon: '🛵', label: 'Livraisons' },
  { id: 'staff',       icon: '👷', label: 'Équipe' },
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
  const [section, setSection] = useState('dashboard');
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [pendingValidationCount, setPendingValidationCount] = useState(0);

  const [pinModal, setPinModal] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinModalError, setPinModalError] = useState('');
  const [pinModalOk, setPinModalOk] = useState('');

  useEffect(() => {
    if (!session) return;
    // Vague E : broadcast realtime (instant) + polling 60s comme fallback
    const channel = supabase
      .channel('yaram-new-orders')
      .on('broadcast', { event: 'new_order' }, () => {
        // Admin voit TOUTES les commandes, donc on incremente sans filtrer
        setNewOrdersCount(c => c + 1);
      })
      .subscribe();

    // Polling 60s comme filet (au cas ou un broadcast a ete rate)
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
        }
        lastSeen = row.created_at;
      } catch { /* silencieux */ }
    };
    tick();
    const id = setInterval(tick, 60000);
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
        {section === 'products'      && <ProductsSection />}
        {section === 'validation'    && <ProductsValidationSection />}
        {section === 'brands'        && <BrandsSection />}
        {section === 'banners'       && <BannersSection />}
        {section === 'categories'    && <CategoriesSection />}
        {section === 'promos'        && <PromosSection />}
        {section === 'marketing'     && <MarketingSection />}
        {section === 'reviews'       && <ReviewsSection />}
        {section === 'users'         && <UsersSection />}
        {section === 'deliveries'    && <DeliveriesSection />}
        {section === 'staff'         && <StaffSection />}
        {section === 'history'       && <HistorySection />}
        {section === 'settings'      && <SettingsSection />}
        {section === 'adminusers'    && <AdminUsersSection />}
        {section === 'adminlogs'     && <AdminLogsSection />}
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
