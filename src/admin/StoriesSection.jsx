// ═══ Admin Stories — CRUD éphémères Instagram-style ═══

import { useState, useEffect } from 'react';
import {
  getAllStoriesAdmin,
  createStory,
  updateStory,
  deleteStory,
  uploadStoryMedia,
  getStoryViewsCount,
} from '../lib/supabase/stories';
import { adminLogAction } from '../lib/adminApi';
import { toast, confirmDialog } from '../lib/toast';

const BG_COLORS = [
  { color: '#1F8B4C', label: 'Vert YARAM' },
  { color: '#F4B53A', label: 'Jaune' },
  { color: '#E8385C', label: 'Rose' },
  { color: '#4285F4', label: 'Bleu' },
  { color: '#166635', label: 'Vert foncé' },
  { color: '#1A1A1A', label: 'Noir' },
  { color: '#E87722', label: 'Orange' },
  { color: '#5E2EA8', label: 'Violet' },
];

const CONTENT_TYPES = [
  { value: 'text', label: '📝 Texte (emoji + message)' },
  { value: 'image', label: '🖼️ Image' },
  { value: 'video', label: '🎬 Vidéo courte (max 15s)' },
];

const CTA_PRESETS = [
  { value: '', label: 'Aucun CTA' },
  { value: '/promos', label: '🏷️ Page Promos' },
  { value: '/(tabs)/search', label: '🔍 Recherche' },
  { value: '/skin-scan', label: '✨ Diagnostic peau IA' },
  { value: '/international', label: '🌍 Boutique internationale' },
  { value: '/loyalty', label: '⭐ Fidélité' },
  { value: '/referral', label: '🎁 Parrainage' },
  { value: 'custom', label: '🔗 URL personnalisée' },
];

const AUDIENCES = [
  { value: 'all', label: '🌐 Tout le monde' },
  { value: 'loyalty_silver+', label: '🥈 Argent et +' },
  { value: 'loyalty_gold+', label: '🥇 Or et +' },
  { value: 'new_users', label: '🆕 Nouveaux inscrits' },
];

const emptyForm = () => ({
  title: '',
  emoji: '✨',
  bg_color: '#1F8B4C',
  content_type: 'text',
  content_text: '',
  media_url: '',
  cta_label: '',
  cta_url: '',
  priority: 0,
  target_audience: 'all',
  active: true,
  expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16),
});

