// ════════════════════════════════════════════════════════
// YARAM Admin — Section "Splash Promos" (Interstitial Promos)
// ════════════════════════════════════════════════════════
// CRUD complet pour les promos plein écran :
//   - Liste avec toggle on/off, preview thumbnail, stats CTR
//   - Editor : mode image OR template, preview live, tous les champs
// ════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';
import { listAllPromos, getPromoStats } from '../lib/promos';
import { uploadProductImage } from '../lib/supabase';

const COUNTRIES = [
  { code: 'all', label: '🌍 Tous les users' },
  { code: 'new_users', label: '🆕 Nouveaux (< 7j)' },
  { code: 'returning_users', label: '🔁 Anciens (> 30j)' },
  { code: 'with_orders', label: '🛍️ Ont commandé' },
  { code: 'no_orders', label: '👀 Jamais commandé' },
];

const FREQUENCIES = [
  { code: 'always', label: 'À chaque ouverture' },
  { code: 'once', label: '1 fois pour toujours' },
  { code: 'once_per_session', label: '1 fois par session' },
  { code: 'once_per_day', label: '1 fois par jour' },
  { code: 'once_per_week', label: '1 fois par semaine' },
];

const PLACEMENTS = [
  { code: 'home', label: '🏠 Accueil' },
  { code: 'login', label: '🔓 Après connexion' },
  { code: 'all', label: '🌐 Partout' },
];

