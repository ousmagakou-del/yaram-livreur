import { useState, useEffect, useRef } from 'react';
import { adminListUsersFull } from '../lib/adminApi';
import { toast, confirmDialog } from '../lib/toast';
import {
  sendWhatsAppBulk,
  sendWhatsAppViaWaMe,
  personalizeMessage,
  uploadMarketingImage,
} from '../lib/whatsapp';

const TEMPLATES = [
  { id: 'welcome', label: '🎁 Bienvenue', text: 'Salut {name} 👋 Bienvenue chez YARAM ! Avec le code BIENVENUE tu as -10% sur ta 1ère commande.\n\n👉 https://yaram.app' },
  { id: 'promo', label: '🔥 Promo flash', text: 'Hey {name} ✨\n\nFlash promo : -15% sur tout le maquillage avec le code YARAM15\n\n👉 https://yaram.app/search?category=maquillage' },
  { id: 'abandoned', label: '🛒 Panier abandonné', text: 'Coucou {name} 💚\n\nOn a remarqué que tu as laissé des produits dans ton panier. Ils t\'attendent !\n\n👉 https://yaram.app/cart' },
  { id: 'new_product', label: '🆕 Nouveau produit', text: 'Hey {name} ! ✨\n\nNouveau produit validé pour ta peau {skinType} — fonce le découvrir.\n\n👉 https://yaram.app' },
  { id: 'reactivation', label: '💌 Re-engagement', text: 'Salut {name},\n\nÇa fait un moment ! Profite de -20% avec le code COMEBACK20.\n\n👉 https://yaram.app' },
];

