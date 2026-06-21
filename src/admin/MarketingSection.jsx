import { useState, useEffect, useRef } from 'react';
import { adminListUsersFull, adminLogAction } from '../lib/adminApi';
import { toast, confirmDialog } from '../lib/toast';
import {
  sendWhatsAppBulk,
  sendWhatsAppViaWaMe,
  personalizeMessage,
  uploadMarketingImage,
} from '../lib/whatsapp';

const TEMPLATES = [
  { id: 'welcome',      label: '🎁 Bienvenue',         text: 'Salut {name} 👋 Bienvenue chez YARAM ! Avec le code BIENVENUE tu as -10% sur ta 1ère commande.\n\n👉 https://yaram.app' },
  { id: 'promo',        label: '🔥 Promo flash',       text: 'Hey {name} ✨\n\nFlash promo : -15% sur tout le maquillage avec le code YARAM15\n\n👉 https://yaram.app/search?category=maquillage' },
  { id: 'abandoned',    label: '🛒 Panier abandonné',  text: 'Coucou {name} 💚\n\nOn a remarqué que tu as laissé des produits dans ton panier. Ils t\'attendent !\n\n👉 https://yaram.app/cart' },
  { id: 'new_product',  label: '🆕 Nouveau produit',   text: 'Hey {name} ! ✨\n\nNouveau produit validé pour ta peau {skinType} — fonce le découvrir.\n\n👉 https://yaram.app' },
  { id: 'reactivation', label: '💌 Re-engagement',     text: 'Salut {name},\n\nÇa fait un moment ! Profite de -20% avec le code COMEBACK20.\n\n👉 https://yaram.app' },
];

const SEND_MODES = [
  { id: 'wasender', label: '⚡ WaSender (bulk auto)', desc: 'Envoi auto en séquence. Supporte images + link preview.' },
  { id: 'wame',     label: '📱 wa.me (onglets)',      desc: 'Ouvre WhatsApp Web pour chaque cliente. Texte uniquement.' },
];

const MAX_BLOCKS = 4;
const emptyTextBlock  = () => ({ id: Math.random(), type: 'text',  text: '' });
const emptyImageBlock = () => ({ id: Math.random(), type: 'image', image_url: '', caption: '' });

