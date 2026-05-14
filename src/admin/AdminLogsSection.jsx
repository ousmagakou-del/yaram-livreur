import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { exportCSV, fmtDateTime } from '../lib/exports';

const ACTION_LABELS = {
  login:               { label: 'Connexion',          color: '#1F8B4C', icon: '🔓' },
  logout:              { label: 'Déconnexion',        color: '#6B6B6B', icon: '🔒' },
  pin_changed:         { label: 'PIN changé',         color: '#A07700', icon: '🔑' },
  create_admin:        { label: 'Admin créé',         color: '#1F8B4C', icon: '➕' },
  deactivate_admin:    { label: 'Admin désactivé',    color: '#D9342B', icon: '🚫' },
  reactivate_admin:    { label: 'Admin réactivé',     color: '#1F8B4C', icon: '↩️' },
  reset_admin_pin:     { label: 'PIN réinitialisé',   color: '#A07700', icon: '🔄' },
  change_admin_role:   { label: 'Rôle changé',        color: '#A07700', icon: '🎭' },
};

export default function AdminLogsSection() {
  const [logs, setLogs] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adminFilter, setAdminFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [period, setPeriod] = useState('30d');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [logsRes, adminsRes] = await Promise.all([
        supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('admin_users').select('id, email, name'),
      ]);
      setLogs(logsRes.data || []);
      setAdmins(adminsRes.data || []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = logs;
    if (adminFilter !== 'all') list = list.filter(l => l.admin_id === adminFilter);
    if (actionFilter !== 'all') list = list.filter(l => l.action === actionFilter);
    if (period !== 'all') {
      const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      list = list.filter(l => new Date(l.created_at).getTime() >= cutoff);
    }
    return list;
  }, [logs, adminFilter, actionFilter, period]);

  const allActions = useMemo(() => {
    const set = new Set(logs.map(l => l.action).filter(Boolean));
    return Array.from(set);
  }, [logs]);

  const handleExport = (format) => {
    const rows = filtered.map(l => ({
      date: fmtDateTime(l.created_at),
      admin: l.admin_email,
      action: ACTION_LABELS[l.action]?.label || l.action,
      target_type: l.target_type || '',
      target_id: l.target_id || '',
      details: l.details ? JSON.stringify(l.details) : '',
    }));
    const headers = [
      { key: 'date', label: 'Date' },
      { key: 'admin', label: 'Admin' },
      { key: 'action', label: 'Action' },
      { key: 'target_type', label: 'Type cible' },
      { key: 'target_id', label: 'ID cible' },
      { key: 'details', label: 'Détails' },
    ];
    const today = new Date().toISOString().slice(0, 10);
    exportCSV(rows, headers, `yaram-logs-admin-${today}.csv`, { format });
  };

  const S = {
    section: { padding: 24 },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: '#6B6B6B', fontSize: 13, marginTop: 4 },
    filters: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: 16, alignItems: 'center' },
    pill: { padding: '7px 14px', borderRadius: 999, border: '1px solid #DDD', background: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    pillActive: { background: '#1F8B4C', color: 'white', borderColor: '#1F8B4C' },
    select: { padding: '7px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 13, fontFamily: 'inherit' },
    btnPrimary: { padding: '8px 14px', borderRadius: 10, background: '#1F8B4C', color: 'white', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    btnOutline: { padding: '8px 14px', borderRadius: 10, background: 'white', color: '#1F8B4C', border: '1.5px solid #1F8B4C', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    card: { background: 'white', borderRadius: 14, border: '1px solid #EEE', padding: 20, marginTop: 4 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '10px 8px', background: '#F9FAFB', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', borderBottom: '1px solid #EEE' },
    td: { padding: '10px 8px', borderBottom: '1px solid #F4F4F2' },
    badge: (color) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color, background: color + '20' }),
  };

  return (
    <div style={S.section}>
      <h1 style={S.h1}>📜 Logs activité admin</h1>
      <p style={S.sub}>
        Audit trail : qui a fait quoi, quand. Limité aux 500 derniers logs.
      </p>

      <div style={S.filters}>
        {[['24h','24h'],['7d','7j'],['30d','30j'],['90d','90j'],['all','Tout']].map(([k, label]) => (
          <button
            key={k}
            style={{ ...S.pill, ...(period === k ? S.pillActive : {}) }}
            onClick={() => setPeriod(k)}
          >
            {label}
          </button>
        ))}

        <select style={S.select} value={adminFilter} onChange={e => setAdminFilter(e.target.value)}>
          <option value="all">Tous les admins</option>
          {admins.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
        </select>

        <select style={S.select} value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
          <option value="all">Toutes actions</option>
          {allActions.map(a => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]?.label || a}
            </option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={S.btnPrimary} onClick={() => handleExport('excel-fr')}>📊 Export Excel FR</button>
          <button style={S.btnOutline} onClick={() => handleExport('standard')}>📄 CSV</button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement…</p>
      ) : (
        <div style={S.card}>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#6B6B6B' }}>
            {filtered.length} log{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Admin</th>
                  <th style={S.th}>Action</th>
                  <th style={S.th}>Cible</th>
                  <th style={S.th}>Détails</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#9B9B9B', padding: 30 }}>Aucun log pour cette période</td></tr>
                ) : filtered.map(l => {
                  const a = ACTION_LABELS[l.action] || { label: l.action, color: '#6B6B6B', icon: '•' };
                  return (
                    <tr key={l.id}>
                      <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(l.created_at)}</td>
                      <td style={S.td}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{l.admin_email}</div>
                      </td>
                      <td style={S.td}>
                        <span style={S.badge(a.color)}>{a.icon} {a.label}</span>
                      </td>
                      <td style={{ ...S.td, fontSize: 12, color: '#6B6B6B' }}>
                        {l.target_type ? (
                          <>
                            <strong>{l.target_type}</strong>
                            {l.target_id && <span style={{ marginLeft: 4 }}>#{l.target_id.slice(0, 8)}</span>}
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: '#6B6B6B', maxWidth: 300 }}>
                        {l.details ? (
                          <code style={{ background: '#F4F4F2', padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
                            {JSON.stringify(l.details).slice(0, 80)}
                          </code>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
