import { useState, useEffect } from 'react';
import { getAllBanners, createBanner, updateBanner, deleteBanner, uploadBannerImage } from '../lib/supabase';

const BG_COLORS = [
  { color: '#1F8B4C', label: 'Vert YARAM' },
  { color: '#F4B53A', label: 'Jaune' },
  { color: '#E8385C', label: 'Rose' },
  { color: '#4285F4', label: 'Bleu' },
  { color: '#166635', label: 'Vert foncé' },
  { color: '#1A1A1A', label: 'Noir' },
];

const LINK_TYPES = [
  { value: 'none', label: 'Aucun (juste affichage)' },
  { value: 'scan', label: '🤖 Scan IA' },
  { value: 'pharmacy', label: '🏥 Page Pharmacies' },
  { value: 'product', label: '📦 Produit spécifique' },
  { value: 'category', label: '🏷️ Catégorie' },
  { value: 'external', label: '🔗 Lien externe' },
];

export default function BannersSection() {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  const refresh = async () => {
    setLoading(true);
    const data = await getAllBanners();
    setBanners(data);
    setLoading(false);
  };

  const handleSave = async (banner) => {
    if (banner.id) {
      await updateBanner(banner.id, banner);
    } else {
      await createBanner(banner);
    }
    setEditing(null);
    setShowForm(false);
    refresh();
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette bannière ?')) return;
    await deleteBanner(id);
    refresh();
  };

  const toggleActive = async (banner) => {
    await updateBanner(banner.id, { active: !banner.active });
    refresh();
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Bannières</h1>
          <p>{banners.length} bannière{banners.length > 1 ? 's' : ''} · {banners.filter(b => b.active).length} active{banners.filter(b => b.active).length > 1 ? 's' : ''}</p>
        </div>
        <button className="adm-btn-pri" onClick={() => { setEditing({}); setShowForm(true); }}>
          + Nouvelle bannière
        </button>
      </header>

      {showForm && editing && (
        <BannerForm
          banner={editing}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : banners.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>🎨</div>
          <p>Aucune bannière. Crée la première !</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {banners.map(b => (
            <div key={b.id} className="adm-recent-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {/* Preview */}
                <div style={{
                  width: 120, height: 80,
                  borderRadius: 10,
                  background: b.bg_color,
                  color: b.text_color,
                  padding: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <div style={{ fontSize: 9, opacity: 0.8 }}>{b.sponsor_name}</div>
                  <strong style={{ fontSize: 12, lineHeight: 1.1, display: 'block', marginTop: 2 }}>{b.title}</strong>
                  {b.image_url && (
                    <img src={b.image_url} alt="" style={{
                      position: 'absolute',
                      right: -10, top: 5,
                      width: 50, height: 50,
                      borderRadius: 6,
                      objectFit: 'cover',
                      opacity: 0.5,
                    }} />
                  )}
                </div>
                
                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>{b.title}</strong>
                    {b.active ? (
                      <span className="adm-badge excellent">✓ Active</span>
                    ) : (
                      <span className="adm-badge bad">✗ Inactive</span>
                    )}
                    <span className="adm-badge medium">#{b.display_order}</span>
                  </div>
                  {b.subtitle && <p style={{ fontSize: 12, color: '#6B6B6B' }}>{b.subtitle}</p>}
                  <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
                    👀 {b.click_count || 0} clicks · Sponsor : {b.sponsor_name || '—'}
                  </p>
                  {b.end_date && (
                    <p style={{ fontSize: 11, color: '#F4B53A', marginTop: 2 }}>
                      ⏱️ Expire le {new Date(b.end_date).toLocaleDateString('fr-FR')}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button className="adm-btn-sec" onClick={() => { setEditing(b); setShowForm(true); }}>✏️ Éditer</button>
                  <button className="adm-btn-sec" onClick={() => toggleActive(b)}>
                    {b.active ? '⏸️ Désactiver' : '▶️ Activer'}
                  </button>
                  <button className="adm-btn-sec" onClick={() => handleDelete(b.id)} style={{ color: '#D9342B' }}>🗑️ Suppr</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BannerForm({ banner, onSave, onCancel }) {
  const [form, setForm] = useState({
    title: banner.title || '',
    subtitle: banner.subtitle || '',
    sponsor_name: banner.sponsor_name || '',
    image_url: banner.image_url || '',
    bg_color: banner.bg_color || '#1F8B4C',
    text_color: banner.text_color || '#FFFFFF',
    cta_text: banner.cta_text || 'Voir plus',
    link_type: banner.link_type || 'none',
    link_target: banner.link_target || '',
    display_order: banner.display_order ?? 99,
    active: banner.active ?? true,
    end_date: banner.end_date ? banner.end_date.slice(0, 10) : '',
    ...banner,
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadBannerImage(file);
    if (url) {
      setForm(f => ({ ...f, image_url: url }));
    } else {
      alert('Erreur upload');
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) { alert('Titre requis'); return; }
    setSaving(true);
    const data = { ...form };
    if (data.end_date) {
      data.end_date = new Date(data.end_date).toISOString();
    } else {
      data.end_date = null;
    }
    delete data.created_at;
    delete data.updated_at;
    delete data.click_count;
    await onSave(data);
    setSaving(false);
  };

  return (
    <div className="adm-form-overlay" onClick={onCancel}>
      <div className="adm-form-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3>{banner.id ? '✏️ Modifier la bannière' : '🎨 Nouvelle bannière'}</h3>
        
        {/* PREVIEW LIVE */}
        <div style={{
          margin: '12px 0',
          padding: 16,
          borderRadius: 12,
          background: form.bg_color,
          color: form.text_color,
          position: 'relative',
          overflow: 'hidden',
          minHeight: 100,
        }}>
          {form.sponsor_name && (
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', opacity: 0.7 }}>{form.sponsor_name}</div>
          )}
          <strong style={{ fontSize: 16, display: 'block', marginTop: 2 }}>{form.title || 'Titre de la bannière'}</strong>
          {form.subtitle && <p style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>{form.subtitle}</p>}
          {form.cta_text && form.link_type !== 'none' && (
            <button style={{
              marginTop: 8,
              padding: '4px 12px',
              background: 'rgba(255,255,255,0.25)',
              color: 'inherit',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
            }}>{form.cta_text} →</button>
          )}
          {form.image_url && (
            <img src={form.image_url} alt="" style={{
              position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)',
              width: 80, height: 80, borderRadius: 8, objectFit: 'cover', opacity: 0.6,
            }} />
          )}
        </div>

        <label>Titre *<input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="🎉 Black Friday YARAM" /></label>
        <label>Sous-titre<input value={form.subtitle} onChange={e => setForm({...form, subtitle: e.target.value})} placeholder="-30% sur tous les sérums" /></label>
        <label>Nom du sponsor<input value={form.sponsor_name} onChange={e => setForm({...form, sponsor_name: e.target.value})} placeholder="Ex: L'Oréal, Pharmacie X, YARAM" /></label>

        <label>📷 Image (optionnel)
          <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} />
        </label>
        {uploading && <p style={{ fontSize: 11, color: '#F4B53A' }}>⏳ Upload en cours...</p>}
        {form.image_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <img src={form.image_url} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6 }} />
            <button className="adm-btn-sec" onClick={() => setForm({...form, image_url: ''})} style={{ fontSize: 11 }}>🗑️ Retirer</button>
          </div>
        )}

        <label>Couleur de fond
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {BG_COLORS.map(c => (
              <button
                key={c.color}
                onClick={() => setForm({...form, bg_color: c.color})}
                style={{
                  width: 36, height: 36,
                  borderRadius: 8,
                  background: c.color,
                  border: form.bg_color === c.color ? '3px solid #1A1A1A' : '1px solid #DDD',
                  cursor: 'pointer',
                }}
                title={c.label}
              />
            ))}
          </div>
        </label>

        <label>Texte du bouton<input value={form.cta_text} onChange={e => setForm({...form, cta_text: e.target.value})} placeholder="Voir plus" /></label>

        <label>Action au clic
          <select value={form.link_type} onChange={e => setForm({...form, link_type: e.target.value})}>
            {LINK_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
          </select>
        </label>

        {(form.link_type === 'product' || form.link_type === 'category' || form.link_type === 'external') && (
          <label>Cible
            <input value={form.link_target} onChange={e => setForm({...form, link_target: e.target.value})} 
              placeholder={
                form.link_type === 'product' ? 'ID du produit' :
                form.link_type === 'category' ? 'serums, hydratants, etc.' :
                'https://...'
              } />
          </label>
        )}

        <label>Ordre d'affichage<input type="number" value={form.display_order} onChange={e => setForm({...form, display_order: parseInt(e.target.value) || 99})} /></label>
        <label>Date de fin (optionnel)<input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} /></label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.active} onChange={e => setForm({...form, active: e.target.checked})} />
          <span>Active (visible dans l'app)</span>
        </label>

        <div className="adm-form-actions">
          <button className="adm-btn-sec" onClick={onCancel}>Annuler</button>
          <button className="adm-btn-pri" onClick={handleSubmit} disabled={saving || uploading}>
            {saving ? 'Enregistrement...' : '💾 Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}
