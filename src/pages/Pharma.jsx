import { useState, useEffect } from 'react';
import { supabase, pharmacyLogin, setPharmacyPin } from '../lib/supabase';
import PharmaDashboard from '../pharma/PharmaDashboard';
import PharmaOrders from '../pharma/PharmaOrders';
import PharmaInventory from '../pharma/PharmaInventory';
import PharmaCommission from '../pharma/PharmaCommission';
import PharmaSettings from '../pharma/PharmaSettings';

const ADMIN_WHATSAPP = '221777608983';

export default function Pharma() {
  const [pharmacy, setPharmacy] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [pin, setPin] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  
  const selected = pharmacies.find(p => p.id === selectedId);
  const hasPin = !!selected?.pin;

  useEffect(() => {
    const saved = sessionStorage.getItem('diaara-pharma');
    if (saved) {
      try {
        setPharmacy(JSON.parse(saved));
        return;
      } catch (e) {}
    }
    (async () => {
      const { data } = await supabase
        .from('pharmacies')
        .select('*')
        .eq('active', true)
        .order('name');
      setPharmacies(data || []);
    })();
  }, []);

  const handleLogin = async () => {
    setError('');
    if (!selectedId) return setError('Choisis ta pharmacie');
    if (!hasPin) { setMode('setup'); return; }
    if (!pin || pin.length !== 4) return setError('Le PIN doit faire 4 chiffres');
    
    const result = await pharmacyLogin(selectedId, pin);
    if (!result.success) { setError(result.error || 'PIN incorrect'); return; }
    sessionStorage.setItem('diaara-pharma', JSON.stringify(result.pharmacy));
    setPharmacy(result.pharmacy);
  };

  const handleSetupPin = async () => {
    setError('');
    if (!newPin) return setError('Choisis un PIN');
    if (newPin.length !== 4) return setError('Le PIN doit faire exactement 4 chiffres');
    if (!/^\d{4}$/.test(newPin)) return setError('Uniquement des chiffres');
    
    const banned = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123'];
    if (banned.includes(newPin)) return setError('Choisis un PIN moins évident');
    
    if (!confirmPin) return setError('Confirme ton PIN');
    if (newPin !== confirmPin) return setError('Les deux PIN ne correspondent pas');
    
    await setPharmacyPin(selectedId, newPin);
    const result = await pharmacyLogin(selectedId, newPin);
    if (result.success) {
      sessionStorage.setItem('diaara-pharma', JSON.stringify(result.pharmacy));
      setPharmacy(result.pharmacy);
      setMode('login');
      setNewPin('');
      setConfirmPin('');
    } else {
      setError('Erreur lors de la création');
    }
  };

  const handleForgot = () => {
    const ph = selected;
    const msg = `Bonjour Ousmane 👋\n\nJe suis ${ph?.name || 'une pharmacie partenaire Diaara'}${ph?.city ? ` à ${ph.city}` : ''}.\n\nJ'ai oublié mon PIN d'accès au dashboard pharmacie. Peux-tu me le réinitialiser SVP ?\n\nMerci 💚`;
    window.open(`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('diaara-pharma');
    setPharmacy(null);
    setPin('');
    setSelectedId('');
    setMode('login');
    setError('');
  };

  // ─── STYLES LOGIN ───
  const L = {
    screen: { minHeight: '100vh', width: '100%', background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box', fontFamily: 'system-ui, -apple-system, sans-serif' },
    card: { background: 'white', borderRadius: 20, padding: 28, maxWidth: 420, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.2)', boxSizing: 'border-box' },
    logo: { width: 64, height: 64, borderRadius: '50%', background: '#1F8B4C', color: 'white', fontSize: 32, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' },
    title: { textAlign: 'center', fontSize: 22, fontWeight: 800, marginBottom: 4, color: '#1A1A1A' },
    subtitle: { color: '#6B6B6B', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 1.5 },
    label: { display: 'block', fontSize: 12, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 14, marginBottom: 6 },
    input: { width: '100%', padding: '12px 14px', border: '1.5px solid #E5E5E5', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' },
    select: { width: '100%', padding: '12px 14px', border: '1.5px solid #E5E5E5', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', background: 'white', cursor: 'pointer' },
    btn: { width: '100%', padding: 14, background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 16, fontFamily: 'inherit' },
    btnSec: { width: '100%', padding: 12, background: '#F4F4F2', color: '#1A1A1A', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' },
    btnLink: { width: '100%', background: 'transparent', color: '#1F8B4C', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 10, padding: 4, textDecoration: 'underline', fontFamily: 'inherit' },
    btnWa: { width: '100%', padding: 14, background: '#25D366', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    error: { background: '#FCE9E7', color: '#D9342B', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 12, fontWeight: 600 },
    info: { background: '#FEF6E5', color: '#A07700', padding: '12px 14px', borderRadius: 10, fontSize: 12, marginTop: 12, fontWeight: 600, lineHeight: 1.4 },
    badge: { background: '#FEF6E5', color: '#A07700', padding: '6px 14px', borderRadius: 999, fontSize: 11, fontWeight: 800, display: 'inline-block', letterSpacing: '0.05em', marginBottom: 16 },
    phName: { background: '#E8F5EC', borderRadius: 10, padding: 12, fontSize: 13, marginBottom: 16, textAlign: 'center' },
    help: { fontSize: 12, color: '#6B6B6B', textAlign: 'center', marginTop: 14, lineHeight: 1.5 },
    hint: { fontSize: 11, color: '#6B6B6B', marginTop: 6, fontStyle: 'italic' },
  };

  // ═══ FORGOT ═══
  if (!pharmacy && mode === 'forgot') {
    return (
      <div style={L.screen}>
        <div style={L.card}>
          <div style={L.logo}>D</div>
          <h1 style={L.title}>PIN oublié ?</h1>
          <p style={L.subtitle}>Pas de souci ! Contacte Ousmane et il te réinitialise ton PIN.</p>
          {selected && (
            <div style={L.phName}>
              <strong>{selected.name}</strong>
              <div style={{ fontSize: 11, color: '#6B6B6B', marginTop: 2 }}>{selected.neighborhood ? `${selected.neighborhood}, ` : ''}{selected.city}</div>
            </div>
          )}
          <button onClick={handleForgot} style={L.btnWa}>💬 Contacter Ousmane sur WhatsApp</button>
          <button onClick={() => { setMode('login'); setError(''); }} style={L.btnSec}>← Retour</button>
        </div>
      </div>
    );
  }

  // ═══ SETUP ═══
  if (!pharmacy && mode === 'setup') {
    return (
      <div style={L.screen}>
        <div style={L.card}>
          <div style={{ textAlign: 'center' }}><span style={L.badge}>🎉 PREMIÈRE CONNEXION</span></div>
          <div style={L.logo}>D</div>
          <h1 style={L.title}>Bienvenue !</h1>
          {selected && (
            <p style={{ textAlign: 'center', color: '#1F8B4C', fontWeight: 700, marginBottom: 12, fontSize: 14 }}>{selected.name}</p>
          )}
          <p style={L.subtitle}>Crée ton code PIN à 4 chiffres pour sécuriser ton dashboard.<br /><strong style={{ color: '#1A1A1A' }}>Ne le partage avec personne.</strong></p>

          <label style={L.label}>Choisis ton PIN (4 chiffres)</label>
          <input style={L.input} type="password" inputMode="numeric" maxLength="4" value={newPin} onChange={e => { setNewPin(e.target.value.replace(/\D/g, '')); setError(''); }} placeholder="••••" autoFocus />
          <p style={L.hint}>💡 Évite 1234, 0000, 1111, etc.</p>

          <label style={L.label}>Confirme ton PIN</label>
          <input style={L.input} type="password" inputMode="numeric" maxLength="4" value={confirmPin} onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setError(''); }} placeholder="••••" onKeyDown={e => e.key === 'Enter' && handleSetupPin()} />

          {error && <div style={L.error}>⚠️ {error}</div>}

          <button onClick={handleSetupPin} style={L.btn}>✅ Créer mon PIN</button>
          <button onClick={() => { setMode('login'); setError(''); setNewPin(''); setConfirmPin(''); }} style={L.btnSec}>← Annuler</button>
        </div>
      </div>
    );
  }

  // ═══ LOGIN ═══
  if (!pharmacy) {
    return (
      <div style={L.screen}>
        <div style={L.card}>
          <div style={L.logo}>D</div>
          <h1 style={L.title}>Dashboard Pharmacie</h1>
          <p style={L.subtitle}>Diaara · Espace partenaire</p>

          <label style={L.label}>Ta pharmacie</label>
          <select style={L.select} value={selectedId} onChange={e => { setSelectedId(e.target.value); setError(''); setPin(''); }}>
            <option value="">— Choisis ta pharmacie —</option>
            {pharmacies.map(p => (<option key={p.id} value={p.id}>{p.name} · {p.neighborhood || p.city}</option>))}
          </select>

          {selected && !hasPin && (
            <div style={L.info}>🎉 Première connexion pour cette pharmacie — clique "Continuer" pour créer ton PIN</div>
          )}

          {selected && hasPin && (
            <>
              <label style={L.label}>Ton code PIN (4 chiffres)</label>
              <input style={L.input} type="password" inputMode="numeric" maxLength="4" value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }} placeholder="••••" onKeyDown={e => e.key === 'Enter' && handleLogin()} autoFocus />
            </>
          )}

          {error && <div style={L.error}>⚠️ {error}</div>}

          <button onClick={handleLogin} style={L.btn}>{selected && !hasPin ? 'Continuer →' : 'Se connecter'}</button>

          {selected && hasPin && (
            <button onClick={() => { setMode('forgot'); setError(''); }} style={L.btnLink}>🔑 PIN oublié ?</button>
          )}

          <p style={L.help}>Besoin d'aide ? <a href={`https://wa.me/${ADMIN_WHATSAPP}`} target="_blank" rel="noopener noreferrer" style={{ color: '#1F8B4C', fontWeight: 700, textDecoration: 'none' }}>💬 WhatsApp Ousmane</a></p>
        </div>
      </div>
    );
  }

  // ═══ DASHBOARD ═══
  const D = {
    shell: { display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F5F6F8', fontFamily: 'system-ui, -apple-system, sans-serif' },
    header: { background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)', color: 'white', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    headerLeft: { flex: 1, minWidth: 0 },
    headerName: { display: 'block', fontSize: 15, fontWeight: 700 },
    headerLoc: { fontSize: 11, opacity: 0.85 },
    logoutBtn: { background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    main: { flex: 1, overflowY: 'auto', paddingBottom: 70 },
    tabs: { background: 'white', borderTop: '1px solid #EEE', display: 'flex', position: 'fixed', bottom: 0, left: 0, right: 0, paddingBottom: 'env(safe-area-inset-bottom, 0)' },
    tabBtn: { flex: 1, background: 'none', border: 'none', padding: '10px 4px', fontSize: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: '#6B6B6B', fontFamily: 'inherit' },
    tabBtnActive: { flex: 1, background: 'none', border: 'none', padding: '10px 4px', fontSize: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: '#1F8B4C', fontFamily: 'inherit' },
    tabLabel: { fontSize: 10, fontWeight: 600 },
  };

  return (
    <div style={D.shell}>
      <header style={D.header}>
        <div style={D.headerLeft}>
          <strong style={D.headerName}>{pharmacy.name}</strong>
          <span style={D.headerLoc}>{pharmacy.neighborhood ? `${pharmacy.neighborhood}, ` : ''}{pharmacy.city}</span>
        </div>
        <button onClick={handleLogout} style={D.logoutBtn}>Déconnexion</button>
      </header>

      <main style={D.main}>
        {tab === 'dashboard' && <PharmaDashboard pharmacy={pharmacy} onNavigate={setTab} />}
        {tab === 'orders' && <PharmaOrders pharmacy={pharmacy} />}
        {tab === 'inventory' && <PharmaInventory pharmacy={pharmacy} />}
        {tab === 'commissions' && <PharmaCommission pharmacy={pharmacy} />}
        {tab === 'settings' && <PharmaSettings pharmacy={pharmacy} onUpdate={setPharmacy} />}
      </main>

      <nav style={D.tabs}>
        <button style={tab === 'dashboard' ? D.tabBtnActive : D.tabBtn} onClick={() => setTab('dashboard')}>
          🏠<span style={D.tabLabel}>Accueil</span>
        </button>
        <button style={tab === 'orders' ? D.tabBtnActive : D.tabBtn} onClick={() => setTab('orders')}>
          📦<span style={D.tabLabel}>Commandes</span>
        </button>
        <button style={tab === 'inventory' ? D.tabBtnActive : D.tabBtn} onClick={() => setTab('inventory')}>
          📚<span style={D.tabLabel}>Stock</span>
        </button>
        <button style={tab === 'commissions' ? D.tabBtnActive : D.tabBtn} onClick={() => setTab('commissions')}>
          💰<span style={D.tabLabel}>Revenus</span>
        </button>
        <button style={tab === 'settings' ? D.tabBtnActive : D.tabBtn} onClick={() => setTab('settings')}>
          ⚙️<span style={D.tabLabel}>Paramètres</span>
        </button>
      </nav>
    </div>
  );
}