export default function MarketingSection() {
  const [users, setUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filterSkin, setFilterSkin] = useState('all');
  const [filterCity, setFilterCity] = useState('all');
  const [sendMode, setSendMode] = useState('wasender');
  const [campaignName, setCampaignName] = useState('');

  // Blocks : tableau de 1 à 4 messages séquentiels
  const [blocks, setBlocks] = useState([{ id: Math.random(), type: 'text', text: TEMPLATES[0].text }]);

  // État envoi
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [lastResult, setLastResult] = useState(null);
  const [uploadingBlockId, setUploadingBlockId] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await adminListUsersFull();
      setUsers(data || []);
    })();
  }, []);

  let filtered = users;
  if (filterSkin !== 'all') filtered = filtered.filter(u => u.skin_type === filterSkin);
  if (filterCity !== 'all') filtered = filtered.filter(u => u.city === filterCity);

  const cities = ['all', ...new Set(users.map(u => u.city).filter(Boolean))];
  const skinTypes = ['all', 'mixte', 'sèche', 'grasse', 'normale', 'sensible'];

  const toggleUser = (id) =>
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAll = () => setSelectedUsers(filtered.map(u => u.id));

  // ─── Manipulation des blocks ───────────────────────────
  const updateBlock = (id, patch) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  };
  const removeBlock = (id) => {
    if (blocks.length <= 1) return toast.info('Au moins 1 block requis');
    setBlocks(prev => prev.filter(b => b.id !== id));
  };
  const addBlock = (type) => {
    if (blocks.length >= MAX_BLOCKS) return toast.info(`Maximum ${MAX_BLOCKS} blocks`);
    setBlocks(prev => [...prev, type === 'image' ? emptyImageBlock() : emptyTextBlock()]);
  };
  const applyTemplate = (templateId) => {
    const t = TEMPLATES.find(x => x.id === templateId);
    if (!t) return;
    // Remplace UNIQUEMENT le premier block de type texte (sinon ajoute)
    const firstText = blocks.find(b => b.type === 'text');
    if (firstText) {
      updateBlock(firstText.id, { text: t.text });
    } else {
      setBlocks(prev => [{ id: Math.random(), type: 'text', text: t.text }, ...prev]);
    }
  };

  const handleImageUpload = async (blockId, file) => {
    if (!file) return;
    setUploadingBlockId(blockId);
    const { url, error } = await uploadMarketingImage(file);
    setUploadingBlockId(null);
    if (error) return toast.error('Upload : ' + error);
    updateBlock(blockId, { image_url: url });
    toast.success('Image uploadée ✓');
  };

  // ─── Envoi individuel (bouton 💬 sur ligne) → wa.me avec 1er block texte ───
  const sendOne = (u) => {
    const firstText = blocks.find(b => b.type === 'text');
    const text = firstText ? personalizeMessage(firstText.text, u) : '';
    if (!text) return toast.error('Pas de message texte à envoyer');
    const phone = (u.phone || '').replace(/\D/g, '');
    if (!phone) return toast.error('Pas de numéro pour ' + (u.first_name || u.email));
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  // ─── Envoi bulk ────────────────────────────────────────
  const sendAll = async () => {
    const targets = filtered.filter(u => selectedUsers.includes(u.id));
    if (targets.length === 0) return toast.info('Sélectionne au moins une cliente');

    // Valide les blocks
    const validBlocks = blocks.filter(b =>
      (b.type === 'text'  && b.text?.trim())
   || (b.type === 'image' && b.image_url)
    );
    if (validBlocks.length === 0) return toast.error('Aucun block valide à envoyer');

    const recipientsWithPhone = targets.filter(u => u.phone);
    if (recipientsWithPhone.length === 0) {
      return toast.error('Aucune cliente sélectionnée n\'a de numéro');
    }
    if (recipientsWithPhone.length < targets.length) {
      toast.info(`${targets.length - recipientsWithPhone.length} cliente(s) sans téléphone ignorée(s)`);
    }

    // Mode wa.me : juste le 1er block texte
    if (sendMode === 'wame') {
      const firstText = validBlocks.find(b => b.type === 'text');
      if (!firstText) return toast.error('wa.me ne supporte que les blocks texte');
      if (validBlocks.length > 1) {
        toast.info(`Mode wa.me : seul le 1er block texte sera envoyé (${validBlocks.length - 1} block(s) ignoré(s))`);
      }
      const ok = await confirmDialog(`Ouvrir ${recipientsWithPhone.length} onglets WhatsApp ?`);
      if (!ok) return;
      sendWhatsAppViaWaMe(recipientsWithPhone, firstText.text);
      toast.success(`${recipientsWithPhone.length} onglets ouverts`);
      return;
    }

    // Mode WaSender
    const estimatedSec = Math.ceil(recipientsWithPhone.length * (validBlocks.length * 1 + 2.5));
    const ok = await confirmDialog(
      `Envoyer ${recipientsWithPhone.length} séquences de ${validBlocks.length} message(s) ?\n\n` +
      `Durée estimée : ~${estimatedSec}s (~${(validBlocks.length + 2.5).toFixed(1)}s par cliente).\n` +
      `Tu peux fermer cet écran, l'envoi continue côté serveur.`
    );
    if (!ok) return;

    // AUDIT : trace l'envoi campagne WhatsApp bulk (action sensible — N° de cibles).
    adminLogAction({
      action:     'send_marketing_campaign',
      targetType: 'campaign',
      targetId:   null,
      before:     null,
      after:      {
        campaign:  campaignName || null,
        mode:      sendMode,
        blocks:    validBlocks.length,
        recipients: recipientsWithPhone.length,
        filter_skin: filterSkin,
        filter_city: filterCity,
      },
    }).catch(() => { /* best-effort */ });

    setSending(true);
    setProgress({ current: 0, total: recipientsWithPhone.length });
    setLastResult(null);

    const secPerRecipient = validBlocks.length * 1 + 2.5;
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 1;
      const estimatedProgress = Math.min(
        Math.floor(elapsed / secPerRecipient),
        recipientsWithPhone.length - 1,
      );
      setProgress({ current: estimatedProgress, total: recipientsWithPhone.length });
    }, 1000);

    try {
      const result = await sendWhatsAppBulk({
        campaignName: campaignName || `Campagne — ${new Date().toLocaleString('fr-SN')}`,
        blocks: validBlocks.map(b => b.type === 'image'
          ? { type: 'image', image_url: b.image_url, caption: b.caption || '' }
          : { type: 'text',  text: b.text }
        ),
        recipients: recipientsWithPhone,
      });
      clearInterval(tick);
      if (!result.success) {
        toast.error(`Erreur : ${result.error || 'inconnu'}`);
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

  // ─── Preview cliente courante ──────────────────────────
  const previewUser = filtered.find(u => selectedUsers.includes(u.id)) || filtered[0] || { first_name: 'Aïssa', skin_type: 'mixte' };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Marketing</h1>
          <p>Campagnes WhatsApp — séquence de 1 à {MAX_BLOCKS} messages (images + texte avec link preview)</p>
        </div>
      </header>

      {/* Progress */}
      {sending && (
        <div className="adm-recent-card" style={{ marginBottom: 16, background: '#FFF7E6', borderLeft: '4px solid #FFB020' }}>
          <h3 style={{ margin: 0 }}>⏳ Envoi en cours…</h3>
          <p style={{ fontSize: 13, color: '#6B6B6B', marginTop: 4 }}>
            {progress.current} / {progress.total} clientes traitées
          </p>
          <div style={{ background: '#EEE', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
            <div style={{
              background: '#1F8B4C',
              height: '100%',
              width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%',
              transition: 'width 1s linear',
            }} />
          </div>
        </div>
      )}

      {/* Résultat */}
      {lastResult && !sending && (
        <div className="adm-recent-card" style={{ marginBottom: 16, background: lastResult.failed > 0 ? '#FFF0F0' : '#F0FFF4', borderLeft: `4px solid ${lastResult.failed > 0 ? '#E14' : '#1F8B4C'}` }}>
          <h3 style={{ margin: 0 }}>
            {lastResult.failed > 0 ? '⚠️' : '✅'} Campagne terminée
          </h3>
          <p style={{ fontSize: 14, marginTop: 4 }}>
            <strong>{lastResult.sent}</strong> clientes touchées ({lastResult.blocks_per_recipient} msg/cliente) ·
            <strong> {lastResult.failed}</strong> échecs sur {lastResult.total}
          </p>
          {lastResult.failed > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6B6B6B' }}>
                Voir les échecs ({lastResult.failed})
              </summary>
              <ul style={{ marginTop: 8, fontSize: 12, paddingLeft: 18 }}>
                {(lastResult.details || []).filter(d => d.status !== 'sent').map((d, i) => (
                  <li key={d.phone || i} style={{ color: '#C00' }}>
                    {d.phone} → {d.status} ({d.blocks_sent}/{d.blocks_total}){d.errors?.length ? ' · ' + d.errors.join('; ') : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="adm-btn-sec" style={{ marginTop: 8 }} onClick={() => setLastResult(null)}>Fermer</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* ─── BLOC GAUCHE : Message + Blocks ─── */}
        <div className="adm-recent-card">
          <h3>📝 Message</h3>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Template (charge dans le 1er block texte)</span>
            <select
              onChange={e => applyTemplate(e.target.value)}
              defaultValue=""
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            >
              <option value="">— Choisir un template —</option>
              {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Nom de campagne (optionnel)</span>
            <input
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="Ex : Promo Tabaski 2026"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            />
          </label>

          {/* Liste des blocks */}
          <div style={{ marginTop: 4 }}>
            {blocks.map((b, idx) => (
              <div key={b.id} style={{
                background: b.type === 'image' ? '#F0F9FF' : '#FFF9E6',
                border: '1px solid ' + (b.type === 'image' ? '#BAE6FD' : '#FDE68A'),
                borderRadius: 8,
                padding: 10,
                marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>
                    Bloc {idx + 1} · {b.type === 'image' ? '🖼️ Image' : '💬 Texte'}
                  </strong>
                  {blocks.length > 1 && (
                    <button onClick={() => removeBlock(b.id)} disabled={sending}
                      style={{ background: 'none', border: 0, color: '#C00', cursor: 'pointer', fontSize: 16 }}>
                      ×
                    </button>
                  )}
                </div>

                {b.type === 'image' ? (
                  <>
                    {!b.image_url ? (
                      <>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={e => handleImageUpload(b.id, e.target.files?.[0])}
                          disabled={sending || uploadingBlockId === b.id}
                          style={{ fontSize: 12 }}
                        />
                        {uploadingBlockId === b.id && (
                          <p style={{ fontSize: 12, color: '#1F8B4C', marginTop: 4 }}>⏳ Upload…</p>
                        )}
                      </>
                    ) : (
                      <>
                        <img src={b.image_url} alt="" style={{ maxWidth: '100%', maxHeight: 150, borderRadius: 6, border: '1px solid #DDD' }} />
                        <button className="adm-btn-sec" style={{ marginTop: 6, fontSize: 11 }} onClick={() => updateBlock(b.id, { image_url: '' })} disabled={sending}>
                          ✕ Retirer
                        </button>
                      </>
                    )}
                    <textarea
                      value={b.caption || ''}
                      onChange={e => updateBlock(b.id, { caption: e.target.value })}
                      rows={2}
                      placeholder="Caption sous l'image (optionnel)"
                      style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #DDD', fontSize: 12, marginTop: 6 }}
                      disabled={sending}
                    />
                  </>
                ) : (
                  <>
                    <textarea
                      value={b.text}
                      onChange={e => updateBlock(b.id, { text: e.target.value })}
                      rows={4}
                      placeholder="Texte (URL incluse = link preview auto WhatsApp)"
                      style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #DDD', fontSize: 12 }}
                      disabled={sending}
                    />
                    <p style={{ fontSize: 10, color: '#6B6B6B', marginTop: 4 }}>
                      💡 Mets une URL pour que WhatsApp génère une carte preview cliquable.
                    </p>
                  </>
                )}
              </div>
            ))}

            {/* Boutons ajout */}
            {blocks.length < MAX_BLOCKS && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="adm-btn-sec" onClick={() => addBlock('image')} disabled={sending}>
                  + 🖼️ Image
                </button>
                <button className="adm-btn-sec" onClick={() => addBlock('text')} disabled={sending}>
                  + 💬 Texte / Lien
                </button>
              </div>
            )}
          </div>

          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 12 }}>
            Variables : <code>{`{name}`}</code> · <code>{`{skinType}`}</code> · les blocks sont envoyés en séquence avec 1 sec de délai.
          </p>
        </div>

        {/* ─── BLOC DROITE : Cible + Preview ─── */}
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
            {filtered.length} clientes correspondent · {selectedUsers.length} sélectionnées · {blocks.length} message(s)/cliente
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="adm-btn-sec" onClick={selectAll} disabled={sending}>Tout sélectionner</button>
            <button className="adm-btn-sec" onClick={() => setSelectedUsers([])} disabled={sending}>Désélectionner</button>
            <button className="adm-btn-pri" onClick={sendAll} disabled={sending || selectedUsers.length === 0 || uploadingBlockId !== null}>
              {sending ? '⏳ Envoi...' : `💬 Envoyer aux ${selectedUsers.length}`}
            </button>
          </div>

          {/* Preview multi-bubble */}
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: 12, color: '#6B6B6B' }}>👁️ Aperçu WhatsApp</strong>
            <div style={{
              marginTop: 8,
              background: '#E5DDD5',
              padding: 12,
              borderRadius: 8,
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.02) 0, rgba(0,0,0,0.02) 1px, transparent 1px, transparent 11px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              {blocks.map((b, idx) => {
                const text = b.type === 'image' ? personalizeMessage(b.caption || '', previewUser) : personalizeMessage(b.text || '', previewUser);
                const hasImg = b.type === 'image' && b.image_url;
                const hasContent = hasImg || text;
                if (!hasContent) {
                  return (
                    <div key={b.id} style={{ background: '#FFF', padding: '6px 10px', borderRadius: 8, fontSize: 11, color: '#999', maxWidth: 280, fontStyle: 'italic' }}>
                      Block {idx + 1} vide
                    </div>
                  );
                }
                return (
                  <div key={b.id} style={{
                    background: '#FFF',
                    padding: hasImg ? 4 : 10,
                    borderRadius: 8,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    maxWidth: 280,
                  }}>
                    {hasImg && (
                      <img src={b.image_url} alt="" style={{ width: '100%', borderRadius: 6, display: 'block', marginBottom: text ? 6 : 0 }} />
                    )}
                    {text && (
                      <div style={{ padding: hasImg ? '4px 6px 6px 6px' : 0, fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap', color: '#111' }}>
                        {text}
                      </div>
                    )}
                    <div style={{ textAlign: 'right', fontSize: 10, color: '#999', marginTop: 4, padding: hasImg ? '0 6px 4px 0' : 0 }}>
                      {new Date().toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit' })} ✓✓
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
              Aperçu pour : <strong>{previewUser?.first_name || 'Aïssa'}</strong>
            </p>
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
