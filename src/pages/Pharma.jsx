import { useState, useEffect } from 'react';
import { supabase, pharmacyLogin, getAllPharmacies, invalidateCache } from '../lib/supabase';
import PharmaDashboard from '../pharma/PharmaDashboard';
import PharmaOrders from '../pharma/PharmaOrders';
import PharmaProducts from '../pharma/PharmaProducts';
import PharmaInventory from '../pharma/PharmaInventory';
import PharmaCommission from '../pharma/PharmaCommission';
import PharmaSettings from '../pharma/PharmaSettings';
import PharmaBrands from '../pharma/PharmaBrands';
import { useOrderAlerts } from '../lib/useOrderAlerts';
import './Pharma.css';

import { getWhatsAppNumber } from '../lib/utils';

// ⚠️ Securite : on ne persiste JAMAIS le PIN ni pin_set_at dans le localStorage
// (n'importe quelle extension ou script tiers peut lire localStorage).
function sanitizeForStorage(pharmacy) {
  if (!pharmacy) return pharmacy;
  // eslint-disable-next-line no-unused-vars
  const { pin, pin_set_at, ...safe } = pharmacy;
  return safe;
}

const NAV = [
  { id: 'dashboard',  icon: '🏠', label: "Vue d'ensemble" },
  { id: 'orders',     icon: '📦', label: 'Commandes', badge: true },
  { id: 'products',   icon: '📷', label: 'Mes produits' },
  { id: 'inventory',  icon: '📚', label: 'Inventaire' },
  { id: 'brands',     icon: '🏷️', label: 'Marques' },
  { id: 'commission', icon: '💰', label: 'Mes commissions' },
  { id: 'settings',   icon: '⚙️', label: 'Paramètres' },
];

const BANNED_PINS = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876'];

