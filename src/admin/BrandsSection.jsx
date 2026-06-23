import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { adminLogAction } from '../lib/adminApi';
import { confirmDialog } from '../lib/toast';

export default function BrandsSection() {
  const [brands, setBrands] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  const [search, setSearch] = useState('');

  useEffect(() => { refresh(); }, []);

  const flash = (text, kind = 'ok') => {
    setMsg({ text, kind });
    setTimeout(() => setMsg({ text: '', kind: '' }), 3000);
  };

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase.from('brands').select('*').order('name');
    setBrands(data || []);
    setLoading(false);
  };

  const handleSave = async (b) => {
    const payload = {
      name: b.name?.trim(),
      country: b.country?.trim() || null,
      city: b.city?.trim() || null,
      img: b.img || null,
      tagline: b.tagline?.trim() || null,
      story: b.story?.trim() || null,
      local: !!b.local,
    };
    if (!payload.name) {
      flash('Le nom est requis', 'err');
      return;
    }
    if (b.id) {
      const { error } = await supabase.from('brands').update(payload).eq('id', b.id);
      if (error) { flash('Erreur : ' + error.message, 'err'); return; }
      adminLogAction({
        action:     'update_brand',
        targetType: 'brand',
        targetId:   b.id,
        before:     null,
        after:      { name: payload.name, country: payload.country, local: payload.local },
      }).catch(() => { /* best-effort */ });
    } else {
      const { error } = await supabase.from('brands').insert(payload);
      if (error) { flash('Erreur : ' + error.message, 'err'); return; }
      adminLogAction({
        action:     'create_brand',
        targetType: 'brand',
        targetId:   null,
        before:     null,
        after:      { name: payload.name, country: payload.country, local: payload.local },
      }).catch(() => { /* best-effort */ });
    }
    flash(b.id ? 'Marque modifiée' : 'Marque créée');
    setEditing(null);
    refresh();
  };

  const handleDelete = async (b) => {
    if (!await confirmDialog(`Supprimer "${b.name}" ?\n\nLes produits de cette marque ne seront pas supprimés.`)) return;
    const { error } = await supabase.from('brands').delete().eq('id', b.id);
    if (error) { flash('Erreur : ' + error.message, 'err'); return; }
    adminLogAction({
      action:     'delete_brand',
      targetType: 'brand',
      targetId:   b.id,
      before:     { name: b.name, country: b.country, local: b.local },
      after:      null,
    }).catch(() => { /* best-effort */ });
    flash('Marque supprimée');
    refresh();
  };

  // ─── Upload logo direct depuis la liste ───
  const handleUploadLogo = async (brand, file) => {
    if (!file) return;
    const allowed = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/jpg'];
    if (!allowed.includes(file.type) && !/\.(svg|png|jpe?g|webp)$/i.test(file.name)) {
      flash('Format non supporté (SVG/PNG/JPG/WebP uniquement)', 'err');
      return;
    }
    if (file.size > 500 * 1024) {
      flash('Logo trop lourd (max 500 KB)', 'err');
      return;
    }

    setUploadingId(brand.id);

    let ext = 'png';
    if (file.type === 'image/svg+xml') ext = 'svg';
    else if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) ext = 'jpg';
    else if (file.type === 'image/webp') ext = 'webp';

    const slug = brand.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const filename = `${slug}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase
      .storage
      .from('brand-logos')
      .upload(filename, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: true,
      });

    if (upErr) {
      setUploadingId(null);
      flash('Upload échoué : ' + upErr.message, 'err');
      return;
    }

    const { data: urlData } = supabase
      .storage
      .from('brand-logos')
      .getPublicUrl(filename);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      setUploadingId(null);
      flash('URL publique non récupérée', 'err');
      return;
    }

    // ⚠️ La colonne s'appelle `img` (pas `logo`) dans ta DB
    const { error: updErr } = await supabase
      .from('brands')
      .update({ img: publicUrl })
      .eq('id', brand.id);

    setUploadingId(null);

    if (updErr) {
      flash('Sauvegarde échouée : ' + updErr.message, 'err');
      return;
    }

    adminLogAction({
      action:     'upload_brand_logo',
      targetType: 'brand',
      targetId:   brand.id,
      before:     null,
      after:      { name: brand.name, logo_filename: filename },
    }).catch(() => { /* best-effort */ });
    flash(`Logo uploadé pour ${brand.name}`);
    refresh();
  };

  const handleRemoveLogo = async (b) => {
    if (!await confirmDialog(`Retirer le logo de "${b.name}" ?`)) return;
    const { error } = await supabase.from('brands').update({ img: null }).eq('id', b.id);
    if (error) { flash('Erreur : ' + error.message, 'err'); return; }
    adminLogAction({
      action:     'remove_brand_logo',
      targetType: 'brand',
      targetId:   b.id,
      before:     { name: b.name, had_logo: true },
      after:      null,
    }).catch(() => { /* best-effort */ });
    flash('Logo retiré');
    refresh();
  };

  const filtered = brands.filter(b => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return b.name?.toLowerCase().includes(s) || b.country?.toLowerCase().includes(s);
  });

  const localCount = brands.filter(b => b.local).length;
  const withLogoCount = brands.filter(b => b.img).length;

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Marques</h1>
          <p>
            {brands.length} marques · {localCount} sénégalaises 🇸🇳 · {withLogoCount} avec logo
          </p>
        </div>
        <button className="adm-btn-pri" onClick={() => setEditing({ name: '', country: '', img: '', story: '', tagline: '', local: false })}>
          + Nouvelle marque
        </button>
      </header>

      {msg.text && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 12,
          background: msg.kind === 'err' ? '#FCE9E7' : '#E8F5EC',
          color: msg.kind === 'err' ? '#D9342B' : '#1F8B4C',
        }}>{msg.text}</div>
      )}

      <input
        type="search"
        placeholder="🔍 Rechercher une marque..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: 10,
          borderRadius: 8,
          border: '1px solid #DDD',
          fontSize: 14,
          marginBottom: 14,
          boxSizing: 'border-box',
          fontFamily: 'inherit',
        }}
      />

      {editing && (
        <div className="adm-form-overlay" onClick={() => setEditing(null)}>
          <div className="adm-form-card" onClick={e => e.stopPropagation()}>
            <h3>{editing.id ? 'Modifier' : 'Nouvelle'} marque</h3>

            {editing.img && (
              <div style={{
                margin: '8px 0 16px',
                padding: 14,
                background: '#F4F4F2',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <img src={editing.img} alt="" style={{
                  width: 60, height: 60, borderRadius: 8, objectFit: 'contain', background: 'white', padding: 4,
                }} />
                <div style={{ flex: 1, fontSize: 12, color: '#6B6B6B', wordBreak: 'break-all' }}>
                  Logo actuel
                </div>
                <button
                  type="button"
                  className="adm-btn-sec"
                  onClick={() => setEditing({ ...editing, img: '' })}
                  style={{ fontSize: 11 }}
                >
                  🗑️ Retirer
                </button>
              </div>
            )}

            <label>Nom *<input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Bioderma" /></label>
            <label>Pays<input value={editing.country || ''} onChange={e => setEditing({ ...editing, country: e.target.value })} placeholder="Sénégal, France, Corée..." /></label>
            <label>Ville<input value={editing.city || ''} onChange={e => setEditing({ ...editing, city: e.target.value })} placeholder="Dakar, Paris..." /></label>

            <label>Logo URL (optionnel — sinon utilise l'upload depuis la liste)
              <input value={editing.img || ''} onChange={e => setEditing({ ...editing, img: e.target.value })} placeholder="https://... ou laisse vide" />
            </label>

            <label>Tagline (petite phrase d'accroche)<input value={editing.tagline || ''} onChange={e => setEditing({ ...editing, tagline: e.target.value })} placeholder="Made in Sénégal · Naturel" /></label>

            <label>Histoire / Description<textarea value={editing.story || ''} onChange={e => setEditing({ ...editing, story: e.target.value })} rows={3} /></label>

            <label className="adm-form-checkbox">
              <input type="checkbox" checked={!!editing.local} onChange={e => setEditing({ ...editing, local: e.target.checked })} />
              <span>🇸🇳 Marque locale (Made in Sénégal)</span>
            </label>

            <div className="adm-form-actions">
              <button className="adm-btn-sec" onClick={() => setEditing(null)}>Annuler</button>
              <button className="adm-btn-pri" onClick={() => handleSave(editing)}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          {search ? `Aucune marque ne correspond à "${search}"` : 'Aucune marque'}
        </div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Logo</th>
              <th>Marque</th>
              <th>Pays</th>
              <th>Type</th>
              <th>Logo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id}>
                <td style={{ width: 60 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 8,
                    background: '#F4F4F2', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {b.img ? (
                      <img
                        src={b.img}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, boxSizing: 'border-box' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <span style={{ fontSize: 18, fontWeight: 800, color: '#6B6B6B' }}>
                        {b.name?.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <strong>{b.name}</strong>
                  {b.tagline && (
                    <div style={{ fontSize: 11, color: '#6B6B6B', marginTop: 2 }}>{b.tagline}</div>
                  )}
                </td>
                <td>{b.country || '—'}</td>
                <td>
                  {b.local
                    ? <span className="adm-badge good">🇸🇳 Locale</span>
                    : <span className="adm-badge">International</span>}
                </td>
                <td>
                  <label style={{
                    display: 'inline-block',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: b.img ? '#F4F4F2' : '#1F8B4C',
                    color: b.img ? '#1A1A1A' : 'white',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    opacity: uploadingId === b.id ? 0.6 : 1,
                    fontFamily: 'inherit',
                  }}>
                    {uploadingId === b.id ? '⏳ Upload...' : (b.img ? '🔄 Remplacer' : '📤 Uploader')}
                    <input
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={(e) => handleUploadLogo(b, e.target.files?.[0])}
                      disabled={uploadingId === b.id}
                    />
                  </label>
                  {b.img && (
                    <button
                      className="adm-btn-sec"
                      onClick={() => handleRemoveLogo(b)}
                      style={{ marginLeft: 4, fontSize: 11 }}
                      title="Retirer le logo"
                    >🗑️</button>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="adm-btn-sec" onClick={() => setEditing(b)}>✏️</button>
                  <button className="adm-btn-danger" onClick={() => handleDelete(b)} style={{ marginLeft: 4 }}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}