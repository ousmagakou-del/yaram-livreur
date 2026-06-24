import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────────────
// VerifyRequestsSection
// Admin oversight (LECTURE SEULE) sur les vérifications Tier 3 pharmacien.
// Le pharmacien répond depuis son app mobile — l'admin ne modifie RIEN ici.
// Backend :
//   - admin_list_verify_requests(p_filter text)
//   - admin_get_verify_request(p_id uuid)
//   - admin_verify_request_stats()
// ─────────────────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'pending_pharmacist', label: 'En attente pharmacien' },
  { id: 'ai_done',            label: 'IA seul' },
  { id: 'completed',          label: 'Terminées' },
  { id: 'suspect',            label: '🚨 Contrefaçon' },
  { id: 'all',                label: 'Tous' },
];

export default function VerifyRequestsSection() {
  const [items, setItems]       = useState([]);
  const [stats, setStats]       = useState(null);
  const [filter, setFilter]     = useState('pending_pharmacist');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [selected, setSelected] = useState(null);    // row from list
  const [detail, setDetail]     = useState(null);    // full RPC detail
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => { refresh(filter); }, [filter]);
  useEffect(() => { refreshStats(); }, []);

  const refresh = async (currentFilter) => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_list_verify_requests', {
      p_filter: currentFilter,
    });
    if (err) {
      console.warn('[VerifyRequestsSection] list error:', err.message);
      setError(err.message);
      toast.error('Erreur chargement : ' + err.message);
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  };

  const refreshStats = async () => {
    const { data, error: err } = await supabase.rpc('admin_verify_request_stats');
    if (err) {
      console.warn('[VerifyRequestsSection] stats error:', err.message);
      return;
    }
    setStats(data || null);
  };

  const openDetail = async (row) => {
    setSelected(row);
    setDetail(null);
    setDetailLoading(true);
    const { data, error: err } = await supabase.rpc('admin_get_verify_request', { p_id: row.id });
    setDetailLoading(false);
    if (err) {
      toast.error('Erreur détail : ' + err.message);
      setSelected(null);
      return;
    }
    setDetail(data || null);
  };

  const closeDetail = () => { setSelected(null); setDetail(null); };

  // ── Stats counts par filtre (à partir de stats global) ────────────────────
  const filterCount = (id) => {
    if (!stats) return null;
    if (id === 'all')                return stats.total;
    if (id === 'pending_pharmacist') return stats.pending_pharmacist;
    if (id === 'ai_done')            return stats.ai_done;
    if (id === 'completed')          return stats.completed_today; // approx aujourd'hui
    if (id === 'suspect')            return stats.counterfeit_today;
    return null;
  };

  // ── Styles inline ─────────────────────────────────────────────────────────
  const S = {
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 },
    statCard:  { background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 },
    statLabel: { fontSize: 10, fontWeight: 800, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em' },
    statValue: { fontSize: 24, fontWeight: 800, marginTop: 6, color: '#1A1A1A' },
    statMeta:  { fontSize: 11, color: '#9B9B9B', marginTop: 2 },
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>🛡️ Vérifications Tier 3 pharmacien</h1>
          <p>Oversight des demandes de vérification — lecture seule</p>
        </div>
      </header>

      {/* Stats top */}
      <div style={S.statsGrid}>
        <div style={S.statCard}>
          <div style={S.statLabel}>📦 Total</div>
          <div style={S.statValue}>{stats?.total ?? '—'}</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>⏳ Pending pharmacien</div>
          <div style={{ ...S.statValue, color: (stats?.pending_pharmacist || 0) > 0 ? '#F4B53A' : '#1A1A1A' }}>
            {stats?.pending_pharmacist ?? '—'}
          </div>
          <div style={S.statMeta}>en attente d'humain</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>🤖 IA seul</div>
          <div style={S.statValue}>{stats?.ai_done ?? '—'}</div>
          <div style={S.statMeta}>auto-vérifiées</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>✅ Aujourd'hui</div>
          <div style={{ ...S.statValue, color: '#1F8B4C' }}>{stats?.completed_today ?? '—'}</div>
          <div style={S.statMeta}>terminées</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>🚨 Contrefaçons</div>
          <div style={{ ...S.statValue, color: '#D9342B' }}>{stats?.counterfeit_today ?? '—'}</div>
          <div style={S.statMeta}>aujourd'hui</div>
        </div>
        <div style={S.statCard}>
          <div style={S.statLabel}>💰 Revenu Tier 3</div>
          <div style={{ ...S.statValue, color: '#1F8B4C' }}>{fmtMoney(stats?.total_revenue)}</div>
          <div style={S.statMeta}>cumulé payé</div>
        </div>
      </div>

      {/* Filtres */}
      <div className="adm-filters">
        {FILTERS.map(f => {
          const c = filterCount(f.id);
          return (
            <button
              key={f.id}
              className={`adm-filter ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {c != null && <span className="adm-filter-count">{c}</span>}
            </button>
          );
        })}
      </div>

      {/* Liste */}
      {error ? (
        <div className="adm-empty" style={{ color: '#D9342B' }}>
          <div style={{ fontSize: 40, opacity: 0.4 }}>⚠️</div>
          <p>{error}</p>
          <button className="adm-btn-pri" onClick={() => refresh(filter)}>Réessayer</button>
        </div>
      ) : loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : items.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>🛡️</div>
          <p>Aucune vérification dans cette catégorie</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(it => (
            <VerifyCard key={it.id} item={it} onClick={() => openDetail(it)} />
          ))}
        </div>
      )}

      {/* Modal détail */}
      {selected && (
        <VerifyDetailModal
          row={selected}
          detail={detail}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VerifyCard — vignette dans la liste
// ─────────────────────────────────────────────────────────────────────────────
function VerifyCard({ item, onClick }) {
  const thumb = firstPhoto(item.photo_urls);
  const aiVerdict = item.ai_verdict;
  const isPaid = item.paid_at != null;

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
            <strong style={{ fontSize: 14 }}>{item.product_name || item.detected_brand || 'Produit non identifié'}</strong>
            <VerdictPill verdict={aiVerdict} confidence={item.ai_confidence} />
            <StatusPill status={item.status} />
          </div>

          {item.barcode && (
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6B6B6B', margin: '2px 0' }}>
              🏷️ {item.barcode}
            </p>
          )}

          <p style={{ fontSize: 12, color: '#1A1A1A', margin: '4px 0' }}>
            {item.pharmacist_id ? (
              <>👨‍⚕️ <strong>{item.pharmacist_name || 'Pharmacien'}</strong> {item.responded_at ? '· répondu' : '· en attente'}</>
            ) : (
              <span style={{ color: '#9B9B9B' }}>👨‍⚕️ Aucun pharmacien assigné</span>
            )}
          </p>

          <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 6 }}>
            {fmtDate(item.created_at)}
            {isPaid && (
              <> · <span style={{ color: '#1F8B4C', fontWeight: 700 }}>💰 {fmtMoney(item.amount_paid)}</span></>
            )}
          </p>
        </div>
        <div style={{ fontSize: 18, color: '#9B9B9B' }}>›</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VerifyDetailModal — détail
// ─────────────────────────────────────────────────────────────────────────────
function VerifyDetailModal({ row, detail, loading, onClose }) {
  const d = detail || row || {};
  const photos = parsePhotos(d.photo_urls);

  const daysSince = useMemo(() => {
    if (!d.created_at) return null;
    const ms = Date.now() - new Date(d.created_at).getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }, [d.created_at]);

  const Section = ({ title, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</div>
      <div style={{ background: '#F8F8F6', borderRadius: 10, padding: 12 }}>{children}</div>
    </div>
  );

  const KV = ({ k, v }) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}>
      <span style={{ color: '#6B6B6B', minWidth: 140 }}>{k}</span>
      <span style={{ color: '#1A1A1A', fontWeight: 600, wordBreak: 'break-word', flex: 1 }}>{v ?? '—'}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>
            Vérification #{String(d.id || '').slice(0, 8)}
            <span style={{ marginLeft: 10 }}><StatusPill status={d.status} /></span>
          </h3>
          <button className="adm-btn-sec" onClick={onClose}>✕</button>
        </div>

        {loading && !detail ? (
          <p style={{ color: '#9B9B9B', padding: 20, textAlign: 'center' }}>Chargement du détail…</p>
        ) : (
          <>
            {/* Photos */}
            {photos.length > 0 && (
              <Section title={`📷 Photos (${photos.length})`}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {photos.map((p, i) => (
                    <a key={i} href={p} target="_blank" rel="noopener noreferrer">
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

            {/* User */}
            <Section title="👤 Utilisateur">
              <KV k="Nom" v={d.user_name} />
              <KV k="Email" v={d.user_email} />
              <KV k="Téléphone" v={d.user_phone} />
              <KV k="User ID" v={d.user_id ? <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{d.user_id}</code> : null} />
            </Section>

            {/* Pharmacien */}
            <Section title="👨‍⚕️ Pharmacien">
              {d.pharmacist_id ? (
                <>
                  <KV k="Pharmacie / pharmacien" v={d.pharmacist_name} />
                  {d.pharmacist_city && <KV k="Ville" v={d.pharmacist_city} />}
                  <KV
                    k="Statut réponse"
                    v={
                      d.responded_at
                        ? <span style={{ color: '#1F8B4C', fontWeight: 700 }}>✓ Répondu — {fmtDate(d.responded_at)}</span>
                        : <span style={{ color: '#F4B53A', fontWeight: 700 }}>⏳ En attente</span>
                    }
                  />
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#9B9B9B', margin: 0 }}>Aucun pharmacien assigné</p>
              )}
            </Section>

            {/* AI analysis */}
            <Section title="🤖 Analyse IA">
              <KV k="Verdict IA" v={<VerdictPill verdict={d.ai_verdict} confidence={d.ai_confidence} />} />
              <KV k="Confiance" v={d.ai_confidence != null ? `${(Number(d.ai_confidence) * 100).toFixed(0)}%` : null} />
              <KV k="Marque détectée" v={d.detected_brand} />
              <KV k="Produit détecté" v={d.product_name} />
              <KV k="Code-barres" v={d.barcode ? <code style={{ fontFamily: 'monospace' }}>{d.barcode}</code> : null} />
              {d.ai_notes && (
                <div style={{ marginTop: 8, padding: 10, background: 'white', borderRadius: 8, fontSize: 13, color: '#1A1A1A', whiteSpace: 'pre-wrap', border: '1px solid #EEE' }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#6B6B6B', textTransform: 'uppercase', marginBottom: 4 }}>Notes IA</div>
                  {d.ai_notes}
                </div>
              )}
              {d.ai_raw && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6B6B6B' }}>Réponse IA brute (JSON)</summary>
                  <pre style={{ background: 'white', border: '1px solid #EEE', borderRadius: 8, padding: 10, fontSize: 11, overflowX: 'auto', marginTop: 6 }}>
{JSON.stringify(d.ai_raw, null, 2)}
                  </pre>
                </details>
              )}
            </Section>

            {/* Pharmacist verdict */}
            {(d.pharmacist_verdict || d.pharmacist_notes) && (
              <Section title="⚕️ Verdict pharmacien">
                <KV k="Verdict" v={<VerdictPill verdict={d.pharmacist_verdict} />} />
                {d.pharmacist_notes && (
                  <div style={{ marginTop: 8, padding: 10, background: 'white', borderRadius: 8, fontSize: 13, color: '#1A1A1A', whiteSpace: 'pre-wrap', border: '1px solid #EEE' }}>
                    {d.pharmacist_notes}
                  </div>
                )}
                <KV k="Répondu le" v={fmtDate(d.responded_at)} />
              </Section>
            )}

            {/* Counterfeit report lié */}
            {d.counterfeit_report_id && (
              <Section title="🚨 Signalement contrefaçon lié">
                <KV k="Report ID" v={<code style={{ fontFamily: 'monospace', fontSize: 11 }}>{d.counterfeit_report_id}</code>} />
                <KV k="Statut" v={d.counterfeit_report_status} />
              </Section>
            )}

            {/* Global stats */}
            <Section title="📊 Récap">
              <KV k="Créée le" v={fmtDate(d.created_at)} />
              <KV k="Ancienneté" v={daysSince != null ? `${daysSince} jour${daysSince > 1 ? 's' : ''}` : null} />
              <KV
                k="Paiement"
                v={
                  d.paid_at
                    ? <span style={{ color: '#1F8B4C', fontWeight: 700 }}>✓ Payé · {fmtMoney(d.amount_paid)}{d.payment_method ? ` (${d.payment_method})` : ''}</span>
                    : <span style={{ color: '#6B6B6B' }}>Non payé</span>
                }
              />
              {d.paid_at && <KV k="Payé le" v={fmtDate(d.paid_at)} />}
            </Section>

            {/* Note admin oversight only */}
            <div style={{ background: '#F4F4F2', borderRadius: 10, padding: 12, fontSize: 12, color: '#6B6B6B', lineHeight: 1.6, marginTop: 12 }}>
              ℹ️ <strong>Oversight uniquement.</strong> Le pharmacien rend son verdict
              depuis son app mobile. L'admin ne peut ni modifier la réponse ni
              fermer la demande depuis ici.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid #EEE' }}>
              <button className="adm-btn-sec" onClick={onClose}>Fermer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pills
// ─────────────────────────────────────────────────────────────────────────────
function VerdictPill({ verdict, confidence }) {
  if (!verdict) return <span style={pill('#EEE', '#6B6B6B')}>—</span>;
  const v = String(verdict).toLowerCase();
  const cfg =
    v === 'authentic'   ? { bg: '#E8F5EC', fg: '#1F8B4C', label: '✓ Authentique' } :
    v === 'counterfeit' ? { bg: '#FCE9E7', fg: '#D9342B', label: '✗ Contrefaçon' } :
    v === 'suspicious'  ? { bg: '#FEF6E5', fg: '#F4B53A', label: '⚠ Suspect' } :
                          { bg: '#EEE',    fg: '#6B6B6B', label: verdict };
  return (
    <span style={pill(cfg.bg, cfg.fg)}>
      {cfg.label}{confidence != null ? ` ${(Number(confidence) * 100).toFixed(0)}%` : ''}
    </span>
  );
}

function StatusPill({ status }) {
  const cfg =
    status === 'completed'          ? { bg: '#E8F5EC', fg: '#1F8B4C', label: 'Terminée' } :
    status === 'pending_pharmacist' ? { bg: '#FEF6E5', fg: '#F4B53A', label: 'En attente pharmacien' } :
    status === 'ai_done'            ? { bg: '#EAF2FC', fg: '#3B82F6', label: 'IA terminée' } :
    status === 'pending_ai'         ? { bg: '#EEE',    fg: '#6B6B6B', label: 'IA en cours' } :
                                      { bg: '#EEE',    fg: '#6B6B6B', label: status || '—' };
  return <span style={pill(cfg.bg, cfg.fg)}>{cfg.label}</span>;
}

function pill(bg, fg) {
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 11, fontWeight: 700, background: bg, color: fg, whiteSpace: 'nowrap',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function firstPhoto(urls) {
  const arr = parsePhotos(urls);
  return arr[0] || null;
}

function parsePhotos(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter(Boolean) : [];
    } catch { return []; }
  }
  return [];
}

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(d); }
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${v.toLocaleString('fr-FR')} F`;
  }
}
