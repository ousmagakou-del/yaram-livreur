import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import {
  supabase,
  isPushSupported, getNotificationPermission,
  subscribeToPush, unsubscribeFromPush,
  showLocalNotification, scheduleSkinRoutineReminders,
} from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';
import './NotifSettings.css';

export default function NotifSettings() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [permission, setPermission] = useState('default');
  const [supported, setSupported] = useState(true);
  const [morningTime, setMorningTime] = useState('08:00');
  const [eveningTime, setEveningTime] = useState('21:00');
  const [enableMorning, setEnableMorning] = useState(true);
  const [enableEvening, setEnableEvening] = useState(true);
  const [enableOrders, setEnableOrders] = useState(true);
  const [enablePromos, setEnablePromos] = useState(true);
  const [marketingEmailsEnabled, setMarketingEmailsEnabled] = useState(true);
  const [savingMarketing, setSavingMarketing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSupported(isPushSupported());
    setPermission(getNotificationPermission());

    // Récupère les prefs
    const m = localStorage.getItem('yaram-routine-morning');
    const e = localStorage.getItem('yaram-routine-evening');
    if (m) { setMorningTime(m); setEnableMorning(true); }
    else setEnableMorning(false);
    if (e) { setEveningTime(e); setEnableEvening(true); }
    else setEnableEvening(false);
  }, []);

  // Charge l'opt-out marketing depuis users_profile.onboarding_drip_disabled
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('users_profile')
          .select('onboarding_drip_disabled')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        // disabled=true ⇒ marketing OFF
        setMarketingEmailsEnabled(!(data?.onboarding_drip_disabled === true));
      } catch {
        // ignore — la colonne peut ne pas exister tant que la migration n'est pas appliquée
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleToggleMarketing = async (next) => {
    if (!user?.id) return;
    setMarketingEmailsEnabled(next);
    setSavingMarketing(true);
    try {
      const { error } = await supabase
        .from('users_profile')
        .update({ onboarding_drip_disabled: !next })
        .eq('id', user.id);
      if (error) throw error;
      toast.success(next ? 'Emails marketing activés' : 'Emails marketing désactivés');
    } catch (e) {
      // rollback UI
      setMarketingEmailsEnabled(!next);
      toast.error(e?.message || 'Impossible de mettre à jour');
    } finally {
      setSavingMarketing(false);
    }
  };

  const handleEnable = async () => {
    setLoading(true);
    const result = await subscribeToPush(user.id);
    if (result.success) {
      setPermission('granted');
      // Notification de bienvenue
      setTimeout(() => {
        showLocalNotification('🎉 Notifications activées !', 'Tu seras notifiée à chaque étape de ta commande.');
      }, 1000);
    } else {
      toast.error(result.error);
    }
    setLoading(false);
  };

  const handleDisable = async () => {
    if (!(await confirmDialog('Désactiver les notifications ?'))) return;
    setLoading(true);
    await unsubscribeFromPush(user.id);
    setPermission('default');
    setLoading(false);
  };

  const handleSaveReminders = () => {
    const morning = enableMorning ? morningTime : '';
    const evening = enableEvening ? eveningTime : '';
    scheduleSkinRoutineReminders(morning, evening);
    toast.success('Rappels sauvegardés');
  };

  const handleTestNotif = () => {
    showLocalNotification('💚 Test YARAM', 'Si tu vois ce message, tout marche parfaitement !');
  };

  if (!supported) {
    return (
      <div className="ns-screen">
        <header className="ns-header">
          <button className="ns-back" onClick={() => navigate(-1)}>←</button>
          <h1>Notifications</h1>
        </header>
        <div className="ns-empty">
          <div style={{ fontSize: 48 }}>📵</div>
          <h2>Pas supporté</h2>
          <p>Ton navigateur ne supporte pas les notifications push.</p>
          <p>Sur iPhone : Mets à jour iOS vers 16.4 minimum, et installe YARAM en PWA d'abord.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ns-screen">
      <header className="ns-header">
        <button className="ns-back" onClick={() => navigate(-1)}>←</button>
        <h1>Notifications</h1>
      </header>

      <div className="ns-scroll">
        {/* Status général */}
        <div className={`ns-status ${permission}`}>
          {permission === 'granted' ? (
            <>
              <div className="ns-status-icon">🔔</div>
              <div>
                <strong>Notifications activées</strong>
                <p>Tu reçois les notifications de YARAM</p>
              </div>
              <button className="ns-btn-disable" onClick={handleDisable} disabled={loading}>
                Désactiver
              </button>
            </>
          ) : permission === 'denied' ? (
            <>
              <div className="ns-status-icon">🔕</div>
              <div>
                <strong>Notifications bloquées</strong>
                <p>Va dans les réglages du navigateur pour les autoriser</p>
              </div>
            </>
          ) : (
            <>
              <div className="ns-status-icon">🔔</div>
              <div>
                <strong>Active les notifications</strong>
                <p>Pour suivre tes commandes et recevoir des rappels</p>
              </div>
              <button className="ns-btn-enable" onClick={handleEnable} disabled={loading}>
                {loading ? '...' : 'Activer'}
              </button>
            </>
          )}
        </div>

        {/* Emails marketing (visible que le user ait push activé ou non) */}
        {user?.id && (
          <div className="ns-card">
            <h3>✉️ Emails marketing</h3>
            <p className="ns-meta">Promos, conseils, nouveautés. Les emails de commande restent toujours envoyés.</p>
            <Toggle
              label="📨 Recevoir les emails marketing"
              desc="Bienvenue, top du moment, bons plans"
              checked={marketingEmailsEnabled}
              onChange={handleToggleMarketing}
            />
            {savingMarketing && <p className="ns-meta">Mise à jour…</p>}
          </div>
        )}

        {permission === 'granted' && (
          <>
            {/* Types de notifications */}
            <div className="ns-card">
              <h3>Types de notifications</h3>
              <Toggle
                label="📦 Suivi de commandes"
                desc="Préparation, livraison, livrée"
                checked={enableOrders}
                onChange={setEnableOrders}
              />
              <Toggle
                label="🎁 Promos et offres"
                desc="Codes promo, soldes, nouveaux produits"
                checked={enablePromos}
                onChange={setEnablePromos}
              />
            </div>

            {/* Rappels routine */}
            <div className="ns-card">
              <h3>☀️ Rappels routine peau</h3>
              <p className="ns-meta">L'app te rappelle ta routine matin et soir</p>
              
              <div className="ns-time-row">
                <label className="ns-toggle-line">
                  <input
                    type="checkbox"
                    checked={enableMorning}
                    onChange={e => setEnableMorning(e.target.checked)}
                  />
                  <span>☀️ Rappel matin</span>
                </label>
                {enableMorning && (
                  <input
                    type="time"
                    value={morningTime}
                    onChange={e => setMorningTime(e.target.value)}
                    className="ns-time-input"
                  />
                )}
              </div>
              
              <div className="ns-time-row">
                <label className="ns-toggle-line">
                  <input
                    type="checkbox"
                    checked={enableEvening}
                    onChange={e => setEnableEvening(e.target.checked)}
                  />
                  <span>🌙 Rappel soir</span>
                </label>
                {enableEvening && (
                  <input
                    type="time"
                    value={eveningTime}
                    onChange={e => setEveningTime(e.target.value)}
                    className="ns-time-input"
                  />
                )}
              </div>
              
              <button className="ns-btn-save" onClick={handleSaveReminders}>
                💾 Sauvegarder les rappels
              </button>
            </div>

            {/* Test */}
            <div className="ns-card">
              <h3>🧪 Tester</h3>
              <p className="ns-meta">Envoie-toi une notification test</p>
              <button className="ns-btn-test" onClick={handleTestNotif}>
                Envoyer une notification test
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }) {
  return (
    <label className="ns-toggle">
      <div>
        <strong>{label}</strong>
        <span>{desc}</span>
      </div>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}
