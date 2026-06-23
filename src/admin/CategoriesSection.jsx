import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { adminLogAction } from '../lib/adminApi';
import { confirmDialog } from '../lib/toast';

const CATEGORY_PRESETS = [
  { bg: '#FFE4D6', text: '#993C1D', label: 'Orange doux' },
  { bg: '#FFF4D6', text: '#854F0B', label: 'Jaune solaire' },
  { bg: '#E8E4FF', text: '#3C3489', label: 'Violet clair' },
  { bg: '#FBEAF0', text: '#993556', label: 'Rose poudre' },
  { bg: '#E6F1FB', text: '#185FA5', label: 'Bleu ciel' },
  { bg: '#EAF3DE', text: '#3B6D11', label: 'Vert tendre' },
  { bg: '#F0E4FF', text: '#534AB7', label: 'Lavande' },
  { bg: '#FAECE7', text: '#993C1D', label: 'Corail' },
  { bg: '#E1F5EE', text: '#0F6E56', label: 'Menthe' },
  { bg: '#FCEBEB', text: '#A32D2D', label: 'Rouge doux' },
  { bg: '#F4F4F2', text: '#1A1A1A', label: 'Neutre' },
];

export default function CategoriesSection() {
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  const [uploadingId, setUploadingId] = useState(null);

  const flash = (text, kind = 'ok') => {
    setMsg({ text, kind });
    setTimeout(() => setMsg({ text: '', kind: '' }), 3500);
  };

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('display_order', { ascending: true });
    if (error) {
      flash('Erreur chargement : ' + error.message, 'err');
    }
    setCats(data || []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  // ─── Upload SVG ───
  const handleUploadSVG = async (cat, file) => {
    if (!file) return;

    // Validation
    if (file.type !== 'image/svg+xml' && !file.name.endsWith('.svg')) {
      flash('Le fichier doit etre un SVG', 'err');
      return;
    }
    if (file.size > 500 * 1024) {
      flash('SVG trop lourd (max 500 KB)', 'err');
      return;
    }

    setUploadingId(cat.id);

    // Nom unique : slug + timestamp pour casser le cache
    const filename = `${cat.slug}-${Date.now()}.svg`;

    // Upload
    const { data: uploadData, error: uploadErr } = await supabase
      .storage
      .from('category-icons')
      .upload(filename, file, {
        cacheControl: '3600',
        contentType: 'image/svg+xml',
        upsert: true,
      });

    if (uploadErr) {
      setUploadingId(null);
      flash('Upload echoue : ' + uploadErr.message, 'err');
      return;
    }

    // Recupere l'URL publique
    const { data: urlData } = supabase
      .storage
      .from('category-icons')
      .getPublicUrl(filename);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      setUploadingId(null);
      flash('URL publique non recuperee', 'err');
      return;
    }

    // Update la categorie
    const { error: updErr } = await supabase
      .from('categories')
      .update({ icon_url: publicUrl })
      .eq('id', cat.id);

    setUploadingId(null);

    if (updErr) {
      flash('Sauvegarde echouee : ' + updErr.message, 'err');
      return;
    }

    adminLogAction({
      action:     'upload_category_icon',
      targetType: 'category',
      targetId:   cat.id,
      before:     null,
      after:      { name: cat.name, icon_filename: filename },
    }).catch(() => { /* best-effort */ });
    flash(`Icone uploadee pour ${cat.name}`);
    refresh();
  };

  // ─── Retirer l'icone SVG (revient au fallback) ───
  const handleRemoveSVG = async (cat) => {
    if (!await confirmDialog(`Retirer l'icone de "${cat.name}" ?`)) return;
    const { error } = await supabase
      .from('categories')
      .update({ icon_url: null })
      .eq('id', cat.id);
    if (error) { flash('Erreur : ' + error.message, 'err'); return; }
    adminLogAction({
      action:     'remove_category_icon',
      targetType: 'category',
      targetId:   cat.id,
      before:     { name: cat.name, had_icon: true },
      after:      null,
    }).catch(() => { /* best-effort */ });
    flash('Icone retiree');
    refresh();
  };

  // ─── Edit categorie ───
  const handleSave = async (cat) => {
    const payload = {
      name: cat.name?.trim(),
      slug: cat.slug?.trim().toLowerCase().replace(/\s+/g, '_'),
      bg_color: cat.bg_color,
      text_color: cat.text_color,
      display_order: parseInt(cat.display_order) || 999,
      active: !!cat.active,
    };
    if (!payload.name || !payload.slug) {
      flash('Nom et slug requis', 'err');
      return;
    }
    const op = cat.id
      ? supabase.from('categories').update(payload).eq('id', cat.id)
      : supabase.from('categories').insert(payload);
    const { error } = await op;
    if (error) { flash('Erreur : ' + error.message, 'err'); return; }
    adminLogAction({
      action:     cat.id ? 'update_category' : 'create_category',
      targetType: 'category',
      targetId:   cat.id || null,
      before:     null,
      after:      { name: payload.name, slug: payload.slug, active: payload.active },
    }).catch(() => { /* best-effort */ });
    flash(cat.id ? 'Categorie modifiee' : 'Categorie creee');
    setEditing(null);
    setShowNew(false);
    refresh();
  };

  // ─── Delete ───
  const handleDelete = async (cat) => {
    if (!await confirmDialog(`Supprimer definitivement "${cat.name}" ?\n\nLes produits avec cette categorie ne seront PAS supprimes mais n'apparaitront plus dans le filtre.`)) return;
    const { error } = await supabase.from('categories').delete().eq('id', cat.id);
    if (error) { flash('Erreur : ' + error.message, 'err'); return; }
    adminLogAction({
      action:     'delete_category',
      targetType: 'category',
      targetId:   cat.id,
      before:     { name: cat.name, slug: cat.slug, active: cat.active },
      after:      null,
    }).catch(() => { /* best-effort */ });
    flash('Categorie supprimee');
    refresh();
  };

  // ─── Toggle active ───
  const handleToggleActive = async (cat) => {
    const { error } = await supabase
      .from('categories')
      .update({ active: !cat.active })
      .eq('id', cat.id);
    if (error) { flash('Erreur : ' + error.message, 'err'); return; }
    adminLogAction({
      action:     'toggle_category_active',
      targetType: 'category',
      targetId:   cat.id,
      before:     { active: cat.active,  name: cat.name },
      after:      { active: !cat.active, name: cat.name },
    }).catch(() => { /* best-effort */ });
    refresh();
  };

  // ─── Reorder ───
  const handleMove = async (cat, direction) => {
    const idx = cats.findIndex(c => c.id === cat.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= cats.length) return;
    const other = cats[swapIdx];
    // Swap des display_order
    const a = supabase.from('categories').update({ display_order: other.display_order }).eq('id', cat.id);
    const b = supabase.from('categories').update({ display_order: cat.display_order }).eq('id', other.id);
    const [r1, r2] = await Promise.all([a, b]);
    if (r1.error || r2.error) {
      flash('Erreur reorder', 'err');
      return;
    }
    refresh();
  };

  const S = {
    section: { padding: 24 },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: '#6B6B6B', fontSize: 13, marginTop: 4 },
    head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
    btnPrimary: { padding: '10px 16px', borderRadius: 10, background: '#1F8B4C', color: 'white', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    btnGhost: { padding: '6px 10px', borderRadius: 8, background: '#F4F4F2', color: '#1A1A1A', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    btnDanger: { padding: '6px 10px', borderRadius: 8, background: '#FCE9E7', color: '#D9342B', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    btnBlue: { padding: '6px 10px', borderRadius: 8, background: '#E6F1FB', color: '#185FA5', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 },
    card: { background: 'white', borderRadius: 14, border: '1px solid #EEE', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
    cardHead: { display: 'flex', alignItems: 'center', gap: 12 },
    preview: (bg, text) => ({ width: 64, height: 64, borderRadius: 14, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text, fontSize: 24, fontWeight: 800, flexShrink: 0 }),
    msg: (kind) => ({ padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12, background: kind === 'err' ? '#FCE9E7' : '#E8F5EC', color: kind === 'err' ? '#D9342B' : '#1F8B4C' }),
    chipInactive: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, background: '#FEF6E5', color: '#A07700', fontWeight: 700 },
    fileLabel: { display: 'inline-block', padding: '6px 12px', borderRadius: 8, background: '#1F8B4C', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    fileInput: { display: 'none' },
  };

  return (
    <div style={S.section}>
      <div style={S.head}>
        <div>
          <h1 style={S.h1}>Categories du Home</h1>
          <p style={S.sub}>Configurer les icones SVG, couleurs, ordre d'affichage</p>
        </div>
        <button style={S.btnPrimary} onClick={() => setShowNew(true)}>+ Ajouter une categorie</button>
      </div>

      {msg.text && <div style={S.msg(msg.kind)}>{msg.text}</div>}

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement...</p>
      ) : (
        <div style={S.grid}>
          {cats.map((cat, idx) => (
            <div key={cat.id} style={S.card}>
              <div style={S.cardHead}>
                {/* Preview du tile */}
                <div style={S.preview(cat.bg_color || '#F4F4F2', cat.text_color || '#1A1A1A')}>
                  {cat.icon_url ? (
                    <img src={cat.icon_url} alt="" style={{ width: 36, height: 36 }} onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : (
                    cat.name?.[0] || '?'
                  )}
                </div>

                {/* Infos */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A' }}>
                    {cat.name}
                    {!cat.active && <span style={{ ...S.chipInactive, marginLeft: 6 }}>Inactif</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#9B9B9B' }}>
                    slug: <code style={{ background: '#F4F4F2', padding: '1px 5px', borderRadius: 4, fontSize: 10 }}>{cat.slug}</code> · #{cat.display_order}
                  </div>
                </div>

                {/* Reorder */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button style={{ ...S.btnGhost, padding: '2px 8px' }} disabled={idx === 0} onClick={() => handleMove(cat, 'up')} title="Monter">↑</button>
                  <button style={{ ...S.btnGhost, padding: '2px 8px' }} disabled={idx === cats.length - 1} onClick={() => handleMove(cat, 'down')} title="Descendre">↓</button>
                </div>
              </div>

              {/* Status icone */}
              <div style={{ fontSize: 11, color: cat.icon_url ? '#1F8B4C' : '#9B9B9B' }}>
                {cat.icon_url ? '✓ Icone SVG personnalisee' : 'Pas d\'icone (initiale affichee)'}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <label style={{ ...S.fileLabel, opacity: uploadingId === cat.id ? 0.6 : 1 }}>
                  {uploadingId === cat.id ? 'Upload...' : (cat.icon_url ? 'Remplacer SVG' : 'Uploader SVG')}
                  <input
                    type="file"
                    accept=".svg,image/svg+xml"
                    style={S.fileInput}
                    onChange={(e) => handleUploadSVG(cat, e.target.files?.[0])}
                    disabled={uploadingId === cat.id}
                  />
                </label>
                {cat.icon_url && (
                  <button style={S.btnGhost} onClick={() => handleRemoveSVG(cat)}>Retirer SVG</button>
                )}
                <button style={S.btnBlue} onClick={() => setEditing({ ...cat })}>Modifier</button>
                <button style={S.btnGhost} onClick={() => handleToggleActive(cat)}>
                  {cat.active ? 'Desactiver' : 'Reactiver'}
                </button>
                <button style={S.btnDanger} onClick={() => handleDelete(cat)}>Supprimer</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || showNew) && (
        <CategoryEditor
          cat={editing || { name: '', slug: '', bg_color: '#F4F4F2', text_color: '#1A1A1A', display_order: cats.length + 1, active: true }}
          onClose={() => { setEditing(null); setShowNew(false); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ════════════════ Modal editor ════════════════
function CategoryEditor({ cat, onClose, onSave }) {
  const [form, setForm] = useState(cat);
  const upd = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 500, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 0, marginBottom: 16 }}>
          {cat.id ? 'Modifier la categorie' : 'Nouvelle categorie'}
        </h2>

        <label style={{ fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Nom *</label>
        <input value={form.name} onChange={e => upd('name', e.target.value)} placeholder="Visage" style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />

        <label style={{ fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Slug * (utilise pour filtrer les produits)</label>
        <input value={form.slug} onChange={e => upd('slug', e.target.value)} placeholder="visage" style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />

        <label style={{ fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Couleurs (preview)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: form.bg_color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: form.text_color, fontWeight: 800, fontSize: 20 }}>
            {form.name?.[0] || '?'}
          </div>
          <div style={{ flex: 1, fontSize: 11, color: '#6B6B6B' }}>
            Fond <input type="color" value={form.bg_color} onChange={e => upd('bg_color', e.target.value)} style={{ verticalAlign: 'middle', marginLeft: 4 }} /><br/>
            Texte <input type="color" value={form.text_color} onChange={e => upd('text_color', e.target.value)} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
          </div>
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Presets de couleurs</label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          {CATEGORY_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              title={p.label}
              onClick={() => { upd('bg_color', p.bg); upd('text_color', p.text); }}
              style={{ width: 32, height: 32, borderRadius: 8, background: p.bg, border: form.bg_color === p.bg ? '2px solid #1F8B4C' : '1px solid #EEE', cursor: 'pointer', color: p.text, fontWeight: 800, fontSize: 14, padding: 0 }}
            >Aa</button>
          ))}
        </div>

        <label style={{ fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Ordre d'affichage</label>
        <input type="number" value={form.display_order} onChange={e => upd('display_order', e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 18 }}>
          <input type="checkbox" checked={!!form.active} onChange={e => upd('active', e.target.checked)} />
          Categorie active (visible cote client)
        </label>

        <button onClick={() => onSave(form)} style={{ width: '100%', padding: 12, background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Enregistrer
        </button>
        <button onClick={onClose} style={{ width: '100%', padding: 10, marginTop: 8, background: '#F4F4F2', color: '#1A1A1A', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
