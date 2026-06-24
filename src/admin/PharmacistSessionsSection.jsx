// src/admin/PharmacistSessionsSection.jsx
// ─────────────────────────────────────────────────────────────────────────────
// YARAM — Admin · Sessions pharmaciens actives
// ─────────────────────────────────────────────────────────────────────────────
// Vue cross-pharmacies des sessions pharmaciens en cours.
//   • 3 KPI top  (active, expired today, total today)
//   • Tableau : pharmacy / token preview / created_at / last_seen / expires
//   • Force logout (admin_force_logout_pharmacist) avec confirm
//   • Auto-refresh toutes les 60 secondes
//
// RPC :
//   admin_list_pharmacist_sessions()
//   admin_force_logout_pharmacist(p_token)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

const REFRESH_MS = 60_000;

const ago = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1)    return 'à l’instant';
  if (diffMin < 60)   return `il y a ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24)         return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  return `il y a ${days} j`;
};

const inFuture = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMin = Math.floor((d.getTime() - Date.now()) / 60000);
  if (diffMin < 0)  return `expiré · ${Math.abs(diffMin)} min`;
  if (diffMin < 60) return `dans ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24)       return `dans ${h} h`;
  return `dans ${Math.floor(h / 24)} j`;
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

const tokenPreview = (tok) => {
  if (!tok) return '—';
  const s = String(tok);
  return s.length <= 8 ? s : s.slice(0, 4) + '…';
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export default function PharmacistSessionsSection() {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busyTok,  setBusyTok]  = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_pharmacist_sessions');
      if (error) {
        console.warn('[PharmacistSessionsSection] list:', error.message);
        toast.error('Erreur chargement sessions');
        setSessions([]);
      } else {
        setSessions(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh 60s + cleanup
  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  // KPIs dérivés
  const todayStart  = startOfToday();
  const now         = Date.now();
  let activeCount   = 0;
  let expiredToday  = 0;
  let totalToday    = 0;
  for (const s of sessions) {
    const createdMs = s.created_at ? new Date(s.created_at).getTime() : NaN;
    const expMs     = s.expires_at ? new Date(s.expires_at).getTime() : NaN;
    if (Number.isFinite(expMs) && expMs > now) activeCount++;
    if (Number.isFinite(createdMs) && createdMs >= todayStart) totalToday++;
    if (Number.isFinite(expMs) && expMs <= now && Number.isFinite(createdMs) && createdMs >= todayStart) {
      expiredToday++;
    }
  }

  const forceLogout = async (s) => {
    const tok = s.token || s.session_token;
    if (!tok) {
      toast.error('Token absent — impossible de force logout');
      return;
    }
    if (!await confirmDialog(
      `Forcer la déconnexion de "${s.pharmacy_name || 'cette session'}" ?\n\n` +
      `Le pharmacien devra ressaisir son PIN pour se reconnecter.`,
      { confirmLabel: 'Force logout', danger: true }
    )) return;

    setBusyTok(tok);
    try {
      const { error } = await supabase.rpc('admin_force_logout_pharmacist', { p_token: tok });
      if (error) {
        toast.error('Erreur force logout : ' + error.message);
      } else {
        toast.success('Session terminée');
        await refresh();
      }
    } finally {
      setBusyTok(null);
    }
  };

  const kpis = [
    { label: 'SESSIONS ACTIVES', value: activeCount,  color: '#1F8B4C' },
    { label: 'EXPIRÉES AUJ.',    value: expiredToday, color: '#D97706' },
    { label: 'TOTAL AUJOURD’HUI', value: totalToday,   color: '#1F2937' },
  ];

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Sessions pharmaciens actives</h1>
          <p>
            {sessions.length} session{sessions.length > 1 ? 's' : ''}
            {' · auto-refresh 60 s'}
            {loading && ' · chargement…'}
          </p>
        </div>
        <button className="adm-btn-sec" onClick={refresh} disabled={loading}>
          {loading ? '⏳' : '🔄'} Rafraîchir
        </button>
      </header>

      <div className="adm-kpi-grid">
        {kpis.map(k => (
          <div className="adm-kpi" key={k.label}>
            <div className="adm-kpi-label">{k.label}</div>
            <div className="adm-kpi-value" style={{ color: k.color }}>
              {Number(k.value).toLocaleString('fr-FR')}
            </div>
          </div>
        ))}
      </div>

      {loading && sessions.length === 0 ? (
        <div className="adm-empty">Chargement…</div>
      ) : sessions.length === 0 ? (
        <div className="adm-empty">Aucune session active.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Pharmacie</th>
              <th>Token</th>
              <th>Créée le</th>
              <th>Dernière activité</th>
              <th>Expire</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => {
              const tok       = s.token || s.session_token;
              const expMs     = s.expires_at ? new Date(s.expires_at).getTime() : NaN;
              const isExpired = Number.isFinite(expMs) && expMs <= now;
              return (
                <tr key={tok || `${s.pharmacy_id}-${s.created_at}`}
                    style={isExpired ? { opacity: 0.55 } : null}>
                  <td><strong>{s.pharmacy_name || '—'}</strong></td>
                  <td>
                    <code style={{
                      background: '#F3F4F6',
                      padding:    '2px 6px',
                      borderRadius: 4,
                      fontSize:   12,
                    }}>{tokenPreview(tok)}</code>
                  </td>
                  <td style={{ fontSize: 12, color: '#6B7280' }}>
                    {fmtDateTime(s.created_at)}
                  </td>
                  <td style={{ fontSize: 12, color: '#6B7280' }}>
                    {ago(s.last_seen_at || s.last_used_at)}
                  </td>
                  <td style={{ fontSize: 12, color: isExpired ? '#B91C1C' : '#6B7280' }}>
                    {inFuture(s.expires_at)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="adm-btn-danger"
                      onClick={() => forceLogout(s)}
                      disabled={busyTok === tok || isExpired}
                      title={isExpired ? 'Session déjà expirée' : 'Force logout'}
                    >
                      {busyTok === tok ? '⏳' : '🚪'} Force logout
                    </button>
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
