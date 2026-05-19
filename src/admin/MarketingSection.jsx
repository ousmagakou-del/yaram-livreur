import { useState, useEffect } from 'react';
import { adminListUsersFull } from '../lib/adminApi';
import { toast, confirmDialog } from '../lib/toast';
import { sendWhatsAppBulk, sendWhatsAppViaWaMe, personalizeMessage } from '../lib/whatsapp';

const TEMPLATES = [
  { id: 'welcome', label: '🎁 Bienvenue', text: 'Salut {name} 👋 Bienvenue chez YARAM ! Avec le code BIENVENUE tu as -10% sur ta 1ère commande. https://yaram.app' },
  { id: 'promo', label: '🔥 Promo flash', text: 'Hey {name} ✨ Flash promo : -15% sur tout avec le code YARAM15. Profite vite : https://yaram.app' },
  { id: 'abandoned', label: '🛒 Panier abandonné', text: 'Coucou {name} 💚 On a remarqué que tu as laissé des produits dans ton panier. Ils t\'attendent ! https://yaram.app' },
  { id: 'new_product', label: '🆕 Nouveau produit', text: 'Hey {name} ! On vient d\'ajouter de nouveaux produits validés pour ta peau {skinType}. Découvre-les : https://yaram.app' },
  { id: 'reactivation', label: '💌 Re-engagement', text: 'Salut {name}, ça fait un moment ! Profite de -20% avec le code COMEBACK20. https://yaram.app' },
];

// Méthode d'envoi : bulk (WaSender) ou manuel (wa.me onglets)
const SEND_MODES = [
  { id: 'wasender', label: '⚡ WaSender (bulk auto)', desc: 'Envoi automatique en arrière-plan, ~3s par message (anti-ban WhatsApp)' },
  { id: 'wame',     label: '📱 wa.me (onglets)',      desc: 'Ouvre WhatsApp Web pour chaque cliente, tu cliques Envoyer manuellement' },
];