export default function Pharma() {
  const [phase, setPhase] = useState('selectPharmacy'); // selectPharmacy, setPin, login, forgot, dashboard
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [section, setSection] = useState('dashboard');
  const [newOrdersCount, setNewOrdersCount] = useState(0);

  // Notifications temps réel : son ding + notif navigateur + WhatsApp via trigger
  const {
    pendingCount,
    muted,
    setMuted,
    notifPermission,
    requestNotificationPermission,
    testDing,
  } = useOrderAlerts(selectedPharmacy?.id);

  useEffect(() => {
    (async () => {
      const data = await getAllPharmacies();
      setPharmacies(data);
    })();
  }, []);

  // Restaurer la session si déjà connectée
  useEffect(() => {
    const saved = localStorage.getItem('yaram-pharma-session');
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
    // On utilise pin_set_at (timestamp non sensible) au lieu de pin (la valeur).
    // pharmacy.pin n'est plus expose par getAllPharmacies pour des raisons de securite.
    if (!pharmacy.pin_set_at) {
      setPhase('setPin');
    } else {
      setPhase('login');
    }
    setPinInput('');
    setConfirmPin('');
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
      localStorage.setItem('yaram-pharma-session', JSON.stringify(sanitizeForStorage(result.pharmacy)));
      setPhase('dashboard');
      setPinError('');
    } else {
      setPinError(result.error || 'PIN incorrect');
      setPinInput('');
    }
  };

  const handleSetPin = async (e) => {
    e?.preventDefault?.();
    if (!pinInput || pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
      setPinError('PIN doit être exactement 4 chiffres');
      return;
    }
    if (BANNED_PINS.includes(pinInput)) {
      setPinError('PIN trop évident, choisis-en un autre');
      return;
    }
    if (pinInput !== confirmPin) {
      setPinError('Les deux PIN ne correspondent pas');
      return;
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('pharmacies')
      .update({ pin: pinInput, pin_set_at: nowIso })
      .eq('id', selectedPharmacy.id);
    if (error) { setPinError('Erreur : ' + error.message); return; }

    // Important : pin_set_at est aussi mis a jour localement et le cache est invalide,
    // sinon une deconnexion / reconnexion dans les 10 min suivantes renverrait sur "setPin".
    const updated = { ...selectedPharmacy, pin: pinInput, pin_set_at: nowIso };
    setSelectedPharmacy(updated);
    localStorage.setItem('yaram-pharma-session', JSON.stringify(sanitizeForStorage(updated)));
    invalidateCache('all_pharmacies');
    setPhase('dashboard');
    setPinError('');
    setPinInput('');
    setConfirmPin('');
  };

  const openForgotWhatsApp = () => {
    const ph = selectedPharmacy;
    const msg = `Bonjour Ousmane 👋\n\nJe suis ${ph?.name || 'une pharmacie partenaire YARAM'}${ph?.city ? ` à ${ph.city}` : ''}.\n\nJ'ai oublié mon PIN d'accès au dashboard pharmacie. Peux-tu me le réinitialiser SVP ?\n\nMerci 💚`;
    window.open(`https://wa.me/${getWhatsAppNumber()}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const logout = () => {
    localStorage.removeItem('yaram-pharma-session');
    setSelectedPharmacy(null);
    setPhase('selectPharmacy');
    setPinInput('');
    setConfirmPin('');
  };

  // Callback pour PharmaSettings : remet à jour la pharmacie courante
  const handlePharmacyUpdate = (updated) => {
    setSelectedPharmacy(updated);
    localStorage.setItem('yaram-pharma-session', JSON.stringify(sanitizeForStorage(updated)));
  };

  // === RENDER LOGIN PHASES ===

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
                    <img src={p.logo_url} alt="" loading="lazy" decoding="async" onError={(e) => e.target.style.display = 'none'} />
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
            <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: -2, marginBottom: 10 }}>
              💡 Évite 1234, 0000, 1111 et autres PIN évidents
            </p>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`phar-pin-input ${pinError ? 'error' : ''}`}
              value={confirmPin}
              onChange={e => { setConfirmPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              placeholder="Confirme ton PIN"
              maxLength={4}
            />
            {pinError && <p className="phar-pin-error">{pinError}</p>}
            <p style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 12 }}>
              Garde ce PIN en sécurité, tu en auras besoin à chaque connexion
            </p>
            <button type="submit" className="phar-pin-btn">Créer mon PIN →</button>
          </form>
          <button className="phar-back-link" onClick={() => setPhase('selectPharmacy')}>← Choisir une autre pharmacie</button>
        </div>
      </div>
    );
  }

  if (phase === 'forgot') {
    return (
      <div className="phar-login">
        <div className="phar-login-card">
          <div className="phar-login-logo">D</div>
          <h1>PIN oublié ?</h1>
          <p>Pas de souci ! Contacte Ousmane et il te réinitialise ton PIN.</p>

          {selectedPharmacy && (
            <div className="phar-forgot-target">
              <strong>{selectedPharmacy.name}</strong>
              <span>{selectedPharmacy.neighborhood ? `${selectedPharmacy.neighborhood}, ` : ''}{selectedPharmacy.city}</span>
            </div>
          )}

          <button onClick={openForgotWhatsApp} className="phar-pin-btn phar-pin-btn-wa">
            💬 Contacter Ousmane sur WhatsApp
          </button>
          <button className="phar-back-link" onClick={() => { setPhase('login'); setPinError(''); }}>← Retour à la connexion</button>
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
          <button className="phar-back-link" onClick={() => setPhase('forgot')}>🔑 PIN oublié ?</button>
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
              {item.badge && pendingCount > 0 && (
                <span className="phar-nav-badge">{pendingCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="phar-side-foot">
          <button
            className="phar-mute-btn"
            onClick={() => setMuted(!muted)}
            title={muted ? 'Réactiver les sons' : 'Couper les sons'}
          >
            {muted ? '🔕 Sons coupés' : '🔔 Sons activés'}
          </button>

          {notifPermission !== 'granted' && notifPermission !== 'denied' && (
            <button
              className="phar-mute-btn"
              onClick={requestNotificationPermission}
              title="Active les notifications du navigateur"
              style={{ color: '#F4B53A' }}
            >
              ⚡ Activer les notifs
            </button>
          )}

          <button className="phar-mute-btn" onClick={testDing}>
            🎵 Tester le son
          </button>

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
        {section === 'brands' && (
          <PharmaBrands />
        )}
        {section === 'commission' && (
          <PharmaCommission
            pharmacyId={selectedPharmacy.id}
            pharmacyName={selectedPharmacy.name}
          />
        )}
        {section === 'settings' && (
          <PharmaSettings
            pharmacy={selectedPharmacy}
            onUpdate={handlePharmacyUpdate}
          />
        )}
      </main>
    </div>
  );
}