const SEND_MODES = [
  { id: 'wasender', label: '⚡ WaSender (bulk auto)', desc: 'Envoi automatique, ~3s par message (anti-ban WhatsApp). Supporte les images.' },
  { id: 'wame',     label: '📱 wa.me (onglets)',      desc: 'Ouvre WhatsApp Web pour chaque cliente. Pas d\'image.' },
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

  // Image upload
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef(null);

  // Envoi
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [lastResult, setLastResult] = useState(null);

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

  // ─── Upload image ───────────────────────────────────────
  const handleImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    const { url, error } = await uploadMarketingImage(file);
    setUploadingImage(false);
    if (error) {
      toast.error('Upload échoué : ' + error);
      return;
    }
    setImageUrl(url);
    toast.success('Image uploadée ✓');
  };

  const clearImage = () => {
    setImageUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Envoi individuel ───────────────────────────────────
  const sendOne = (u) => {
    const personalizedMsg = personalizeMessage(message, u);
    const phone = (u.phone || '').replace(/\D/g, '');
    if (!phone) {
      toast.error('Pas de numéro pour ' + (u.first_name || u.email));
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(personalizedMsg)}`, '_blank');
  };

  // ─── Envoi bulk ────────────────────────────────────────
  const sendAll = async () => {
    const targets = filtered.filter(u => selectedUsers.includes(u.id));
    if (targets.length === 0) return toast.info('Sélectionne au moins une cliente');

    const recipients = targets
      .map(u => ({
        phone: u.phone,
        text: personalizeMessage(message, u),
        userId: u.id,
      }))
      .filter(r => r.phone);

    if (recipients.length === 0) {
      return toast.error('Aucune cliente sélectionnée n\'a de numéro');
    }
    if (recipients.length < targets.length) {
      toast.info(`${targets.length - recipients.length} cliente(s) sans téléphone ignorée(s)`);
    }

    // Mode wa.me : pas d'image possible
    if (sendMode === 'wame') {
      if (imageUrl) {
        toast.info('Note : l\'image n\'est pas envoyée en mode wa.me (limitation WhatsApp Web)');
      }
      const ok = await confirmDialog(
        `Ouvrir ${recipients.length} onglets WhatsApp ?\n\n` +
        `Tu devras cliquer "Envoyer" dans chaque fenêtre.`
      );
      if (!ok) return;
      sendWhatsAppViaWaMe(recipients);
      toast.success(`${recipients.length} onglets WhatsApp ouverts`);
      return;
    }

    // Mode WaSender
    const estimatedSec = Math.ceil(recipients.length * 2.5);
    const withImage = imageUrl ? ' avec image' : '';
    const ok = await confirmDialog(
      `Envoyer ${recipients.length} messages WhatsApp${withImage} via WaSender ?\n\n` +
      `Durée estimée : ~${estimatedSec}s (~2.5s par message anti-ban).\n` +
      `Tu peux fermer cet écran, l'envoi continue côté serveur.`
    );
    if (!ok) return;

    setSending(true);
    setProgress({ current: 0, total: recipients.length });
    setLastResult(null);

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
        imageUrl: imageUrl || null,
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

  // ─── Preview WhatsApp-style ────────────────────────────
  const previewUser = filtered.find(u => selectedUsers.includes(u.id)) || filtered[0] || { first_name: 'Aïssa', skin_type: 'mixte' };
  const previewText = personalizeMessage(message, previewUser);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Marketing</h1>
          <p>Campagnes WhatsApp ciblées (texte ou image+caption)</p>
        </div>
      </header>

      {/* Progress bar */}
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

      {/* Résultat */}
      {lastResult && !sending && (
        <div className="adm-recent-card" style={{ marginBottom: 16, background: lastResult.failed > 0 ? '#FFF0F0' : '#F0FFF4', borderLeft: `4px solid ${lastResult.failed > 0 ? '#E14' : '#1F8B4C'}` }}>
          <h3 style={{ margin: 0 }}>
            {lastResult.failed > 0 ? '⚠️' : '✅'} Campagne terminée
            {lastResult.image_used && ' 🖼️'}
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
        {/* ─── Bloc Message ─── */}
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
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Texte (caption si image, sinon message)</span>
            <textarea
              value={message}
              onChange={e => setCustomMessage(e.target.value)}
              rows={5}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 13, marginTop: 4 }}
              disabled={sending}
            />
          </label>
          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
            Variables : <code>{`{name}`}</code> · <code>{`{skinType}`}</code>
          </p>

          {/* Upload image */}
          <div style={{ marginTop: 16, padding: 12, background: '#F7F7F5', borderRadius: 8 }}>
            <strong style={{ fontSize: 13 }}>🖼️ Image (optionnel)</strong>
            <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
              JPG/PNG/WebP, max 10 MB. Recommandé : 1080×1080 px (carré).
            </p>
            {!imageUrl ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  disabled={sending || uploadingImage}
                  style={{ marginTop: 8, fontSize: 12 }}
                />
                {uploadingImage && <p style={{ fontSize: 12, color: '#1F8B4C', marginTop: 4 }}>⏳ Upload en cours…</p>}
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <img src={imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, border: '1px solid #DDD' }} />
                <button className="adm-btn-sec" style={{ marginTop: 8, fontSize: 12 }} onClick={clearImage} disabled={sending}>
                  ✕ Retirer l'image
                </button>
              </div>
            )}
          </div>

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

        {/* ─── Bloc Cible ─── */}
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
            <button className="adm-btn-pri" onClick={sendAll} disabled={sending || selectedUsers.length === 0 || uploadingImage}>
              {sending ? '⏳ Envoi...' : `💬 Envoyer aux ${selectedUsers.length}`}
            </button>
          </div>

          {/* ─── Preview WhatsApp ─── */}
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 12, color: '#6B6B6B' }}>👁️ Aperçu (style WhatsApp)</strong>
            <div style={{
              marginTop: 8,
              background: '#E5DDD5',
              padding: 12,
              borderRadius: 8,
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) 1px, transparent 1px, transparent 11px)',
            }}>
              <div style={{
                background: '#FFF',
                padding: imageUrl ? 4 : 10,
                borderRadius: 8,
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                maxWidth: 280,
              }}>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt=""
                    style={{ width: '100%', borderRadius: 6, display: 'block', marginBottom: previewText ? 6 : 0 }}
                  />
                )}
                {previewText && (
                  <div style={{
                    padding: imageUrl ? '4px 6px 6px 6px' : 0,
                    fontSize: 13,
                    lineHeight: 1.4,
                    whiteSpace: 'pre-wrap',
                    color: '#111',
                  }}>
                    {previewText}
                  </div>
                )}
                <div style={{ textAlign: 'right', fontSize: 10, color: '#999', marginTop: 4, padding: imageUrl ? '0 6px 4px 0' : 0 }}>
                  {new Date().toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit' })} ✓✓
                </div>
              </div>
            </div>
            {previewUser && (
              <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
                Aperçu pour : <strong>{previewUser.first_name || 'Aïssa'}</strong>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Liste clientes ─── */}
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
