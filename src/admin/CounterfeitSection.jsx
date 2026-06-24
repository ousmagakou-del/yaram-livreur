import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast, promptDialog, confirmDialog } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────────────
// CounterfeitSection
// Admin web — signalements de contrefaçon par les utilisateurs.
// Backend :
//   - admin_list_counterfeit_reports(p_filter text)
//   - admin_verify_counterfeit(p_id uuid, p_verdict text, p_notes text)
//       → quand p_verdict='confirmed', met products.active = false
//   - admin_counterfeit_hotspots()       (lat, lng, count)
//   - admin_counterfeit_top_brands()     (brand, count)
// ─────────────────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'pending',      label: 'À examiner',     pillBg: '#FEF6E5', pillFg: '#F4B53A' },
  { id: 'confirmed',    label: 'Confirmés',      pillBg: '#FCE9E7', pillFg: '#D9342B' },
  { id: 'rejected',     label: 'Rejetés',        pillBg: '#EEE',    pillFg: '#6B6B6B' },
  { id: 'inconclusive', label: 'Non concluants', pillBg: '#FFF3E0', pillFg: '#E67E22' },
  { id: 'all',          label: 'Tous',           pillBg: '#E8F5EC', pillFg: '#1F8B4C' },
];

export default function CounterfeitSection() {
  const [reports, setReports]       = useState([]);
  const [counts, setCounts]         = useState({ pending: 0, confirmed: 0, rejected: 0, inconclusive: 0, all: 0 });
  const [topBrands, setTopBrands]   = useState([]);
  const [hotspots, setHotspots]     = useState([]);
  const [filter, setFilter]         = useState('pending');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [selected, setSelected]     = useState(null);
  const [acting, setActing]         = useState(false);

  // ── Chargement initial / refresh ───────────────────────────────────────────
  useEffect(() => { refreshAll(filter); }, [filter]);

  const refreshAll = async (currentFilter) => {
    setLoading(true);
    setError(null);
    try {
      const [list, countsAll, brands, hot] = await Promise.all([
        supabase.rpc('admin_list_counterfeit_reports', { p_filter: currentFilter }),
        // Counts par statut : on tape "all" puis on agrège
        supabase.rpc('admin_list_counterfeit_reports', { p_filter: 'all' }),
        supabase.rpc('admin_counterfeit_top_brands'),
        supabase.rpc('admin_counterfeit_hotspots'),
      ]);

      if (list.error)      throw new Error(`Liste : ${list.error.message}`);
      if (countsAll.error) throw new Error(`Counts : ${countsAll.error.message}`);

      setReports(list.data || []);

      const all = countsAll.data || [];
      setCounts({
        pending:      all.filter(r => r.status === 'pending').length,
        confirmed:    all.filter(r => r.status === 'confirmed').length,
        rejected:     all.filter(r => r.status === 'rejected').length,
        inconclusive: all.filter(r => r.status === 'inconclusive').length,
        all:          all.length,
      });

      if (!brands.error) setTopBrands((brands.data || []).slice(0, 5));
      if (!hot.error)    setHotspots((hot.data || []).slice(0, 10));
    } catch (e) {
      console.warn('[CounterfeitSection] refresh error:', e?.message);
      setError(e?.message || 'Erreur de chargement');
      toast.error('Erreur chargement : ' + (e?.message || 'inconnu'));
    } finally {
      setLoading(false);
    }
  };

  // ── Actions admin ──────────────────────────────────────────────────────────
  const handleConfirm = async (report) => {
    const ok = await confirmDialog(
      `⚠️ Confirmer "${report.product_name || report.detected_brand || 'ce signalement'}" comme CONTREFAÇON ?\n\n` +
      `• Le produit lié sera désactivé automatiquement (invisible pour tous).\n` +
      `• Un email peut être envoyé au reporter.\n` +
      `• Action partiellement réversible (réactiver le produit depuis la fiche).`,
      { confirmLabel: 'Continuer', danger: true }
    );
    if (!ok) return;

    const notes = await promptDialog(
      'Notes admin (obligatoires) — explication du verdict :',
      {
        multiline: true,
        placeholder: 'Ex: photos de l\'INCI ne correspondent pas au lot officiel, code-barres recyclé d\'un autre produit, hologramme manquant…',
        confirmLabel: 'Confirmer la contrefaçon',
        danger: true,
      }
    );
    if (!notes || !notes.trim()) {
      toast.error('Notes obligatoires pour confirmer.');
      return;
    }

    setActing(true);
    const { error } = await supabase.rpc('admin_verify_counterfeit', {
      p_id: report.id, p_verdict: 'confirmed', p_notes: notes.trim(),
    });
    setActing(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    toast.success('Contrefaçon confirmée · produit désactivé');
    setSelected(null);
    refreshAll(filter);
  };

  const handleReject = async (report) => {
    const notes = await promptDialog(
      'Notes admin (optionnelles) — pourquoi rejeté ?',
      {
        multiline: true,
        placeholder: 'Ex: photos trop floues, produit authentique vérifié auprès de la marque…',
        confirmLabel: 'Rejeter',
      }
    );
    // promptDialog peut renvoyer '' (rejet vide ok) ou null (cancel)
    if (notes === null) return;

    setActing(true);
    const { error } = await supabase.rpc('admin_verify_counterfeit', {
      p_id: report.id, p_verdict: 'rejected', p_notes: (notes || '').trim(),
    });
    setActing(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    toast.success('Signalement rejeté');
    setSelected(null);
    refreshAll(filter);
  };

  const handleInconclusive = async (report) => {
    const notes = await promptDialog(
      'Notes admin — éléments manquants :',
      {
        multiline: true,
        placeholder: 'Ex: pas assez de photos, lot non identifiable, à recontrôler si nouveau signalement…',
        confirmLabel: 'Marquer non concluant',
      }
    );
    if (notes === null) return;

    setActing(true);
    const { error } = await supabase.rpc('admin_verify_counterfeit', {
      p_id: report.id, p_verdict: 'inconclusive', p_notes: (notes || '').trim(),
    });
    setActing(false);
    if (error) { toast.error('Erreur : ' + error.message); return; }
    toast.success('Marqué non concluant');
    setSelected(null);
    refreshAll(filter);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const maxBrandCount = useMemo(
    () => Math.max(1, ...topBrands.map(b => Number(b.count) || 0)),
    [topBrands]
  );

  // ── Styles inline (cohérent avec SkinScansSection) ─────────────────────────
  const S = {
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 },
    statCard:  { background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 18 },
    statLabel: { fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em' },
    statValue: { fontSize: 26, fontWeight: 800, marginTop: 6, color: '#1A1A1A' },
    panel:     { background: 'white', borderRadius: 14, border: '1px solid #EEE', padding: 20, marginBottom: 16 },
    panelTitle:{ fontSize: 15, fontWeight: 800, marginBottom: 14, color: '#1A1A1A' },
    rowBar:    { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' },
    rowLabel:  { width: 180, fontSize: 13, color: '#1A1A1A' },
    barWrap:   { flex: 1, height: 16, background: '#F4F4F2', borderRadius: 4, overflow: 'hidden' },
    barInner:  (pct) => ({ width: `${pct}%`, height: '100%', background: '#D9342B', borderRadius: 4 }),
    rowCount:  { width: 60, fontSize: 12, fontWeight: 700, color: '#1A1A1A', textAlign: 'right' },
    table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:        { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #EEE', color: '#6B6B6B', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' },
    td:        { padding: '8px 10px', borderBottom: '1px solid #F4F4F2' },
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>🚨 Signalements contrefaçon</h1>
          <p>
            {counts.all} signalement{counts.all > 1 ? 's' : ''} · {counts.pending} à examiner · {counts.confirmed} confirmé{counts.confirmed > 1 ? 's' : ''}
          </p>
        </div>
      </header>

      {/* Stats top */}
      <div style={S.statsGrid}>
        <div style={S.statCard}>
          <div style={S.statLabel}>📦 Total</div>
          <div style={S.statValue}>{counts.all}</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>⏳ À examiner</div>
          <div style={{ ...S.statValue, color: counts.pending > 0 ? '#F4B53A' : '#1A1A1A' }}>{counts.pending}</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>❌ Confirmés contrefaits</div>
          <div style={{ ...S.statValue, color: '#D9342B' }}>{counts.confirmed}</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>✅ Rejetés</div>
          <div style={S.statValue}>{counts.rejected}</div>
        </div>
      </div>

      {/* Top marques signalées */}
      <div style={S.panel}>
        <div style={S.panelTitle}>🏷️ Top 5 marques signalées</div>
        {topBrands.length === 0 ? (
          <p style={{ color: '#9B9B9B', fontSize: 13, margin: 0 }}>Aucune donnée pour l'instant</p>
        ) : (
          topBrands.map((b, i) => (
            <div key={(b.brand || 'inconnu') + '-' + i} style={S.rowBar}>
              <div style={S.rowLabel}>{b.brand || '—'}</div>
              <div style={S.barWrap}>
                <div style={S.barInner((Number(b.count) / maxBrandCount) * 100)} />
              </div>
              <div style={S.rowCount}>{b.count}</div>
            </div>
          ))
        )}
      </div>

      {/* Hotspots géographiques */}
      <div style={S.panel}>
        <div style={S.panelTitle}>📍 Hotspots géographiques (top 10)</div>
        {hotspots.length === 0 ? (
          <p style={{ color: '#9B9B9B', fontSize: 13, margin: 0 }}>Aucune zone identifiée</p>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Latitude</th>
                <th style={S.th}>Longitude</th>
                <th style={S.th}>Signalements</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {hotspots.map((h, i) => (
                <tr key={`${h.lat}-${h.lng}-${i}`}>
                  <td style={{ ...S.td, fontFamily: 'monospace' }}>{numFmt(h.lat, 5)}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace' }}>{numFmt(h.lng, 5)}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{h.count}</td>
                  <td style={S.td}>
                    {h.lat != null && h.lng != null && (
                      <a
                        href={`https://www.google.com/maps?q=${h.lat},${h.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#1F8B4C', textDecoration: 'none' }}
                      >
                        Voir sur la carte ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Filtres */}
      <div className="adm-filters">
        {FILTERS.map(f => (
          <button
            key={f.id}
            className={`adm-filter ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span className="adm-filter-count">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Liste */}
      {error ? (
        <div className="adm-empty" style={{ color: '#D9342B' }}>
          <div style={{ fontSize: 40, opacity: 0.4 }}>⚠️</div>
          <p>{error}</p>
          <button className="adm-btn-pri" onClick={() => refreshAll(filter)}>Réessayer</button>
        </div>
      ) : loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : reports.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>🚨</div>
          <p>Aucun signalement {filter !== 'all' ? `dans la catégorie "${FILTERS.find(f => f.id === filter)?.label}"` : ''}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reports.map(r => (
            <ReportCard key={r.id} report={r} onClick={() => setSelected(r)} />
          ))}
        </div>
      )}

      {/* Modal détail */}
      {selected && (
        <ReportDetailModal
          report={selected}
          onClose={() => setSelected(null)}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onInconclusive={handleInconclusive}
          acting={acting}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportCard — vignette
// ─────────────────────────────────────────────────────────────────────────────
function ReportCard({ report, onClick }) {
  const thumb = firstPhoto(report);
  const status = report.status || 'pending';
  return (
    <div
      className="adm-recent-card"
      style={{ padding: 16, cursor: 'pointer' }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {thumb ? (
          <img src={thumb} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover', background: '#F4F4F2' }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: 10, background: '#F4F4F2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📷</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{report.product_name || report.detected_brand || 'Produit non identifié'}</strong>
            <span className={`adm-badge ${statusBadge(status)}`}>{statusLabel(status)}</span>
          </div>
          {report.barcode && (
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6B6B6B', margin: '2px 0' }}>
              🏷️ {report.barcode}
            </p>
          )}
          {report.detected_brand && (
            <p style={{ fontSize: 12, color: '#6B6B6B', margin: '2px 0' }}>Marque : <strong>{report.detected_brand}</strong></p>
          )}
          {report.source_description && (
            <p style={{ fontSize: 13, color: '#1A1A1A', margin: '4px 0', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              📍 {report.source_description}
            </p>
          )}
          <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 6 }}>
            Reporter : {report.reporter_name || 'Anonyme'} · {fmtDate(report.created_at)}
          </p>
        </div>
        <div style={{ fontSize: 18, color: '#9B9B9B' }}>›</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportDetailModal
// ─────────────────────────────────────────────────────────────────────────────
function ReportDetailModal({ report, onClose, onConfirm, onReject, onInconclusive, acting }) {
  const photos = collectPhotos(report);
  const isVerified = report.status && report.status !== 'pending';

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</div>
      <div style={{ background: '#F8F8F6', borderRadius: 10, padding: 12 }}>{children}</div>
    </div>
  );

  const KV = ({ k, v }) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: '#6B6B6B', minWidth: 130 }}>{k}</span>
      <span style={{ color: '#1A1A1A', fontWeight: 600, wordBreak: 'break-word' }}>{v ?? '—'}</span>
    </div>
  );

  return (
    <div
      className="adm-form-overlay"
      onClick={onClose}
      style={{ alignItems: 'flex-start', overflowY: 'auto', padding: '40px 16px' }}
    >
      <div
        className="adm-form-card"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 720, width: '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>
            Signalement #{String(report.id).slice(0, 8)}
            <span style={{ marginLeft: 10 }} className={`adm-badge ${statusBadge(report.status)}`}>{statusLabel(report.status)}</span>
          </h3>
          <button className="adm-btn-sec" onClick={onClose}>✕</button>
        </div>

        {/* Photos */}
        {photos.length > 0 && (
          <Section title={`📷 Photos (${photos.length})`}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {photos.map((p, i) => (
                <a key={i} href={p} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                  <img
                    src={p}
                    alt={`Photo ${i + 1}`}
                    style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, background: 'white', border: '1px solid #EEE' }}
                  />
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* Produit */}
        <Section title="🧴 Produit signalé">
          <KV k="Nom" v={report.product_name} />
          <KV k="Marque détectée" v={report.detected_brand} />
          <KV k="Code-barres" v={report.barcode ? <code style={{ fontFamily: 'monospace' }}>{report.barcode}</code> : null} />
          {report.product_id && <KV k="Product ID" v={<code style={{ fontFamily: 'monospace', fontSize: 11 }}>{report.product_id}</code>} />}
        </Section>

        {/* Source */}
        <Section title="📍 Source du signalement">
          <KV k="Description" v={report.source_description} />
          <KV k="Latitude" v={report.lat != null ? numFmt(report.lat, 5) : null} />
          <KV k="Longitude" v={report.lng != null ? numFmt(report.lng, 5) : null} />
          {report.lat != null && report.lng != null && (
            <div style={{ marginTop: 8 }}>
              <a
                href={`https://www.google.com/maps?q=${report.lat},${report.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: '#1F8B4C' }}
              >
                Voir sur Google Maps ↗
              </a>
            </div>
          )}
        </Section>

        {/* Analyse IA */}
        {(report.ai_verdict || report.ai_confidence != null || report.ai_notes) && (
          <Section title="🤖 Analyse IA initiale">
            <KV k="Verdict" v={report.ai_verdict} />
            <KV k="Confiance" v={report.ai_confidence != null ? `${(Number(report.ai_confidence) * 100).toFixed(0)}%` : null} />
            {report.ai_notes && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#1A1A1A', whiteSpace: 'pre-wrap' }}>
                {report.ai_notes}
              </div>
            )}
          </Section>
        )}

        {/* Reporter */}
        <Section title="👤 Reporter">
          <KV k="Nom" v={report.reporter_name} />
          <KV k="Email" v={report.reporter_email} />
          <KV k="Téléphone" v={report.reporter_phone} />
          <KV k="Date" v={fmtDate(report.created_at)} />
        </Section>

        {/* Verdict admin existant */}
        {isVerified && (
          <Section title="⚖️ Verdict admin">
            <KV k="Statut" v={statusLabel(report.status)} />
            <KV k="Par" v={report.verified_by_name || report.verified_by} />
            <KV k="Date" v={fmtDate(report.verified_at)} />
            {report.admin_notes && (
              <div style={{ marginTop: 8, padding: 10, background: 'white', borderRadius: 8, fontSize: 13, color: '#1A1A1A', whiteSpace: 'pre-wrap', border: '1px solid #EEE' }}>
                {report.admin_notes}
              </div>
            )}
          </Section>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20, paddingTop: 16, borderTop: '1px solid #EEE' }}>
          <button
            className="adm-btn-danger"
            disabled={acting}
            onClick={() => onConfirm(report)}
            title="Confirme la contrefaçon ET désactive le produit lié"
          >
            ❌ Confirmer contrefaçon
          </button>
          <button
            className="adm-btn-sec"
            disabled={acting}
            onClick={() => onReject(report)}
            style={{ background: '#EEE', color: '#1A1A1A' }}
          >
            ✅ Rejeter
          </button>
          <button
            className="adm-btn-sec"
            disabled={acting}
            onClick={() => onInconclusive(report)}
            style={{ background: '#FFF3E0', color: '#E67E22', borderColor: '#E67E22' }}
          >
            ❓ Non concluant
          </button>
          <div style={{ flex: 1 }} />
          <button className="adm-btn-sec" disabled={acting} onClick={onClose}>Fermer</button>
        </div>

        <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 12, lineHeight: 1.5 }}>
          ⚠️ "Confirmer contrefaçon" désactive automatiquement le produit lié (invisible
          pour tous les utilisateurs). Réversible depuis la fiche produit.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function firstPhoto(report) {
  const arr = collectPhotos(report);
  return arr[0] || null;
}

function collectPhotos(report) {
  const raw = report?.photo_urls ?? report?.photos ?? [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch { return []; }
  }
  return [];
}

function statusBadge(s) {
  if (s === 'confirmed')    return 'bad';
  if (s === 'rejected')     return 'good';
  if (s === 'inconclusive') return 'medium';
  return 'medium';
}

function statusLabel(s) {
  switch (s) {
    case 'confirmed':    return 'Contrefaçon confirmée';
    case 'rejected':     return 'Rejeté';
    case 'inconclusive': return 'Non concluant';
    case 'pending':      return 'À examiner';
    default:             return s || 'À examiner';
  }
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(d); }
}

function numFmt(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}
