// ═══════════════════════════════════════════════════════════════
// Admin — Demandes Boutique Internationale (depuis client)
// ═══════════════════════════════════════════════════════════════
//
// Liste les demandes envoyées via le formulaire client de la page
// Boutique Internationale. Statuts gérables :
//   new → contacted → ordered → done   (ou → refused à tout moment)
//
// Source de vérité : table intl_requests via RPC admin (token requis).
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getAdminToken } from '../lib/adminAuth';
import { toast, confirmDialog } from '../lib/toast';

const STATUS_OPTIONS = [
  { id: 'new',       label: '🆕 Nouvelle',    color: '#1F8B4C' },
  { id: 'contacted', label: '📞 Contactée',   color: '#F4B53A' },
  { id: 'ordered',   label: '🛒 Commandée',   color: '#0066CC' },
  { id: 'done',      label: '✅ Livrée',      color: '#0E5B33' },
  { id: 'refused',   label: '❌ Refusée',     color: '#D9342B' },
];

export default function IntlRequestsSection() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const token = getAdminToken();
    if (!token) {
      toast.error('Session admin requise');
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('admin_list_intl_requests', {
      p_token: token,
      p_status: filter === 'all' ? null : filter,
    });
    if (error) toast.error('Erreur : ' + error.message);
    setRequests(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return requests;
    const q = search.toLowerCase();
    return requests.filter(r =>
      (r.brand || '').toLowerCase().includes(q) ||
      (r.product || '').toLowerCase().includes(q) ||
      (r.phone || '').toLowerCase().includes(q) ||
      (r.user_email || '').toLowerCase().includes(q)
    );
  }, [requests, search]);

  const counts = useMemo(() => {
    const c = { all: requests.length };
    STATUS_OPTIONS.forEach(s => c[s.id] = 0);
    requests.forEach(r => { if (c[r.status] != null) c[r.status]++; });
    return c;
  }, [requests]);

  const updateStatus = async (id, status) => {
    const token = getAdminToken();
    const { data, error } = await supabase.rpc('admin_update_intl_request', {
      p_token: token, p_id: id, p_status: status,
    });
    if (error || !data?.success) {
      toast.error('Échec : ' + (error?.message || data?.error || 'inconnu'));
      return;
    }
    toast.success('Statut mis à jour');
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>🌍 Demandes Boutique Internationale</h1>
          <p>Les demandes des clients pour des produits à importer</p>
        </div>
        <button className="adm-btn-sec" onClick={load}>🔄 Rafraîchir</button>
      </header>

      {/* Filtres status */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => setFilter('all')} style={chipStyle(filter === 'all', '#666')}>
          Toutes ({counts.all})
        </button>
        {STATUS_OPTIONS.map(s => (
          <button key={s.id}
            onClick={() => setFilter(s.id)}
            style={chipStyle(filter === s.id, s.color)}
          >
            {s.label} {counts[s.id] > 0 && `(${counts[s.id]})`}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Rechercher marque, produit, téléphone, email…"
        style={{
          width: '100%', padding: 12, fontSize: 14, marginBottom: 16,
          border: '1px solid #DDD', borderRadius: 10, boxSizing: 'border-box',
        }}
      />

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
          {search ? 'Aucun résultat' : 'Aucune demande pour ce filtre'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => (
            <div key={r.id} style={{
              background: 'white', borderRadius: 14, padding: 16,
              border: '1px solid #EFEFEF', boxShadow: '0 2px 8px rgba(14,91,51,0.04)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1F8B4C', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>
                    {r.brand}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0E5B33', lineHeight: 1.3 }}>
                    {r.product}
                  </div>
                </div>
                <select
                  value={r.status}
                  onChange={e => updateStatus(r.id, e.target.value)}
                  style={{
                    padding: '6px 8px', fontSize: 12, fontWeight: 700,
                    borderRadius: 999,
                    border: `1.5px solid ${STATUS_OPTIONS.find(s => s.id === r.status)?.color || '#666'}`,
                    color: STATUS_OPTIONS.find(s => s.id === r.status)?.color || '#666',
                    background: 'white', cursor: 'pointer',
                  }}
                >
                  {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: 12, color: '#555' }}>
                {r.budget && (
                  <div>
                    <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Budget</div>
                    <div style={{ fontWeight: 700, color: '#0E5B33' }}>{Number(r.budget).toLocaleString('fr-FR')} FCFA</div>
                  </div>
                )}
                {r.phone && (
                  <div>
                    <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>WhatsApp</div>
                    <a href={`https://wa.me/${String(r.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                      style={{ fontWeight: 700, color: '#1F8B4C', textDecoration: 'none' }}>
                      📞 {r.phone}
                    </a>
                  </div>
                )}
                {r.user_email && (
                  <div>
                    <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Email</div>
                    <a href={`mailto:${r.user_email}`}
                      style={{ fontWeight: 700, color: '#1F8B4C', textDecoration: 'none' }}>
                      ✉️ {r.user_email}
                    </a>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: '#999' }}>
                Reçue le {new Date(r.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function chipStyle(active, color) {
  return {
    padding: '8px 14px',
    background: active ? color : '#F4F4F2',
    color: active ? 'white' : '#333',
    border: 'none', borderRadius: 999,
    fontSize: 13, fontWeight: active ? 800 : 600,
    cursor: 'pointer',
  };
}
