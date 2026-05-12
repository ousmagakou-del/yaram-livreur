import { useState, useEffect } from 'react';
import { supabase, pharmacyLogin, getAllPharmacies } from '../lib/supabase';
import PharmaDashboard from '../pharma/PharmaDashboard';
import PharmaOrders from '../pharma/PharmaOrders';
import PharmaProducts from '../pharma/PharmaProducts';
import PharmaInventory from '../pharma/PharmaInventory';
import PharmaCommission from '../pharma/PharmaCommission';
import './Pharma.css';

const NAV = [
  { id: 'dashboard', icon: '🏠', label: "Vue d'ensemble" },
  { id: 'orders', icon: '📦', label: 'Commandes', badge: true },
  { id: 'products', icon: '📷', label: 'Mes produits' },
  { id: 'inventory', icon: '📚', label: 'Inventaire' },
  { id: 'commission', icon: '💰', label: 'Mes commissions' },
];

export default function Pharma() {
  const [phase, setPhase] = useState('selectPharmacy'); // selectPharmacy, setPin, login, dashboard
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [section, setSection] = useState('dashboard');
  const [newOrdersCount, setNewOrdersCount] = useState(0);

  useEffect(() => {
    (async () => {
      const data = await getAllPharmacies();
      setPharmacies(data);
    })();
  }, []);

  // Restaurer la session si déjà connectée
  useEffect(() => {
    const saved = localStorage.getItem('diaara-pharma-session');
    if (saved) {
      try {
        const session = JSON.parse(saved);
        setSelectedPharmacy(session);
        setPhase('dashboard');
      } catch (e) { /* ignore */ }
    }
  }, []);

  const handleSelectPharmacy = (pharmacy) => {
    setSelectedPharmacy(pharmacy);
    if (!pharmacy.pin) {
      // Première connexion, demander de créer un PIN
      setPhase('setPin');
    } else {
      setPhase('login');
    }
    setPinInput('');
    setPinError('');
  };

  const handleLogin = async (e) => {
    e?.preventDefault?.();
    if (!pinInput || pinInput.length < 4) {
      setPinError('PIN à 4 chiffres minimum');
      return;
    }
    const result = await pharmacyLogin(selectedPharmacy.id, pinInput);
    if (result.success) {
      setSelectedPharmacy(result.pharmacy);
      localStorage.setItem('diaara-pharma-session', JSON.stringify(result.pharmacy));
      setPhase('dashboard');
      setPinError('');
    } else {
      setPinError(result.error);
      setPinInput('');
    }
  };

  const handleSetPin = async (e) => {
    e?.preventDefault?.();
    if (!pinInput || pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
      setPinError('PIN doit être exactement 4 chiffres');
      return;
    }
    await supabase
      .from('pharmacies')
      .update({ pin: pinInput, pin_set_at: new Date().toISOString() })
      .eq('id', selectedPharmacy.id);
    
    const updated = { ...selectedPharmacy, pin: pinInput };
    setSelectedPharmacy(updated);
    localStorage.setItem('diaara-pharma-session', JSON.stringify(updated));
    setPhase('dashboard');
    setPinError('');
  };

  const logout = () => {
    localStorage.removeItem('diaara-pharma-session');
    setSelectedPharmacy(null);
    setPhase('selectPharmacy');
    setPinInput('');
  };

  // === RENDER ===

  if (phase === 'selectPharmacy') {
    return (
      <div className="phar-login">
        <div className="phar-login-card phar-login-wide">
          <div className="phar-login-logo">D</div>
          <h1>Dashboard Pharmacie</h1>
          <p>Sélectionne ta pharmacie</p>
          
          <div className="phar-pharmacy-list">
            {pharmacies.map(p => (
              <button
                key={p.id}
                className="phar-pharmacy-item"
                onClick={() => handleSelectPharmacy(p)}
              >
                <div className="phar-pharmacy-logo">
                  {p.logo_url ? (
                    <img src={p.logo_url} alt="" onError={(e) => e.target.style.display = 'none'} />
                  ) : (
                    <span>🏥</span>
                  )}
                </div>
                <div className="phar-pharmacy-info">
                  <strong>{p.name}</strong>
                  <span>{p.city || p.neighborhood} · {p.phone}</span>
                </div>
                <span className="phar-pharmacy-arrow">→</span>
              </button>
            ))}
          </div>
          
          <a href="/" className="phar-back-link">← Retour à l'app cliente</a>
        </div>
      </div>
    );
  }

  if (phase === 'setPin') {
    return (
      <div className="phar-login">
        <div className="phar-login-card">
          <div className="phar-login-logo">D</div>
          <h1>{selectedPharmacy.name}</h1>
          <p>🔐 Première connexion — Crée ton code PIN à 4 chiffres</p>
          <form onSubmit={handleSetPin}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`phar-pin-input ${pinError ? 'error' : ''}`}
              value={pinInput}
              onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              placeholder="••••"
              autoFocus
              maxLength={4}
            />
            {pinError && <p className="phar-pin-error">{pinError}</p>}
            <p style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 12 }}>
              💡 Garde ce PIN en sécurité, tu en auras besoin à chaque connexion
            </p>
            <button type="submit" className="phar-pin-btn">Créer mon PIN →</button>
          </form>
          <button className="phar-back-link" onClick={() => setPhase('selectPharmacy')}>← Choisir une autre pharmacie</button>
        </div>
      </div>
    );
  }

  if (phase === 'login') {
    return (
      <div className="phar-login">
        <div className="phar-login-card">
          <div className="phar-login-logo">D</div>
          <h1>{selectedPharmacy.name}</h1>
          <p>Saisis ton code PIN</p>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`phar-pin-input ${pinError ? 'error' : ''}`}
              value={pinInput}
              onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              placeholder="••••"
              autoFocus
              maxLength={6}
            />
            {pinError && <p className="phar-pin-error">{pinError}</p>}
            <button type="submit" className="phar-pin-btn">Se connecter →</button>
          </form>
          <button className="phar-back-link" onClick={() => setPhase('selectPharmacy')}>← Choisir une autre pharmacie</button>
        </div>
      </div>
    );
  }

  // === DASHBOARD ===
  return (
    <div className="phar-shell">
      <aside className="phar-side">
        <div className="phar-side-head">
          <div className="phar-side-logo">D</div>
          <div>
            <div className="phar-side-brand">{selectedPharmacy.name}</div>
            <div className="phar-side-role">Pharmacie partenaire</div>
          </div>
        </div>
        <nav className="phar-nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`phar-nav-item ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              <span className="phar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.badge && newOrdersCount > 0 && (
                <span className="phar-nav-badge">{newOrdersCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="phar-side-foot">
          <a href="/" className="phar-app-link">👁️ Voir l'app cliente</a>
          <button className="phar-logout-btn" onClick={logout}>🔒 Déconnecter</button>
        </div>
      </aside>

      <main className="phar-main">
        {section === 'dashboard' && (
          <PharmaDashboard 
            pharmacy={selectedPharmacy} 
            setSection={setSection}
            onPendingChange={setNewOrdersCount}
          />
        )}
        {section === 'orders' && (
          <PharmaOrders 
            pharmacyId={selectedPharmacy.id}
            pharmacyName={selectedPharmacy.name}
            onPendingChange={setNewOrdersCount}
          />
        )}
        {section === 'products' && (
          <PharmaProducts 
            pharmacyId={selectedPharmacy.id}
            pharmacyName={selectedPharmacy.name}
          />
        )}
        {section === 'inventory' && (
          <PharmaInventory 
            pharmacyId={selectedPharmacy.id}
          />
        )}
        {section === 'commission' && (
          <PharmaCommission 
            pharmacyId={selectedPharmacy.id}
            pharmacyName={selectedPharmacy.name}
          />
        )}
      </main>
    </div>
  );
}