export default function StoriesSection() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [viewsCount, setViewsCount] = useState({});

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    setLoading(true);
    const data = await getAllStoriesAdmin();
    setStories(data);
    // Fetch views count for each story
    const counts = {};
    await Promise.all(data.map(async (s) => {
      counts[s.id] = await getStoryViewsCount(s.id);
    }));
    setViewsCount(counts);
    setLoading(false);
  };

  const handleSave = async (story) => {
    try {
      // Convert expires_at de datetime-local string vers ISO
      const payload = { ...story };
      if (payload.expires_at && !payload.expires_at.includes('Z')) {
        payload.expires_at = new Date(payload.expires_at).toISOString();
      }

      if (story.id) {
        adminLogAction({
          action: 'update_story', targetType: 'story', targetId: story.id,
          before: null, after: { title: story.title, active: story.active },
        }).catch(() => {});
        await updateStory(story.id, payload);
        toast.success('Story mise à jour ✓');
      } else {
        delete payload.id;
        const created = await createStory(payload);
        adminLogAction({
          action: 'create_story', targetType: 'story', targetId: created.id,
          before: null, after: { title: story.title },
        }).catch(() => {});
        toast.success('Story créée ✓');
      }
      setShowForm(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    }
  };

  const handleDelete = async (story) => {
    const ok = await confirmDialog({
      title: 'Supprimer cette story ?',
      message: `"${story.title}" sera supprimée définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteStory(story.id);
      adminLogAction({ action: 'delete_story', targetType: 'story', targetId: story.id, before: { title: story.title }, after: null }).catch(() => {});
      toast.success('Story supprimée');
      refresh();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    }
  };

  const toggleActive = async (story) => {
    try {
      await updateStory(story.id, { active: !story.active });
      toast.success(story.active ? 'Désactivée' : 'Activée');
      refresh();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const isExpired = (s) => s.expires_at && new Date(s.expires_at) < new Date();

  if (showForm) {
    return (
      <StoryForm
        story={editing || emptyForm()}
        onSave={handleSave}
        onCancel={() => { setShowForm(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>📸 Stories</h2>
          <p className="muted">Contenus éphémères style Instagram dans le carousel du Home.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          + Nouvelle story
        </button>
      </div>

      {loading ? (
        <div className="muted">Chargement…</div>
      ) : stories.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 48, marginBottom: 12 }}>📸</div>
          <p>Aucune story pour l'instant. Crée ta première pour engager tes utilisateurs.</p>
        </div>
      ) : (
        <div className="stories-grid">
          {stories.map((s) => (
            <div key={s.id} className="story-card" style={{ borderLeft: `4px solid ${s.bg_color}` }}>
              <div className="story-preview" style={{ backgroundColor: s.bg_color }}>
                {s.content_type === 'image' && s.media_url ? (
                  <img src={s.media_url} alt={s.title} />
                ) : (
                  <div className="story-preview-text">
                    <span style={{ fontSize: 36 }}>{s.emoji}</span>
                  </div>
                )}
              </div>
              <div className="story-info">
                <div className="story-title">{s.title}</div>
                <div className="story-meta">
                  <span className={s.active ? 'badge-active' : 'badge-inactive'}>
                    {s.active ? '● Active' : '○ Inactive'}
                  </span>
                  {isExpired(s) && <span className="badge-expired">⏱ Expirée</span>}
                  <span className="muted">{viewsCount[s.id] || 0} vues</span>
                </div>
                {s.cta_label && <div className="story-cta-preview">→ {s.cta_label}</div>}
              </div>
              <div className="story-actions">
                <button className="btn-icon" title="Modifier" onClick={() => { setEditing(s); setShowForm(true); }}>✏️</button>
                <button className="btn-icon" title={s.active ? 'Désactiver' : 'Activer'} onClick={() => toggleActive(s)}>
                  {s.active ? '🚫' : '✅'}
                </button>
                <button className="btn-icon danger" title="Supprimer" onClick={() => handleDelete(s)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .stories-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
          margin-top: 20px;
        }
        .story-card {
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .story-preview {
          height: 140px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-weight: 800;
        }
        .story-preview img {
          width: 100%; height: 100%; object-fit: cover;
        }
        .story-preview-text {
          font-size: 14px;
          text-align: center;
        }
        .story-info { padding: 12px 14px; flex: 1; }
        .story-title { font-weight: 800; margin-bottom: 6px; }
        .story-meta {
          display: flex; gap: 10px; align-items: center;
          font-size: 11px;
        }
        .badge-active { color: #1F8B4C; font-weight: 700; }
        .badge-inactive { color: #9aa3a0; font-weight: 700; }
        .badge-expired { color: #dc2626; font-weight: 700; }
        .story-cta-preview {
          font-size: 12px; color: #1F8B4C; margin-top: 6px; font-weight: 600;
        }
        .story-actions {
          display: flex; gap: 4px; padding: 10px 14px;
          border-top: 1px solid #eee;
        }
        .btn-icon {
          background: #f5f5f5; border: none;
          padding: 6px 10px; border-radius: 6px;
          cursor: pointer; font-size: 14px;
        }
        .btn-icon:hover { background: #e5e5e5; }
        .btn-icon.danger:hover { background: #fee; }
        .empty-state {
          text-align: center; padding: 60px 20px;
          background: #f9fafb; border-radius: 12px;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────

function StoryForm({ story, onSave, onCancel }) {
  const [form, setForm] = useState(story);
  const [uploading, setUploading] = useState(false);
  const [customCtaUrl, setCustomCtaUrl] = useState(false);

  useEffect(() => {
    // Detecter si le cta_url ne matche pas un preset
    const presets = CTA_PRESETS.map(p => p.value);
    if (form.cta_url && !presets.includes(form.cta_url)) {
      setCustomCtaUrl(true);
    }
  }, []);

  const update = (key, value) => setForm({ ...form, [key]: value });

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadStoryMedia(file);
      update('media_url', url);
      toast.success('Image uploadée ✓');
    } catch (err) {
      toast.error('Upload échoué : ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="story-form">
      <div className="story-form-header">
        <button className="btn-back" onClick={onCancel}>← Retour</button>
        <h2>{form.id ? '✏️ Modifier la story' : '📸 Nouvelle story'}</h2>
      </div>

      <div className="form-grid">
        <div>
          <label>Titre <span className="req">*</span></label>
          <input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Promo du jour" required />
        </div>

        <div>
          <label>Emoji</label>
          <input value={form.emoji} onChange={(e) => update('emoji', e.target.value)} placeholder="✨" maxLength={4} style={{ fontSize: 22, textAlign: 'center' }} />
        </div>

        <div className="full">
          <label>Type de contenu</label>
          <select value={form.content_type} onChange={(e) => update('content_type', e.target.value)}>
            {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {form.content_type === 'text' && (
          <div className="full">
            <label>Message texte</label>
            <textarea value={form.content_text || ''} onChange={(e) => update('content_text', e.target.value)} placeholder="Toutes les marques en promo -20%" rows={3} />
          </div>
        )}

        {(form.content_type === 'image' || form.content_type === 'video') && (
          <div className="full">
            <label>Média (image / vidéo max 20 MB)</label>
            <input type="file" accept={form.content_type === 'image' ? 'image/*' : 'video/*'} onChange={handleUpload} disabled={uploading} />
            {form.media_url && (
              <div style={{ marginTop: 8 }}>
                <img src={form.media_url} alt="" style={{ maxHeight: 120, borderRadius: 8 }} />
                <div className="muted" style={{ fontSize: 11 }}>{form.media_url}</div>
              </div>
            )}
            {uploading && <div className="muted">Upload…</div>}
          </div>
        )}

        <div className="full">
          <label>Couleur de fond</label>
          <div className="color-picker">
            {BG_COLORS.map(c => (
              <button
                key={c.color}
                type="button"
                onClick={() => update('bg_color', c.color)}
                className={form.bg_color === c.color ? 'color-active' : ''}
                style={{ background: c.color }}
                title={c.label}
              />
            ))}
          </div>
        </div>

        <div className="full">
          <label>Lien CTA (où va l'user au tap)</label>
          <select
            value={customCtaUrl ? 'custom' : form.cta_url || ''}
            onChange={(e) => {
              if (e.target.value === 'custom') { setCustomCtaUrl(true); update('cta_url', ''); }
              else { setCustomCtaUrl(false); update('cta_url', e.target.value); }
            }}
          >
            {CTA_PRESETS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {customCtaUrl && (
            <input style={{ marginTop: 8 }} value={form.cta_url} onChange={(e) => update('cta_url', e.target.value)} placeholder="https://yaram.app/promos ou /product/XYZ" />
          )}
        </div>

        <div>
          <label>Label du bouton CTA</label>
          <input value={form.cta_label || ''} onChange={(e) => update('cta_label', e.target.value)} placeholder="Voir l'offre" />
        </div>

        <div>
          <label>Cible</label>
          <select value={form.target_audience} onChange={(e) => update('target_audience', e.target.value)}>
            {AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>

        <div>
          <label>Priorité (plus haut = en premier)</label>
          <input type="number" value={form.priority} onChange={(e) => update('priority', parseInt(e.target.value) || 0)} />
        </div>

        <div>
          <label>Expire le</label>
          <input
            type="datetime-local"
            value={form.expires_at?.slice(0, 16) || ''}
            onChange={(e) => update('expires_at', e.target.value)}
          />
        </div>

        <div className="full">
          <label className="checkbox">
            <input type="checkbox" checked={form.active} onChange={(e) => update('active', e.target.checked)} />
            Active (visible aux utilisateurs)
          </label>
        </div>
      </div>

      <div className="form-actions">
        <button className="btn-secondary" onClick={onCancel}>Annuler</button>
        <button className="btn-primary" onClick={() => onSave(form)} disabled={!form.title || uploading}>
          {form.id ? 'Sauvegarder' : 'Créer la story'}
        </button>
      </div>

      <style jsx>{`
        .story-form { background: #fff; padding: 24px; border-radius: 12px; }
        .story-form-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
        .btn-back { background: none; border: none; cursor: pointer; font-size: 14px; color: #1F8B4C; }
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .form-grid .full { grid-column: span 2; }
        .form-grid label { display: block; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
        .form-grid input, .form-grid select, .form-grid textarea {
          width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px;
          font-size: 14px;
        }
        .checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .checkbox input { width: auto; }
        .color-picker { display: flex; gap: 8px; flex-wrap: wrap; }
        .color-picker button {
          width: 36px; height: 36px; border-radius: 50%;
          border: 2px solid transparent; cursor: pointer;
        }
        .color-picker button.color-active { border-color: #000; transform: scale(1.1); }
        .form-actions { display: flex; gap: 12px; margin-top: 24px; justify-content: flex-end; }
        .req { color: #dc2626; }
      `}</style>
    </div>
  );
}
