import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getAdminToken } from '../lib/adminAuth';
import { adminLogAction } from '../lib/adminApi';
import { confirmDialog } from '../lib/toast';

// ⚠️ Doit etre aligne avec validatePromoCode dans src/lib/supabase.js qui lit la table 'promo_codes'.
// Auparavant cette page lisait la table 'promos' qui n'etait pas branchee au checkout.
// Champs alignes : code, type ('percent'|'fixed'|'free_shipping'), value, min_order,
//                  max_uses, uses_count, expires_at, starts_at, per_user_limit, active.

export default function PromosSection() {
  const [promos, setPromos] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    const token = getAdminToken();
    if (!token) { setErrMsg('Session admin expirée'); setLoading(false); return; }
    const { data, error } = await supabase.rpc('admin_list_promos', { p_token: token });
    if (error) setErrMsg('Erreur lecture promos : ' + error.message);
    setPromos(data || []);
    setLoading(false);
  };

  const handleSave = async (p) => {
    setErrMsg('');
    if (!p.code?.trim()) { setErrMsg('Le code est obligatoire'); return; }
    const value = parseFloat(p.value);
    if (Number.isNaN(value) || value < 0) { setErrMsg('Valeur invalide'); return; }

    const token = getAdminToken();
    if (!token) { setErrMsg('Session admin expirée'); return; }

    const payload = {
      code: p.code.trim().toUpperCase(),
      type: p.type, // percent | fixed | free_shipping
      value,
      min_order: parseFloat(p.min_order) || 0,
      max_uses: p.max_uses || null,
      per_user_limit: p.per_user_limit || null,
      active: !!p.active,
      expires_at: p.expires_at || null,
      starts_at: p.starts_at || null,
    };
    const { error } = await supabase.rpc('admin_upsert_promo', {
      p_token: token,
      p_id: p.id || null,
      p_payload: payload,
    });
    if (error) { setErrMsg('Erreur sauvegarde : ' + error.message); return; }
    adminLogAction({
      action:     p.id ? 'update_promo' : 'create_promo',
      targetType: 'promo_code',
      targetId:   p.id || null,
      before:     null,
      after:      { code: payload.code, type: payload.type, value: payload.value, active: payload.active },
    }).catch(() => { /* best-effort */ });
    setEditing(null);
    refresh();
  };

  const handleDelete = async (id) => {
    if (!(await confirmDialog('Supprimer ce code promo ?', { confirmLabel: 'Supprimer', danger: true }))) return;
    const token = getAdminToken();
    if (!token) { setErrMsg('Session admin expirée'); return; }
    const prev = promos.find(p => p.id === id);
    const { error } = await supabase.rpc('admin_delete_promo', { p_token: token, p_id: id });
    if (error) { setErrMsg('Erreur suppression : ' + error.message); return; }
    adminLogAction({
      action:     'delete_promo',
      targetType: 'promo_code',
      targetId:   id,
      before:     prev ? { code: prev.code, type: prev.type, value: prev.value } : null,
      after:      null,
    }).catch(() => { /* best-effort */ });
    refresh();
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Codes promo</h1>
          <p>{promos.length} codes · {promos.filter(p => p.active).length} actifs · table <code>promo_codes</code></p>
        </div>
        <button className="adm-btn-pri" onClick={() => setEditing({
          code: '', type: 'percent', value: 10, min_order: 0,
          max_uses: 100, per_user_limit: 1, active: true, expires_at: '', starts_at: '',
        })}>+ Nouveau code</button>
      </header>

      {errMsg && (
        <div style={{ background: '#FCE9E7', color: '#D9342B', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          ⚠️ {errMsg}
        </div>
      )}

      {editing && (
        <div className="adm-form-overlay" onClick={() => setEditing(null)}>
          <div className="adm-form-card" onClick={e => e.stopPropagation()}>
            <h3>{editing.id ? 'Modifier' : 'Nouveau'} code</h3>
            <label>Code (UPPERCASE)<input value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" /></label>
            <label>Type<select value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value })}>
              <option value="percent">Pourcentage (%)</option>
              <option value="fixed">Montant fixe (FCFA)</option>
              <option value="free_shipping">Livraison offerte</option>
            </select></label>
            <label>Valeur<input type="number" value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value })} placeholder={editing.type === 'free_shipping' ? '0 (ignore)' : ''} /></label>
            <label>Commande minimum (FCFA)<input type="number" value={editing.min_order} onChange={e => setEditing({ ...editing, min_order: e.target.value })} placeholder="0 = pas de minimum" /></label>
            <label>Max utilisations totales<input type="number" value={editing.max_uses ?? ''} onChange={e => setEditing({ ...editing, max_uses: e.target.value })} placeholder="Vide = illimité" /></label>
            <label>Limite par utilisatrice<input type="number" value={editing.per_user_limit ?? ''} onChange={e => setEditing({ ...editing, per_user_limit: e.target.value })} placeholder="Vide = illimité (ex: 1)" /></label>
            <label>Démarre le (optionnel)<input type="date" value={editing.starts_at?.slice(0, 10) || ''} onChange={e => setEditing({ ...editing, starts_at: e.target.value })} /></label>
            <label>Expire le<input type="date" value={editing.expires_at?.slice(0, 10) || ''} onChange={e => setEditing({ ...editing, expires_at: e.target.value })} /></label>
            <label className="adm-form-checkbox">
              <input type="checkbox" checked={!!editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} />
              <span>Code actif</span>
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
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Réduction</th>
              <th>Min</th>
              <th>Utilisations</th>
              <th>Par cliente</th>
              <th>Expire</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promos.map(p => (
              <tr key={p.id}>
                <td><code style={{ fontSize: 13, fontWeight: 700 }}>{p.code}</code></td>
                <td>
                  <strong style={{ color: '#1F8B4C' }}>
                    {p.type === 'percent' && `-${p.value}%`}
                    {p.type === 'fixed' && `-${(p.value || 0).toLocaleString('fr-FR')} FCFA`}
                    {p.type === 'free_shipping' && '🚚 Livraison'}
                  </strong>
                </td>
                <td>{p.min_order > 0 ? `${p.min_order.toLocaleString('fr-FR')} FCFA` : '—'}</td>
                <td>{p.uses_count || 0}{p.max_uses ? ` / ${p.max_uses}` : ''}</td>
                <td>{p.per_user_limit || '∞'}</td>
                <td>{p.expires_at ? new Date(p.expires_at).toLocaleDateString('fr-FR') : 'Jamais'}</td>
                <td><span className={`adm-badge ${p.active ? 'good' : 'bad'}`}>{p.active ? 'Actif' : 'Inactif'}</span></td>
                <td>
                  <button className="adm-btn-sec" onClick={() => setEditing(p)}>✏️</button>
                  <button className="adm-btn-danger" onClick={() => handleDelete(p.id)} style={{ marginLeft: 4 }}>🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
