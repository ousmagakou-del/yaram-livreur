import { useState } from 'react';
import { toast, confirmDialog } from '../lib/toast';
import { pushBroadcast } from '../lib/pushAdmin';

const TEMPLATES = [
  {
    id: 'promo',
    label: '🔥 Promo flash',
    title: '🔥 Promo flash YARAM',
    message: '-15% sur tout le maquillage avec le code YARAM15 — 24h chrono !',
    url: 'https://yaram.app/search?category=maquillage',
  },
  {
    id: 'new_product',
    label: '🆕 Nouveau produit',
    title: '🆕 Nouveau chez YARAM',
    message: 'Un nouveau produit validé par nos dermatos vient d\'arriver. Découvre-le !',
    url: 'https://yaram.app',
  },
  {
    id: 'restock',
    label: '📦 Retour en stock',
    title: '✨ Retour en stock !',
    message: 'Le produit que tu attendais est de retour. Disponible maintenant.',
    url: 'https://yaram.app',
  },
  {
    id: 'pharmacy_new',
    label: '🏥 Nouvelle pharmacie',
    title: '🏥 Nouvelle pharmacie partenaire',
    message: 'Une nouvelle pharmacie rejoint YARAM dans ton quartier !',
    url: 'https://yaram.app/pharmacies',
  },
  {
    id: 'reminder_scan',
    label: '✨ Rappel scan IA',
    title: '✨ Scan IA peau',
    message: 'Quand as-tu fait ton dernier scan ? Refais-le en 30 secondes !',
    url: 'https://yaram.app/scan',
  },
];

export default function PushBroadcastSection() {
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('https://yaram.app');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const applyTemplate = (id) => {
    const t = TEMPLATES.find(x => x.id === id);
    if (!t) return;
    setSelectedTemplate(id);
    setTitle(t.title);
    setMessage(t.message);
    setUrl(t.url || 'https://yaram.app');
  };

  const send = async () => {
    if (!title.trim() || !message.trim()) {
      return toast.error('Titre + message requis');
    }
    if (title.length > 50) {
      return toast.error('Titre max 50 caractères (sinon tronqué sur iOS)');
    }
    if (message.length > 200) {
      return toast.error('Message max 200 caractères');
    }

    const ok = await confirmDialog(
      `Envoyer ce push à TOUTES les clientes ayant l'app YARAM iOS ?\n\n` +
      `Titre : ${title}\n` +
      `Message : ${message}\n\n` +
      `⚠️ Action irréversible. Le push est envoyé immédiatement.`
    );
    if (!ok) return;

    setSending(true);
    setLastResult(null);
    try {
      const res = await pushBroadcast({ title, message, url });
      setLastResult(res);
      if (res.success) {
        toast.success(`✅ Push envoyé à ${res.recipients || '?'} appareils`);
      } else {
        toast.error('Erreur : ' + (res.error || 'inconnue'));
      }
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || String(e)));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Push notifications</h1>
          <p>Envoyer un push à toutes les clientes iOS qui ont l'app YARAM</p>
        </div>
      </header>

      {lastResult && (
        <div className="adm-recent-card" style={{
          marginBottom: 16,
          background: lastResult.success ? '#F0FFF4' : '#FFF0F0',
          borderLeft: `4px solid ${lastResult.success ? '#1F8B4C' : '#E14'}`,
        }}>
          <h3 style={{ margin: 0 }}>
            {lastResult.success ? '✅ Push envoyé' : '⚠️ Échec'}
          </h3>
          {lastResult.success ? (
            <p style={{ fontSize: 14, marginTop: 4 }}>
              <strong>{lastResult.recipients || '?'}</strong> appareils ciblés.
              ID notification : <code style={{ fontSize: 11 }}>{lastResult.notification_id}</code>
            </p>
          ) : (
            <p style={{ fontSize: 14, marginTop: 4, color: '#C00' }}>
              {lastResult.error}
            </p>
          )}
          <button className="adm-btn-sec" style={{ marginTop: 8 }} onClick={() => setLastResult(null)}>
            Fermer
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* ─── BLOC GAUCHE : Composition ─── */}
        <div className="adm-recent-card">
          <h3>📝 Message</h3>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>Template</span>
            <select
              value={selectedTemplate}
              onChange={e => applyTemplate(e.target.value)}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            >
              <option value="">— Choisir un template —</option>
              {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>
              Titre <span style={{ color: title.length > 50 ? '#C00' : '#6B6B6B' }}>({title.length}/50)</span>
            </span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={50}
              placeholder="🔥 Promo flash"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>
              Message <span style={{ color: message.length > 200 ? '#C00' : '#6B6B6B' }}>({message.length}/200)</span>
            </span>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              maxLength={200}
              placeholder="-15% sur tout le maquillage avec le code YARAM15"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 13, marginTop: 4 }}
              disabled={sending}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#6B6B6B' }}>URL au tap (deep link)</span>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://yaram.app"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', marginTop: 4 }}
              disabled={sending}
            />
            <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
              Quand l'user tap le push, l'app ouvre cette page. Ex : <code>https://yaram.app/search?brand=Bioderma</code>
            </p>
          </label>

          <button
            className="adm-btn-pri"
            onClick={send}
            disabled={sending || !title.trim() || !message.trim()}
            style={{ width: '100%', marginTop: 8 }}
          >
            {sending ? '⏳ Envoi…' : '📤 Envoyer à toutes les clientes iOS'}
          </button>
        </div>

        {/* ─── BLOC DROITE : Preview ─── */}
        <div className="adm-recent-card">
          <h3>👁️ Aperçu iOS</h3>
          <p style={{ fontSize: 12, color: '#6B6B6B' }}>
            Voilà comment apparaîtra le push sur l'écran de tes clientes iOS.
          </p>

          <div style={{
            marginTop: 16,
            background: '#000',
            padding: 20,
            borderRadius: 24,
            position: 'relative',
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(20px)',
              borderRadius: 16,
              padding: 12,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: '#1F8B4C',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                color: 'white', fontWeight: 800, fontSize: 18,
              }}>Y</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 13, color: 'white' }}>YARAM</strong>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>maintenant</span>
                </div>
                <div style={{ fontSize: 13, color: 'white', fontWeight: 600, marginTop: 2 }}>
                  {title || 'Titre du push'}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)', marginTop: 2 }}>
                  {message || 'Message du push…'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: 12, background: '#FFF9E6', borderRadius: 8, borderLeft: '3px solid #FFB020' }}>
            <strong style={{ fontSize: 12 }}>⚠️ Bonnes pratiques</strong>
            <ul style={{ fontSize: 11, color: '#6B6B6B', margin: '4px 0 0 16px', padding: 0 }}>
              <li>Pas plus de 2-3 push/semaine (sinon désinstall)</li>
              <li>Heures envoi : 10h-13h ou 17h-20h (engagement max)</li>
              <li>Évite vendredi soir + dimanche (taux d'ouverture bas)</li>
              <li>Emojis = +30% d'ouverture</li>
              <li>Une seule promo à la fois (sinon spam)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
