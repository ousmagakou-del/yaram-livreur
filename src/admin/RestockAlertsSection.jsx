// src/admin/RestockAlertsSection.jsx
// ─────────────────────────────────────────────────────────────────────────────
// YARAM — Admin · Alertes restock globales
// ─────────────────────────────────────────────────────────────────────────────
// Vue cross-pharmacies des restock_alerts.
//   • 4 KPI top  (pending, critiques, warnings, today_new)
//   • Filtres    (active / acknowledged / dismissed / restocked / all)
//   • Cards par severity, joins pharmacy_name / product_name / image_url
//   • Acknowledge & Dismiss → acknowledge_alert / dismiss_alert
//   • Click card → ouvre la fiche produit dans un nouvel onglet
//
// RPC :
//   admin_list_all_restock_alerts(p_filter)
//   admin_restock_alert_stats()
//   acknowledge_alert(p_alert_id)
//   dismiss_alert(p_alert_id)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';

const FILTERS = [
  { key: 'active',       label: 'Actives' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'dismissed',    label: 'Dismissed' },
  { key: 'restocked',    label: 'Restocked' },
  { key: 'all',          label: 'Toutes' },
];

const SEVERITY_STYLE = {
  critical: {
    bg:     '#FEF2F2',
    border: '#B91C1C',
    badge:  '#B91C1C',
    label:  'CRITIQUE',
  },
  warning: {
    bg:     '#FFFBEB',
    border: '#D97706',
    badge:  '#D97706',
    label:  'ATTENTION',
  },
  info: {
    bg:     '#EFF6FF',
    border: '#1D4ED8',
    badge:  '#1D4ED8',
    label:  'INFO',
  },
};

const styleFor = (sev) => SEVERITY_STYLE[sev] || SEVERITY_STYLE.info;

const labelAlertType = (t) =>
  t === 'out_of_stock' ? 'Rupture stock'
  : t === 'expiry_soon' ? 'Expiration proche'
  : t === 'low_stock'   ? 'Stock faible'
  : (t || 'Alerte');

export default function RestockAlertsSection() {
  const [filter,   setFilter]   = useState('active');
  const [alerts,   setAlerts]   = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [busyId,   setBusyId]   = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        supabase.rpc('admin_list_all_restock_alerts', { p_filter: filter }),
        supabase.rpc('admin_restock_alert_stats'),
      ]);
      if (listRes.error)  console.warn('[RestockAlertsSection] list:',  listRes.error.message);
      if (statsRes.error) console.warn('[RestockAlertsSection] stats:', statsRes.error.message);

      setAlerts(Array.isArray(listRes.data) ? listRes.data : []);
      const s = Array.isArray(statsRes.data) ? (statsRes.data[0] || {}) : (statsRes.data || {});
      setStats(s);
    } catch (e) {
      console.warn('[RestockAlertsSection] refresh failed:', e?.message);
      toast.error('Erreur chargement alertes');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);

  const acknowledge = async (alert) => {
    setBusyId(alert.id);
    try {
      const { error } = await supabase.rpc('acknowledge_alert', { p_alert_id: alert.id });
      if (error) {
        toast.error('Erreur acknowledge : ' + error.message);
      } else {
        toast.success('Alerte acknowledged');
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (alert) => {
    setBusyId(alert.id);
    try {
      const { error } = await supabase.rpc('dismiss_alert', { p_alert_id: alert.id });
      if (error) {
        toast.error('Erreur dismiss : ' + error.message);
      } else {
        toast.success('Alerte ignorée');
        await refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const openProduct = (alert) => {
    if (!alert.product_id) return;
    window.open(`/admin#products?product=${alert.product_id}`, '_blank', 'noopener,noreferrer');
  };

  const kpis = [
    { label: 'PENDING',              value: stats?.pending        ?? 0, color: '#1F2937' },
    { label: 'CRITIQUES',            value: stats?.critical_count ?? 0, color: '#B91C1C' },
    { label: 'WARNINGS',             value: stats?.warning_count  ?? 0, color: '#D97706' },
    { label: 'NOUVELLES AUJOURD’HUI', value: stats?.today_new      ?? 0, color: '#1F8B4C' },
  ];

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Alertes restock global</h1>
          <p>
            {alerts.length} alerte{alerts.length > 1 ? 's' : ''}
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

      <div className="adm-filters" style={{ marginTop: 16, marginBottom: 12 }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`adm-filter ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : alerts.length === 0 ? (
        <div className="adm-empty">Aucune alerte pour ce filtre.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alerts.map(a => {
            const st = styleFor(a.severity);
            const stock = Number(a.current_stock ?? 0);
            const thr   = Number(a.threshold ?? 0);
            const age   = Number(a.age_days ?? 0);
            const isBusy = busyId === a.id;
            return (
              <div
                key={a.id}
                onClick={() => openProduct(a)}
                style={{
                  background:    st.bg,
                  border:        `1px solid ${st.border}`,
                  borderLeft:    `5px solid ${st.border}`,
                  borderRadius:  8,
                  padding:       12,
                  display:       'flex',
                  alignItems:    'center',
                  gap:           12,
                  cursor:        'pointer',
                  opacity:       isBusy ? 0.6 : 1,
                  transition:    'opacity 120ms',
                }}
              >
                {a.image_url
                  ? <img src={a.image_url} alt=""
                         style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', background: '#FFF' }} />
                  : <div style={{ width: 56, height: 56, borderRadius: 6, background: '#FFF' }} />}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{
                      background: st.badge,
                      color: '#FFF',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}>{st.label}</span>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>
                      {labelAlertType(a.alert_type)}
                    </span>
                    <span style={{ fontSize: 12, color: '#9CA3AF' }}>
                      · {age === 0 ? 'aujourd’hui' : `${age} j`}
                    </span>
                  </div>

                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1F2937', marginBottom: 2 }}>
                    {a.product_name || 'Produit inconnu'}
                    {a.brand && <span style={{ color: '#6B7280', fontWeight: 400 }}> · {a.brand}</span>}
                  </div>

                  <div style={{ fontSize: 13, color: '#374151' }}>
                    🏥 <strong>{a.pharmacy_name || 'Pharmacie ?'}</strong>
                    {' · '}
                    Stock <strong>{stock}</strong> / seuil <strong>{thr}</strong>
                    {a.acknowledged_at && <span style={{ color: '#6B7280' }}>{' · acknowledged'}</span>}
                    {a.dismissed       && <span style={{ color: '#6B7280' }}>{' · dismissed'}</span>}
                    {a.restocked       && <span style={{ color: '#1F8B4C' }}>{' · restocked'}</span>}
                  </div>
                </div>

                <div
                  style={{ display: 'flex', gap: 6 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!a.acknowledged_at && !a.dismissed && !a.restocked && (
                    <button
                      className="adm-btn-sec"
                      onClick={() => acknowledge(a)}
                      disabled={isBusy}
                    >
                      {isBusy ? '⏳' : '👁️'} Acknowledger
                    </button>
                  )}
                  {!a.dismissed && !a.restocked && (
                    <button
                      className="adm-btn-danger"
                      onClick={() => dismiss(a)}
                      disabled={isBusy}
                    >
                      {isBusy ? '⏳' : '✕'} Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