export default function PromosSplashSection() {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | promo object
  const [statsCache, setStatsCache] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const list = await listAllPromos();
      setPromos(list);
      // Charge les stats en parallèle
      const stats = {};
      await Promise.all(list.map(async p => {
        try { stats[p.id] = await getPromoStats(p.id); } catch { /* ignore */ }
      }));
      setStatsCache(stats);
    } catch (e) {
      toast.error('Erreur chargement : ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (promo) => {
    try {
      const { error } = await supabase
        .from('app_promos')
        .update({ is_active: !promo.is_active })
        .eq('id', promo.id);
      if (error) throw error;
      toast.success(promo.is_active ? 'Promo désactivée' : 'Promo activée');
      await load();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    }
  };

  const deletePromo = async (promo) => {
    const ok = await confirmDialog({
      title: 'Supprimer la promo ?',
      message: 'Cette action est irréversible (les stats seront perdues).',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('app_promos').delete().eq('id', promo.id);
      if (error) throw error;
      toast.success('Promo supprimée');
      await load();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    }
  };

  if (editing) {
    return (
      <PromoEditor
        promo={editing === 'new' ? null : editing}
        onSave={async () => { setEditing(null); await load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  if (loading) return <div style={{ padding: 40 }}>Chargement…</div>;

  // Stats globales
  const totalImpressions = Object.values(statsCache).reduce((s, x) => s + (x?.impressions || 0), 0);
  const totalClicks = Object.values(statsCache).reduce((s, x) => s + (x?.clicks || 0), 0);
  const globalCTR = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0;
  const activeCount = promos.filter(p => p.is_active).length;

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>✨ Splash Promos</h1>
          <p style={{ margin: 0, color: '#6B6B6B', fontSize: 13 }}>
            Bannières plein écran affichées au boot de l'app (web + iOS + Android)
          </p>
        </div>
      </header>

      {/* STATS GLOBALES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, padding: '0 16px 14px' }}>
        <StatCard label="Promos actives" value={activeCount} color="#1F8B4C" />
        <StatCard label="Total impressions" value={totalImpressions.toLocaleString('fr-FR')} color="#0066CC" />
        <StatCard label="Total clics" value={totalClicks.toLocaleString('fr-FR')} color="#9C27B0" />
        <StatCard label="CTR global" value={globalCTR + '%'} color={globalCTR >= 5 ? '#1F8B4C' : '#E0A52D'} highlight />
      </div>

      <div style={{ padding: '0 16px 14px' }}>
        <button className="adm-btn-pri" onClick={() => setEditing('new')}>
          + Nouvelle promo
        </button>
      </div>

      <div style={{ padding: '0 16px' }}>
        {promos.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B6B6B' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>✨</div>
            <p>Aucune promo créée.</p>
            <button className="adm-btn-pri" onClick={() => setEditing('new')} style={{ marginTop: 12 }}>
              + Créer la première
            </button>
          </div>
        )}

        {promos.map(p => {
          const stats = statsCache[p.id] || {};
          return (
            <div key={p.id} style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr auto',
              gap: 14,
              background: '#fff',
              border: '1px solid #E5E5E2',
              borderLeft: p.is_active ? '4px solid #1F8B4C' : '4px solid #E5E5E2',
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
              alignItems: 'center',
            }}>
              {/* Preview thumbnail */}
              <div style={{
                width: 70,
                height: 100,
                borderRadius: 8,
                background: p.mode === 'image' && p.image_url
                  ? `url("${p.image_url}") center/cover`
                  : (p.bg_color || '#0A0A1F'),
                color: p.text_color || '#fff',
                fontSize: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 4,
                fontWeight: 700,
              }}>
                {p.mode === 'template' ? (p.title?.slice(0, 30) || 'Promo') : ''}
              </div>

              {/* Infos */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 2 }}>
                  {p.mode === 'image' ? '🖼️ Image' : '📝 Template'} · priorité {p.priority}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(p.title || 'Sans titre').replace(/_/g, '')}
                </div>
                <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 6 }}>
                  {FREQUENCIES.find(f => f.code === p.frequency)?.label || p.frequency} ·
                  {' '}{COUNTRIES.find(c => c.code === p.target_audience)?.label?.replace(/^[^\s]+ /, '') || p.target_audience}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                  <span><strong>{stats.impressions || 0}</strong> vues</span>
                  <span><strong>{stats.clicks || 0}</strong> clics</span>
                  <span style={{ color: (stats.ctr || 0) >= 5 ? '#1F8B4C' : '#6B6B6B' }}>
                    CTR : <strong>{stats.ctr || 0}%</strong>
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={p.is_active} onChange={() => toggleActive(p)} />
                  {p.is_active ? 'Active' : 'Off'}
                </label>
                <button className="adm-btn-sec" onClick={() => setEditing(p)} style={{ fontSize: 12, padding: '5px 10px' }}>
                  Modifier
                </button>
                <button onClick={() => deletePromo(p)} style={{ background: 'none', border: 'none', color: '#D9342B', fontSize: 11, cursor: 'pointer' }}>
                  🗑 Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Éditeur de promo (création + édition)
// ═══════════════════════════════════════════════
function PromoEditor({ promo, onSave, onCancel }) {
  const isNew = !promo;
  const [p, setP] = useState(promo || {
    mode: 'template',
    title: '',
    subtitle: '',
    description: '',
    image_url: '',
    badge_text: '',
    bg_color: '#0A0A1F',
    text_color: '#FFFFFF',
    title_accent_color: '#A78BFA',
    features: [],
    cta_text: '',
    cta_url: '',
    cta_secondary_text: '',
    cta_secondary_url: '',
    target_audience: 'all',
    placement: 'home',
    frequency: 'once_per_day',
    priority: 5,
    is_active: true,
    start_date: null,
    end_date: null,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const upd = (k, v) => setP({ ...p, [k]: v });

  const handleSave = async () => {
    if (p.mode === 'template' && !p.title?.trim()) {
      toast.error('Titre requis pour mode template');
      return;
    }
    if (p.mode === 'image' && !p.image_url?.trim()) {
      toast.error('Image requise pour mode image');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...p, priority: Number(p.priority) || 0 };
      delete payload.created_at;
      delete payload.updated_at;
      if (isNew) delete payload.id;

      const { error } = isNew
        ? await supabase.from('app_promos').insert(payload)
        : await supabase.from('app_promos').update(payload).eq('id', p.id);
      if (error) throw error;
      toast.success(isNew ? 'Promo créée ✅' : 'Promo modifiée ✅');
      onSave();
    } catch (e) {
      toast.error('Erreur : ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // FIX juin 2026 : uploadProductImage retourne une string URL ou null,
      // pas un objet {url}. Destructurer sur null faisait planter.
      const url = await uploadProductImage(file);
      if (!url) throw new Error('Upload échoué — vérifie la policy Storage côté Supabase');
      upd('image_url', url);
      toast.success('Image uploadée ✅');
    } catch (err) {
      toast.error('Upload : ' + (err?.message || 'erreur inconnue'));
    } finally {
      setUploading(false);
    }
  };

  // Helpers features
  const addFeature = () => upd('features', [...(p.features || []), { icon: '✨', title: '', subtitle: '' }]);
  const updateFeature = (i, k, v) => {
    const next = [...(p.features || [])];
    next[i] = { ...next[i], [k]: v };
    upd('features', next);
  };
  const removeFeature = (i) => upd('features', p.features.filter((_, idx) => idx !== i));

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <button className="adm-link" onClick={onCancel}>← Retour</button>
          <h1>{isNew ? '+ Nouvelle promo' : 'Modifier promo'}</h1>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)', gap: 20, padding: '0 16px' }}>
        {/* COLONNE GAUCHE : FORM */}
        <div>
          {/* Mode */}
          <div className="adm-form-section">
            <h3>Type de promo</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => upd('mode', 'template')}
                style={{
                  flex: 1, padding: 14, borderRadius: 10,
                  border: `2px solid ${p.mode === 'template' ? '#0066CC' : '#E5E5E2'}`,
                  background: p.mode === 'template' ? 'rgba(0,102,204,0.06)' : '#fff',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>📝</div>
                <strong>Template</strong>
                <div style={{ fontSize: 11, color: '#6B6B6B' }}>Badge + titre + features + boutons</div>
              </button>
              <button
                type="button"
                onClick={() => upd('mode', 'image')}
                style={{
                  flex: 1, padding: 14, borderRadius: 10,
                  border: `2px solid ${p.mode === 'image' ? '#0066CC' : '#E5E5E2'}`,
                  background: p.mode === 'image' ? 'rgba(0,102,204,0.06)' : '#fff',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>🖼️</div>
                <strong>Image</strong>
                <div style={{ fontSize: 11, color: '#6B6B6B' }}>Visuel Canva full-screen</div>
              </button>
            </div>
          </div>

          {/* Mode IMAGE */}
          {p.mode === 'image' && (
            <div className="adm-form-section">
              <h3>Image plein écran</h3>
              <label>
                Image (1080×1920 recommandé)
                <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} />
                {uploading && <small>Upload en cours...</small>}
              </label>
              {p.image_url && (
                <div style={{ marginTop: 8 }}>
                  <img src={p.image_url} alt="Promo" style={{ maxWidth: 200, borderRadius: 8 }} />
                </div>
              )}
              <label>Titre (overlay en bas)<input value={p.title || ''} onChange={e => upd('title', e.target.value)} /></label>
              <label>Sous-titre<input value={p.subtitle || ''} onChange={e => upd('subtitle', e.target.value)} /></label>
            </div>
          )}

          {/* Mode TEMPLATE */}
          {p.mode === 'template' && (
            <>
              <div className="adm-form-section">
                <h3>Contenu</h3>
                <label>Badge en haut<input value={p.badge_text || ''} onChange={e => upd('badge_text', e.target.value)} placeholder="🌍 NOUVEAU sur YARAM" /></label>
                <label>
                  Titre principal *
                  <input value={p.title || ''} onChange={e => upd('title', e.target.value)} placeholder="Boutique _internationale_" />
                  <small style={{ fontSize: 11, color: '#6B6B6B' }}>Mets un mot entre _underscores_ pour le mettre en couleur accent</small>
                </label>
                <label>Sous-titre<input value={p.subtitle || ''} onChange={e => upd('subtitle', e.target.value)} placeholder="Tes marques préférées · 15 jours" /></label>
              </div>

              <div className="adm-form-section">
                <h3>Couleurs</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <label>Fond<input type="color" value={p.bg_color} onChange={e => upd('bg_color', e.target.value)} /></label>
                  <label>Texte<input type="color" value={p.text_color} onChange={e => upd('text_color', e.target.value)} /></label>
                  <label>Accent<input type="color" value={p.title_accent_color} onChange={e => upd('title_accent_color', e.target.value)} /></label>
                </div>
              </div>

              <div className="adm-form-section">
                <h3>Features (les 3 cartes)</h3>
                {(p.features || []).map((f, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input value={f.icon || ''} onChange={e => updateFeature(i, 'icon', e.target.value)} placeholder="✈️" style={{ textAlign: 'center' }} />
                    <input value={f.title || ''} onChange={e => updateFeature(i, 'title', e.target.value)} placeholder="Titre" />
                    <input value={f.subtitle || ''} onChange={e => updateFeature(i, 'subtitle', e.target.value)} placeholder="Sous-titre" />
                    <button onClick={() => removeFeature(i)} style={{ background: 'none', border: 'none', color: '#D9342B', cursor: 'pointer' }}>🗑</button>
                  </div>
                ))}
                <button type="button" className="adm-btn-sec" onClick={addFeature}>+ Feature</button>
              </div>
            </>
          )}

          {/* CTAs */}
          <div className="adm-form-section">
            <h3>Boutons</h3>
            <label>Bouton principal (texte)<input value={p.cta_text || ''} onChange={e => upd('cta_text', e.target.value)} placeholder="Découvrir →" /></label>
            <label>
              Action du bouton (URL ou route interne)
              <input value={p.cta_url || ''} onChange={e => upd('cta_url', e.target.value)} placeholder="/international ou https://..." />
              <small style={{ fontSize: 11, color: '#6B6B6B' }}>Routes internes : /international, /search, /scan, /promos, etc.</small>
            </label>
            <label>Bouton secondaire (optionnel)<input value={p.cta_secondary_text || ''} onChange={e => upd('cta_secondary_text', e.target.value)} placeholder="Plus tard" /></label>
            <label>Action du secondaire<input value={p.cta_secondary_url || ''} onChange={e => upd('cta_secondary_url', e.target.value)} placeholder="(vide = juste fermer)" /></label>
          </div>

          {/* Ciblage & règles */}
          <div className="adm-form-section">
            <h3>Ciblage & affichage</h3>
            <label>Audience<select value={p.target_audience} onChange={e => upd('target_audience', e.target.value)}>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select></label>
            <label>Placement<select value={p.placement} onChange={e => upd('placement', e.target.value)}>
              {PLACEMENTS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select></label>
            <label>Fréquence<select value={p.frequency} onChange={e => upd('frequency', e.target.value)}>
              {FREQUENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>Début (optionnel)<input type="datetime-local" value={p.start_date?.slice(0, 16) || ''} onChange={e => upd('start_date', e.target.value || null)} /></label>
              <label>Fin (optionnel)<input type="datetime-local" value={p.end_date?.slice(0, 16) || ''} onChange={e => upd('end_date', e.target.value || null)} /></label>
            </div>
            <label>Priorité (+ haut = + prioritaire)<input type="number" value={p.priority} onChange={e => upd('priority', e.target.value)} /></label>
            <label className="adm-form-checkbox">
              <input type="checkbox" checked={p.is_active} onChange={e => upd('is_active', e.target.checked)} />
              <span>Promo active</span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, padding: '12px 0 30px' }}>
            <button className="adm-btn-sec" onClick={onCancel}>Annuler</button>
            <button className="adm-btn-pri" onClick={handleSave} disabled={saving}>
              {saving ? 'Enregistrement...' : (isNew ? 'Créer' : 'Enregistrer')}
            </button>
          </div>
        </div>

        {/* COLONNE DROITE : LIVE PREVIEW */}
        <div style={{ position: 'sticky', top: 20, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 40px)' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#6B6B6B' }}>👀 Aperçu live</h3>
          <PromoPreview promo={p} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Preview live de la promo (mini)
// ═══════════════════════════════════════════════
function PromoPreview({ promo }) {
  const bgStyle = promo.mode === 'image' && promo.image_url
    ? { backgroundImage: `url("${promo.image_url}")`, backgroundSize: 'cover', backgroundPosition: 'center', color: '#fff' }
    : { background: promo.bg_color, color: promo.text_color };

  return (
    <div style={{
      width: '100%',
      aspectRatio: '9/19',
      maxHeight: 600,
      borderRadius: 22,
      overflow: 'hidden',
      border: '8px solid #1A1A1A',
      boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
      display: 'flex',
      flexDirection: 'column',
      padding: 20,
      textAlign: 'center',
      ...bgStyle,
    }}>
      {promo.mode === 'image' ? (
        <div style={{ marginTop: 'auto', padding: '20px 0', background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.7))', borderRadius: 8 }}>
          {promo.title && <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{promo.title}</h2>}
          {promo.subtitle && <p style={{ margin: '4px 0 12px', fontSize: 11 }}>{promo.subtitle}</p>}
          {promo.cta_text && (
            <button style={{ width: '100%', padding: 10, borderRadius: 8, background: promo.title_accent_color || '#4F46E5', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700 }}>
              {promo.cta_text}
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ flex: 1 }} />
          {promo.badge_text && (
            <div style={{ display: 'inline-block', alignSelf: 'center', padding: '5px 12px', borderRadius: 16, border: `1px solid ${promo.title_accent_color}44`, fontSize: 10, fontWeight: 600, marginBottom: 18, background: 'rgba(255,255,255,0.05)' }}>
              {promo.badge_text}
            </div>
          )}
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>
            {(promo.title || '').split(/(_[^_]+_)/g).map((part, i) =>
              part.startsWith('_') && part.endsWith('_')
                ? <span key={i} style={{ color: promo.title_accent_color }}>{part.slice(1, -1)}</span>
                : <span key={i}>{part}</span>
            )}
          </h2>
          {promo.subtitle && <p style={{ margin: '0 0 18px', fontSize: 11, opacity: 0.7 }}>{promo.subtitle}</p>}
          {(promo.features || []).slice(0, 3).map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, marginBottom: 6, fontSize: 10, textAlign: 'left' }}>
              <span style={{ fontSize: 14 }}>{f.icon}</span>
              <div>
                <strong style={{ display: 'block' }}>{f.title}</strong>
                <span style={{ opacity: 0.7 }}>{f.subtitle}</span>
              </div>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          {promo.cta_text && (
            <button style={{ width: '100%', padding: 11, borderRadius: 10, background: promo.title_accent_color || '#4F46E5', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              {promo.cta_text}
            </button>
          )}
          {promo.cta_secondary_text && (
            <button style={{ width: '100%', padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: promo.text_color, border: '1px solid rgba(255,255,255,0.1)', fontSize: 11, fontWeight: 600 }}>
              {promo.cta_secondary_text}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Stat card
// ═══════════════════════════════════════════════
function StatCard({ label, value, color, highlight }) {
  return (
    <div style={{
      background: highlight ? `${color}15` : '#fff',
      border: `1px solid ${highlight ? color : '#E5E5E2'}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 10,
      padding: '10px 14px',
    }}>
      <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