export default function MarketingSection() {
  const [users, setUsers] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('welcome');
  const [customMessage, setCustomMessage] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filterSkin, setFilterSkin] = useState('all');
  const [filterCity, setFilterCity] = useState('all');
  const [sendMode, setSendMode] = useState('wasender');
  const [campaignName, setCampaignName] = useState('');

  // Envoi en cours
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [lastResult, setLastResult] = useState(null); // { sent, failed, total, details }

  useEffect(() => {
    (async () => {
      const { data } = await adminListUsersFull();
      setUsers(data || []);
    })();
  }, []);

  const template = TEMPLATES.find(t => t.id === selectedTemplate);
  const message = customMessage || template?.text || '';

  let filtered = users;
  if (filterSkin !== 'all') filtered = filtered.filter(u => u.skin_type === filterSkin);
  if (filterCity !== 'all') filtered = filtered.filter(u => u.city === filterCity);

  const cities = ['all', ...new Set(users.map(u => u.city).filter(Boolean))];
  const skinTypes = ['all', 'mixte', 'sèche', 'grasse', 'normale', 'sensible'];

  const toggleUser = (id) => {
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    setSelectedUsers(filtered.map(u => u.id));
  };

  // ─── Envoi individuel (bouton 💬 sur une ligne) → toujours wa.me ───
  const sendOne = (u) => {
    const personalizedMsg = personalizeMessage(message, u);
    const phone = (u.phone || '').replace(/\D/g, '');
    if (!phone) {
      toast.error('Pas de numéro pour ' + (u.first_name || u.email));
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(personalizedMsg)}`, '_blank');
  };

  // ─── Envoi en masse selon le mode choisi ───
  const sendAll = async () => {
    const targets = filtered.filter(u => selectedUsers.includes(u.id));
    if (targets.length === 0) return toast.info('Sélectionne au moins une cliente');

    // Construit les recipients personnalisés
    const recipients = targets
      .map(u => ({
        phone: u.phone,
        text: personalizeMessage(message, u),
        userId: u.id,
        userName: u.first_name || u.email,
      }))
      .filter(r => r.phone); // ignore les users sans téléphone

    if (recipients.length === 0) {
      return toast.error('Aucune cliente sélectionnée n\'a de numéro');
    }
    if (recipients.length < targets.length) {
      toast.info(`${targets.length - recipients.length} cliente(s) sans téléphone ignorée(s)`);
    }

    // ─── Mode wa.me : ouvre les onglets ───
    if (sendMode === 'wame') {
      const ok = await confirmDialog(
        `Ouvrir ${recipients.length} onglets WhatsApp ?\n\n` +
        `Tu devras cliquer "Envoyer" dans chaque fenêtre.\n` +
        `(Astuce : utilise plutôt WaSender pour un vrai bulk auto.)`
      );
      if (!ok) return;
      sendWhatsAppViaWaMe(recipients);
      toast.success(`${recipients.length} onglets WhatsApp ouverts`);
      return;
    }

    // ─── Mode WaSender : appel à l'edge function ───
    const estimatedSec = Math.ceil(recipients.length * 2.5);
    const ok = await confirmDialog(
      `Envoyer ${recipients.length} messages WhatsApp via WaSender ?\n\n` +
      `Durée estimée : ~${estimatedSec}s (~2.5s par message pour ne pas se faire ban).\n` +
      `Tu peux fermer cet écran, l'envoi continue côté serveur.`
    );
    if (!ok) return;

    setSending(true);
    setProgress({ current: 0, total: recipients.length });
    setLastResult(null);

    // Optimistic progress UI : on simule l'avancée (l'edge function ne stream pas)
    // mais on a une bonne estimation : 2.5s par message
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 1;
      const estimatedProgress = Math.min(
        Math.floor((elapsed * 1000) / 2500),
        recipients.length - 1
      );
      setProgress({ current: estimatedProgress, total: recipients.length });
    }, 1000);

    try {
      const result = await sendWhatsAppBulk({
        campaignName: campaignName || `${template?.label || 'Campagne'} — ${new Date().toLocaleString('fr-SN')}`,
        recipients: recipients.map(r => ({ phone: r.phone, text: r.text })),
      });
      clearInterval(tick);

      if (!result.success) {
        toast.error(`Erreur WaSender : ${result.error || 'inconnu'}`);
        setSending(false);
        return;
      }

      setProgress({ current: result.total, total: result.total });
      setLastResult(result);
      toast.success(`✅ ${result.sent} envoyés${result.failed > 0 ? ` · ${result.failed} échecs` : ''}`);
    } catch (e) {
      clearInterval(tick);
      toast.error('Erreur : ' + (e?.message || String(e)));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Marketing</h1>
          <p>Campagnes WhatsApp ciblées</p>
        </div>
      </header>

      {/* Progress bar pendant l'envoi WaSender */}
      {sending && (
        <div className="adm-recent-card" style={{ marginBottom: 16, background: '#FFF7E6', borderLeft: '4px solid #FFB020' }}>
          <h3 style={{ margin: 0 }}>⏳ Envoi en cours…</h3>
          <p style={{ fontSize: 13, color: '#6B6B6B', marginTop: 4 }}>
            {progress.current} / {progress.total} envoyés
          </p>
          <div style={{ background: '#EEE', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
            <div style={{
              background: '#1F8B4C',
              height: '100%',
              width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%',
              transition: 'width 1s linear',
            }} />
          </div>
          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
            ⚠️ N'envoie PAS plusieurs campagnes en parallèle (risque ban WhatsApp).
          </p>
        </div>
      )}

      {/* Résultat de la dernière campagne */}
      {lastResult && !sending && (
        <div className="adm-recent-card" style={{ marginBottom: 16, background: lastResult.failed > 0 ? '#FFF0F0' : '#F0FFF4', borderLeft: `4px solid ${lastResult.failed > 0 ? '#E14' : '#1F8B4C'}` }}>
          <h3 style={{ margin: 0 }}>
            {lastResult.failed > 0 ? '⚠️' : '✅'} Campagne terminée
          </h3>
          <p style={{ fontSize: 14, marginTop: 4 }}>
            <strong>{lastResult.sent}</strong> envoyés · <strong>{lastResult.failed}</strong> échecs sur {lastResult.total} cibles
          </p>
          {lastResult.failed > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6B6B6B' }}>
                Voir les échecs ({lastResult.failed})
              </summary>
              <ul style={{ marginTop: 8, fontSize: 12, paddingLeft: 18 }}>
                {(lastResult.details || []).filter(d => d.status !== 'sent').map((d, i) => (
                  <li key={i} style={{ color: '#C00' }}>{d.phone} → {d.error || d.status}</li>
                ))}
              </ul>
            </details>
          )}
          <button className="adm-btn-sec" style={{ marginTop: 8 }} onClick={() => setLastResult(null)}>
            Fermer
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="adm-recent-card">
          <h3>📝 Message</h3>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Template</span>
            <select
              value={selectedTemplate}
              onChange={e => { setSelectedTemplate(e.target.value); setCustomMessage(''); }}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            >
              {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          <label>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Texte (personnalisable)</span>
            <textarea
              value={message}
              onChange={e => setCustomMessage(e.target.value)}
              rows={6}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 13, marginTop: 4 }}
              disabled={sending}
            />
          </label>
          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
            Variables : <code>{`{name}`}</code> = prénom · <code>{`{skinType}`}</code> = type peau
          </p>

          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Nom de campagne (optionnel)</span>
            <input
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="Ex : Promo Tabaski 2026"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            />
          </label>
        </div>

        <div className="adm-recent-card">
          <h3>🎯 Cible</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Type peau</span>
              <select value={filterSkin} onChange={e => setFilterSkin(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }} disabled={sending}>
                {skinTypes.map(s => <option key={s} value={s}>{s === 'all' ? 'Tous' : s}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>Ville</span>
              <select value={filterCity} onChange={e => setFilterCity(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }} disabled={sending}>
                {cities.map(c => <option key={c} value={c}>{c === 'all' ? 'Toutes' : c}</option>)}
              </select>
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Méthode d'envoi</span>
            <select value={sendMode} onChange={e => setSendMode(e.target.value)} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }} disabled={sending}>
              {SEND_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
              {SEND_MODES.find(m => m.id === sendMode)?.desc}
            </p>
          </label>

          <p style={{ fontSize: 13, color: '#1F8B4C', fontWeight: 700 }}>
            {filtered.length} clientes correspondent · {selectedUsers.length} sélectionnées
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="adm-btn-sec" onClick={selectAll} disabled={sending}>Tout sélectionner</button>
            <button className="adm-btn-sec" onClick={() => setSelectedUsers([])} disabled={sending}>Désélectionner</button>
            <button className="adm-btn-pri" onClick={sendAll} disabled={sending || selectedUsers.length === 0}>
              {sending ? '⏳ Envoi...' : `💬 Envoyer aux ${selectedUsers.length}`}
            </button>
          </div>
        </div>
      </div>

      <div className="adm-recent-card" style={{ marginTop: 16 }}>
        <h3>👥 Liste des clientes</h3>
        <table className="adm-table">
          <thead>
            <tr>
              <th></th>
              <th>Cliente</th>
              <th>Téléphone</th>
              <th>Peau</th>
              <th>Ville</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td><input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleUser(u.id)} disabled={sending} /></td>
                <td><strong>{u.first_name} {u.last_name}</strong></td>
                <td>{u.phone || '—'}</td>
                <td>{u.skin_type ? <span className="adm-badge good">{u.skin_type}</span> : '—'}</td>
                <td>{u.city || '—'}</td>
                <td><button className="adm-btn-sec" onClick={() => sendOne(u)} disabled={sending}>💬</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
