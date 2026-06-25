// ════════════════════════════════════════════════════════════════════
// YARAM — Section Distributeurs (admin)
// ════════════════════════════════════════════════════════════════════
// Liste les distributeurs partenaires, permet d'en créer/éditer/supprimer
// un, et d'ouvrir leur dashboard détaillé (Bonfoni, etc.).
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { getAllBrands } from '../lib/supabase';
import { adminLogAction } from '../lib/adminApi';
import { toast, confirmDialog } from '../lib/toast';
import {
  listDistributors,
  createDistributor,
  updateDistributor,
  deleteDistributor,
  uploadDistributorLogo,
  generateDashboardToken,
  getBrandAnalytics,
} from '../lib/distributorsApi';
import DistributorDashboard from './DistributorDashboard';

export default function DistributorsSection() {
  const [list, setList] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [statsByDistId, setStatsByDistId] = useState({}); // {id: orders}

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [distributors, allBrands] = await Promise.all([
        listDistributors(),
        getAllBrands(),
      ]);
      setList(distributors);
      setBrands(allBrands);
      // Charge stats commandes 30j par distributeur (best-effort)
      const statsEntries = await Promise.all(
        distributors.map(async d => {
          try {
            const a = await getBrandAnalytics(d.brands || [], 30);
            const orders = a.reduce((s, x) => s + (Number(x.total_orders) || 0), 0);
            return [d.id, orders];
          } catch { return [d.id, 0]; }
        })
      );
      setStatsByDistId(Object.fromEntries(statsEntries));
    } catch (e) {
      console.error('[Distributors] refresh', e);
      toast.error('Erreur de chargement : ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (payload) => {
    try {
      if (payload.id) {
        const { id, ...patch } = payload;
        await updateDistributor(id, patch);
        adminLogAction({
          action: 'update_distributor',
          targetType: 'distributor',
          targetId: id,
          before: null,
          after: { name: patch.name, brands: (patch.brands || []).length },
        }).catch(() => {});
        toast.success('Distributeur mis à jour');
      } else {
        const created = await createDistributor(payload);
        adminLogAction({
          action: 'create_distributor',
          targetType: 'distributor',
          targetId: created?.id,
          before: null,
          after: { name: payload.name },
        }).catch(() => {});
        toast.success('Distributeur créé');
      }
      setEditing(null);
      setShowForm(false);
      refresh();
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || ''));
    }
  };

  const handleDelete = async (d) => {
    if (!await confirmDialog(`Supprimer définitivement ${d.name} ?`)) return;
    try {
      await deleteDistributor(d.id);
      adminLogAction({
        action: 'delete_distributor',
        targetType: 'distributor',
        targetId: d.id,
        before: { name: d.name },
        after: null,
      }).catch(() => {});
      toast.success('Distributeur supprimé');
      refresh();
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || ''));
    }
  };

  const brandsMap = Object.fromEntries(brands.map(b => [b.id, b]));

  // ─── Vue Dashboard (si openId set) ──────────────────────────────
  if (openId) {
    const d = list.find(x => x.id === openId);
    if (!d) return null;
    return <DistributorDashboard distributor={d} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Distributeurs partenaires</h1>
          <p>
            {list.length} distributeur{list.length > 1 ? 's' : ''}
            {' · '}
            {list.filter(d => d.active).length} actif{list.filter(d => d.active).length > 1 ? 's' : ''}
          </p>
        </div>
        <button className="adm-btn-pri" onClick={() => { setEditing({}); setShowForm(true); }}>
          ➕ Ajouter un distributeur
        </button>
      </header>

      {showForm && editing && (
        <DistributorForm
          distributor={editing}
          brands={brands}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : list.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>🏭</div>
          <p>Aucun distributeur. Ajoute Bonfoni et autres partenaires pour piloter le pitch.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
          {list.map(d => (
            <div key={d.id} className="adm-recent-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                {d.logo_url ? (
                  <img src={d.logo_url} alt={d.name} style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: '1px solid #EEE' }} />
                ) : (
                  <div style={{
                    width: 52, height: 52, borderRadius: 10,
                    background: 'linear-gradient(135deg, #1F8B4C, #166635)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 22,
                  }}>{(d.name || '?')[0]}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{d.name}</strong>
                    {d.active
                      ? <span className="adm-badge excellent">✓ Actif</span>
                      : <span className="adm-badge bad">Inactif</span>}
                  </div>
                  {d.contact_person && (
                    <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 2 }}>
                      👤 {d.contact_person}{d.contact_phone ? ` · ${d.contact_phone}` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* Brands */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#6B6B6B', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                  Marques · {(d.brands || []).length}
                </div>
                <div>
                  {(d.brands || []).slice(0, 6).map(bid => (
                    <span key={bid} style={{
                      display: 'inline-block', padding: '2px 8px',
                      background: '#EAF5EE', color: '#166635',
                      borderRadius: 999, fontSize: 11, fontWeight: 600,
                      margin: '2px 4px 2px 0',
                    }}>{brandsMap[bid]?.name || '…'}</span>
                  ))}
                  {(d.brands || []).length > 6 && (
                    <span style={{ fontSize: 11, color: '#6B6B6B' }}>+{d.brands.length - 6}</span>
                  )}
                </div>
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 0', marginBottom: 8,
                borderTop: '1px solid #F4F4F2', borderBottom: '1px solid #F4F4F2',
                fontSize: 12, color: '#6B6B6B',
              }}>
                <div>📦 <strong>{statsByDistId[d.id] || 0}</strong> commandes (30j)</div>
                {d.dashboard_token && (
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/admin/distributor-view?token=${d.dashboard_token}`;
                      navigator.clipboard?.writeText(url);
                      toast.success('Lien dashboard copié');
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#1F8B4C', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >🔗 Copier lien</button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="adm-btn-pri"
                  style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}
                  onClick={() => setOpenId(d.id)}
                >📊 Voir dashboard</button>
                <button
                  className="adm-btn-sec"
                  onClick={() => { setEditing(d); setShowForm(true); }}
                  style={{ fontSize: 13 }}
                >✏️ Éditer</button>
                <button
                  className="adm-btn-sec"
                  onClick={() => handleDelete(d)}
                  style={{ fontSize: 13, color: '#D9342B' }}
                >🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════════════
function DistributorForm({ distributor, brands, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: distributor.id || null,
    name: distributor.name || '',
    contact_person: distributor.contact_person || '',
    contact_email: distributor.contact_email || '',
    contact_phone: distributor.contact_phone || '',
    rccm: distributor.rccm || '',
    address: distributor.address || '',
    logo_url: distributor.logo_url || '',
    brands: distributor.brands || [],
    active: distributor.active ?? true,
    dashboard_token: distributor.dashboard_token || '',
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brandFilter, setBrandFilter] = useState('');

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadDistributorLogo(file);
      setForm(f => ({ ...f, logo_url: url }));
      toast.success('Logo uploadé');
    } catch (err) {
      toast.error('Upload échoué : ' + (err?.message || ''));
    } finally {
      setUploading(false);
    }
  };

  const toggleBrand = (bid) => {
    setForm(f => ({
      ...f,
      brands: f.brands.includes(bid)
        ? f.brands.filter(x => x !== bid)
        : [...f.brands, bid],
    }));
  };

  const handleGenerateToken = () => {
    const token = generateDashboardToken();
    setForm(f => ({ ...f, dashboard_token: token }));
    toast.success('Nouveau token généré');
  };

  const copyDashboardLink = () => {
    if (!form.dashboard_token) {
      toast.error('Aucun token. Génère-en un d\'abord.');
      return;
    }
    const url = `${window.location.origin}/admin/distributor-view?token=${form.dashboard_token}`;
    navigator.clipboard?.writeText(url);
    toast.success('Lien copié !');
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error('Nom requis'); return; }
    setSaving(true);
    const payload = { ...form };
    // Si on crée et pas de token → on en génère un automatiquement
    if (!payload.id && !payload.dashboard_token) {
      payload.dashboard_token = generateDashboardToken();
    }
    await onSave(payload);
    setSaving(false);
  };

  const filteredBrands = brands.filter(b =>
    !brandFilter || (b.name || '').toLowerCase().includes(brandFilter.toLowerCase())
  );

  return (
    <div className="adm-form-overlay" onClick={onCancel}>
      <div className="adm-form-card" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '92vh', overflowY: 'auto' }}>
        <h3>{form.id ? `✏️ Modifier ${form.name}` : '🏭 Nouveau distributeur'}</h3>

        <label>Nom * <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex : Bonfoni SN Suarl" /></label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label>Contact (personne)
            <input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} placeholder="Ex : Birane FALL" />
          </label>
          <label>Téléphone
            <input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} placeholder="+221 77 ..." />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label>Email
            <input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} placeholder="contact@..." />
          </label>
          <label>RCCM
            <input value={form.rccm} onChange={e => setForm({ ...form, rccm: e.target.value })} placeholder="Optionnel" />
          </label>
        </div>

        <label>Adresse
          <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Sacré-Cœur, Dakar..." />
        </label>

        <label>📷 Logo distributeur (optionnel)
          <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} />
        </label>
        {uploading && <p style={{ fontSize: 11, color: '#F4B53A' }}>⏳ Upload en cours…</p>}
        {form.logo_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <img src={form.logo_url} alt="logo" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #EEE' }} />
            <button className="adm-btn-sec" onClick={() => setForm({ ...form, logo_url: '' })} style={{ fontSize: 11 }}>🗑️ Retirer</button>
          </div>
        )}

        {/* ─── Multi-select marques ─── */}
        <label style={{ display: 'block' }}>
          Marques distribuées · {form.brands.length} sélectionnée{form.brands.length > 1 ? 's' : ''}
          <input
            value={brandFilter}
            onChange={e => setBrandFilter(e.target.value)}
            placeholder="🔍 Filtrer..."
            style={{ marginTop: 4 }}
          />
        </label>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 6,
          maxHeight: 200,
          overflowY: 'auto',
          padding: 8,
          border: '1px solid #EEE',
          borderRadius: 8,
          marginBottom: 12,
        }}>
          {filteredBrands.map(b => (
            <label key={b.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              background: form.brands.includes(b.id) ? '#EAF5EE' : 'transparent',
              fontSize: 12,
            }}>
              <input
                type="checkbox"
                checked={form.brands.includes(b.id)}
                onChange={() => toggleBrand(b.id)}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
            </label>
          ))}
          {filteredBrands.length === 0 && (
            <p style={{ fontSize: 11, color: '#999', gridColumn: '1 / -1', textAlign: 'center' }}>Aucune marque.</p>
          )}
        </div>

        {/* ─── Token Dashboard ─── */}
        <div style={{
          padding: 12,
          background: '#F8FAF7',
          border: '1px solid #E5EFE8',
          borderRadius: 10,
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🔐 Lien dashboard public (sans login)</div>
          {form.dashboard_token ? (
            <>
              <code style={{
                display: 'block',
                padding: 8,
                background: 'white',
                border: '1px solid #EEE',
                borderRadius: 6,
                fontSize: 11,
                wordBreak: 'break-all',
                marginBottom: 6,
              }}>
                {typeof window !== 'undefined' ? window.location.origin : ''}/admin/distributor-view?token={form.dashboard_token}
              </code>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="adm-btn-sec" onClick={copyDashboardLink} style={{ fontSize: 12 }}>📋 Copier</button>
                <button className="adm-btn-sec" onClick={handleGenerateToken} style={{ fontSize: 12 }}>🔄 Régénérer</button>
              </div>
            </>
          ) : (
            <button className="adm-btn-sec" onClick={handleGenerateToken}>🔑 Générer un token d'accès dashboard</button>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />
          <span>Actif (le distributeur peut accéder au dashboard via son lien)</span>
        </label>

        <div className="adm-form-actions">
          <button className="adm-btn-sec" onClick={onCancel}>Annuler</button>
          <button className="adm-btn-pri" onClick={handleSubmit} disabled={saving || uploading}>
            {saving ? 'Enregistrement…' : '💾 Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  );
}
