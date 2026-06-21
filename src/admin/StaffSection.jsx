import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { adminListStaff, adminUpsertStaff, adminDeleteStaff, adminLogAction } from '../lib/adminApi';
import { confirmDialog } from '../lib/toast';

const ROLES = [
  { id: 'super_admin', label: 'Super Admin', desc: 'Accès total YARAM' },
  { id: 'admin', label: 'Admin', desc: 'Gestion commandes, produits' },
  { id: 'staff', label: 'Staff pharmacie', desc: 'Gestion stock de sa pharmacie' },
  { id: 'delivery', label: 'Livreur', desc: 'Mise à jour livraisons' },
];

export default function StaffSection() {
  const [staff, setStaff] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    const [sRes, pRes] = await Promise.all([
      adminListStaff(),
      supabase.from('pharmacies').select('id, name'),
    ]);
    setStaff(sRes.data || []);
    setPharmacies(pRes.data || []);
    setLoading(false);
  };

  const handleSave = async (st) => {
    const payload = {
      name: st.name, email: st.email || null, phone: st.phone,
      role: st.role, pharmacy_id: st.pharmacy_id || null, active: st.active,
    };
    const prev = st.id ? staff.find(x => x.id === st.id) : null;
    adminLogAction({
      action:     st.id ? 'update_staff' : 'create_staff',
      targetType: 'staff',
      targetId:   st.id || null,
      before:     prev ? { role: prev.role, active: prev.active, name: prev.name } : null,
      after:      { role: payload.role, active: payload.active, name: payload.name },
    }).catch(() => { /* best-effort */ });
    await adminUpsertStaff(st.id || null, payload);
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id) => {
    if (!await confirmDialog('Retirer ce membre ?')) return;
    const prev = staff.find(x => x.id === id);
    adminLogAction({
      action:     'delete_staff',
      targetType: 'staff',
      targetId:   id,
      before:     prev ? { name: prev.name, role: prev.role, active: prev.active } : null,
      after:      null,
    }).catch(() => { /* best-effort */ });
    await adminDeleteStaff(id);
    refresh();
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Équipe</h1>
          <p>{staff.length} membres · {staff.filter(s => s.active).length} actifs</p>
        </div>
        <button className="adm-btn-pri" onClick={() => setEditing({
          name: '', email: '', phone: '', role: 'staff', pharmacy_id: '', active: true,
        })}>+ Ajouter</button>
      </header>

      {editing && (
        <div className="adm-form-overlay" onClick={() => setEditing(null)}>
          <div className="adm-form-card" onClick={e => e.stopPropagation()}>
            <h3>{editing.id ? 'Modifier' : 'Nouveau'} membre</h3>
            <label>Nom complet<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>Email<input value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} placeholder="contact@..." /></label>
            <label>Téléphone<input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></label>
            <label>Rôle<select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}>
              {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select></label>
            {editing.role === 'staff' && (
              <label>Pharmacie<select value={editing.pharmacy_id} onChange={e => setEditing({ ...editing, pharmacy_id: e.target.value })}>
                <option value="">— Aucune —</option>
                {pharmacies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            )}
            <label className="adm-form-checkbox">
              <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              <span>Membre actif</span>
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
      ) : staff.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>👷</div>
          <p>Aucun membre dans l'équipe</p>
        </div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Membre</th>
              <th>Rôle</th>
              <th>Pharmacie</th>
              <th>Contact</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => {
              const ph = pharmacies.find(p => p.id === s.pharmacy_id);
              const role = ROLES.find(r => r.id === s.role);
              return (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>{role?.label || s.role}</td>
                  <td>{ph?.name || '—'}</td>
                  <td>
                    {s.email && <div>{s.email}</div>}
                    {s.phone && <div style={{ fontSize: 11, color: '#6B6B6B' }}>{s.phone}</div>}
                  </td>
                  <td><span className={`adm-badge ${s.active ? 'good' : 'bad'}`}>{s.active ? 'Actif' : 'Inactif'}</span></td>
                  <td>
                    <button className="adm-btn-sec" onClick={() => setEditing(s)}>✏️</button>
                    <button className="adm-btn-danger" onClick={() => handleDelete(s.id)} style={{ marginLeft: 4 }}>🗑️</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
