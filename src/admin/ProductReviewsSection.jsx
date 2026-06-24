import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────────────
// ProductReviewsSection
// ─────────────────────────────────────────────────────────────────────────────
// Modération avis produits — branchée sur la nouvelle table `product_reviews`
// via les RPCs :
//   - admin_review_stats()                       → {total, published, hidden, flagged}
//   - admin_list_reviews(p_filter)               → liste enrichie (produit, user, photos, flagged_count)
//   - admin_moderate_review(p_review_id, p_act)  → action ∈ ('hide','restore','validate','delete')
//   - admin_get_review_flags(p_review_id)        → liste des signalements
//
// Coexiste avec ReviewsSection.jsx (qui pilote l'ancienne table `reviews`).
// ─────────────────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'to_review', label: '🚩 À examiner' },
  { id: 'hidden',    label: '🙈 Cachés' },
  { id: 'all',       label: 'Tous' },
];

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

function Stars({ rating = 0 }) {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span style={{ color: '#F4B53A', letterSpacing: 1, fontSize: 13 }}>
      {'★'.repeat(r)}{'☆'.repeat(5 - r)}
    </span>
  );
}

export default function ProductReviewsSection() {
  const [filter, setFilter] = useState('to_review');
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ total: 0, published: 0, hidden: 0, flagged: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [flagsModal, setFlagsModal] = useState(null); // { reviewId, flags }
  const [flagsLoading, setFlagsLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('admin_review_stats');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setStats({
        total:     Number(row?.total     ?? 0),
        published: Number(row?.published ?? 0),
        hidden:    Number(row?.hidden    ?? 0),
        flagged:   Number(row?.flagged   ?? 0),
      });
    } catch (e) {
      console.warn('[ProductReviewsSection] stats error:', e?.message || e);
    }
  }, []);

  const loadList = useCallback(async (f) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_reviews', { p_filter: f });
      if (error) throw error;
      setReviews(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('[ProductReviewsSection] list error:', e?.message || e);
      toast.error('Erreur chargement avis : ' + (e?.message || 'inconnu'));
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadList(filter);
  }, [filter, loadStats, loadList]);

  const refresh = useCallback(() => {
    loadStats();
    loadList(filter);
  }, [loadStats, loadList, filter]);

  const moderate = useCallback(async (reviewId, action, opts = {}) => {
    const { silent } = opts;
    try {
      const { error } = await supabase.rpc('admin_moderate_review', {
        p_review_id: reviewId,
        p_action: action,
      });
      if (error) throw error;
      if (!silent) {
        const msg = {
          hide:     'Avis caché 🙈',
          restore:  'Avis restauré ✅',
          validate: 'Signalements vidés ✅',
          delete:   'Avis supprimé 🗑️',
        }[action] || 'Action effectuée';
        toast.success(msg);
      }
      // Refresh stats + liste
      refresh();
      // Si la modale détail était ouverte sur cet avis, on la ferme après delete
      if (action === 'delete' && selected?.id === reviewId) setSelected(null);
    } catch (e) {
      toast.error('Erreur modération : ' + (e?.message || 'inconnu'));
    }
  }, [refresh, selected]);

  const openFlags = useCallback(async (reviewId) => {
    setFlagsModal({ reviewId, flags: [] });
    setFlagsLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_get_review_flags', { p_review_id: reviewId });
      if (error) throw error;
      setFlagsModal({ reviewId, flags: Array.isArray(data) ? data : [] });
    } catch (e) {
      toast.error('Erreur chargement signalements : ' + (e?.message || 'inconnu'));
      setFlagsModal(null);
    } finally {
      setFlagsLoading(false);
    }
  }, []);

  const askDelete = useCallback(async (reviewId) => {
    const ok = await confirmDialog('Supprimer définitivement cet avis ? Cette action est irréversible.');
    if (!ok) return;
    await moderate(reviewId, 'delete');
  }, [moderate]);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Modération avis produits</h1>
          <p>Avis publiés, signalés et cachés — table <code>product_reviews</code></p>
        </div>
        <button className="adm-btn-pri" onClick={refresh}>↻ Rafraîchir</button>
      </header>

      {/* Stats top 4 */}
      <div className="adm-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total" value={stats.total} icon="⭐" />
        <StatCard label="Publiés" value={stats.published} icon="✅" tone="good" />
        <StatCard label="Cachés" value={stats.hidden} icon="🙈" tone="muted" />
        <StatCard label="Signalés en attente" value={stats.flagged} icon="🚩" tone={stats.flagged > 0 ? 'bad' : 'muted'} />
      </div>

      {/* Filtres */}
      <div className="adm-filters">
        {FILTERS.map(f => (
          <button
            key={f.id}
            className={`adm-filter ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste */}
      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : reviews.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>⭐</div>
          <p>Aucun avis dans ce filtre</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reviews.map(r => (
            <ReviewCard
              key={r.id}
              review={r}
              onOpen={() => setSelected(r)}
              onModerate={moderate}
              onOpenFlags={() => openFlags(r.id)}
            />
          ))}
        </div>
      )}

      {/* Modale détail */}
      {selected && (
        <DetailModal
          review={selected}
          onClose={() => setSelected(null)}
          onHide={() => moderate(selected.id, 'hide')}
          onRestore={() => moderate(selected.id, 'restore')}
          onValidate={() => moderate(selected.id, 'validate')}
          onDelete={() => askDelete(selected.id)}
          onOpenFlags={() => openFlags(selected.id)}
        />
      )}

      {/* Modale signalements */}
      {flagsModal && (
        <FlagsModal
          loading={flagsLoading}
          flags={flagsModal.flags}
          onClose={() => setFlagsModal(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, icon, tone }) {
  const colorByTone = {
    good:   '#1F8B4C',
    bad:    '#D9342B',
    muted:  '#6B6B6B',
  };
  const color = colorByTone[tone] || '#1A1A1A';
  return (
    <div style={{
      background: '#FFF',
      border: '1px solid #EEE',
      borderRadius: 12,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ fontSize: 12, color: '#6B6B6B', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function ReviewCard({ review, onOpen, onModerate, onOpenFlags }) {
  const r = review;
  const status = r.status || 'published';
  const flagged = Number(r.flagged_count || 0) > 0;
  const photos = Array.isArray(r.photos) ? r.photos : [];

  const stop = (e) => e.stopPropagation();

  return (
    <div
      className="adm-recent-card"
      style={{ padding: 16, cursor: 'pointer' }}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {r.product_img ? (
          <img
            src={r.product_img}
            alt=""
            style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 8, background: '#F4F4F2', flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <strong style={{ fontSize: 14 }}>
              {r.product_brand ? `${r.product_brand} · ` : ''}{r.product_name || 'Produit'}
            </strong>
            {status === 'hidden' && <span className="adm-badge bad">Caché</span>}
            {flagged && (
              <span className="adm-badge bad">
                🚩 Signalé · {r.flagged_count}
              </span>
            )}
            {r.verified_purchase && (
              <span className="adm-badge good">✓ Achat vérifié</span>
            )}
          </div>

          <div style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Stars rating={r.rating} />
            <span>·</span>
            <span>{r.user_name || 'Utilisatrice'}</span>
            <span>·</span>
            <span>{timeAgo(r.created_at)}</span>
          </div>

          {r.title && <p style={{ fontWeight: 700, margin: '4px 0', fontSize: 14 }}>{r.title}</p>}
          {r.body && (
            <p style={{ fontSize: 13, color: '#1A1A1A', margin: '4px 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {r.body}
            </p>
          )}

          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {photos.slice(0, 5).map((p, i) => (
                <img
                  key={i}
                  src={p}
                  alt=""
                  style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', border: '1px solid #EEE' }}
                />
              ))}
              {photos.length > 5 && (
                <div style={{
                  width: 48, height: 48, borderRadius: 6, background: '#F4F4F2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: '#6B6B6B', fontWeight: 700,
                }}>
                  +{photos.length - 5}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }} onClick={stop}>
          {status === 'published' && flagged && (
            <>
              <button className="adm-btn-danger" onClick={() => onModerate(r.id, 'hide')}>🙈 Cacher</button>
              <button className="adm-btn-pri" onClick={() => onModerate(r.id, 'validate')}>✅ Valider</button>
            </>
          )}
          {status === 'hidden' && (
            <button className="adm-btn-pri" onClick={() => onModerate(r.id, 'restore')}>↩️ Restaurer</button>
          )}
          {status === 'published' && !flagged && (
            <button className="adm-btn-danger" onClick={() => onModerate(r.id, 'hide')}>🙈 Cacher</button>
          )}
          <button className="adm-btn-sec" onClick={onOpen}>Voir détails</button>
          <button className="adm-btn-sec" onClick={onOpenFlags}>🚩 Voir signalements</button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ review, onClose, onHide, onRestore, onValidate, onDelete, onOpenFlags }) {
  const r = review;
  const status = r.status || 'published';
  const photos = Array.isArray(r.photos) ? r.photos : [];
  const flagged = Number(r.flagged_count || 0) > 0;

  return (
    <ModalShell onClose={onClose} title="Détail de l'avis">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        {r.product_img && (
          <img
            src={r.product_img}
            alt=""
            style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover' }}
          />
        )}
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {r.product_brand ? `${r.product_brand} · ` : ''}{r.product_name || 'Produit'}
          </div>
          <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 4 }}>
            par {r.user_name || 'Utilisatrice'} · {timeAgo(r.created_at)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Stars rating={r.rating} />
            {r.verified_purchase && <span className="adm-badge good">✓ Achat vérifié</span>}
            {flagged && <span className="adm-badge bad">🚩 Signalé · {r.flagged_count}</span>}
            {status === 'hidden' && <span className="adm-badge bad">Caché</span>}
          </div>
        </div>
      </div>

      {r.title && <h3 style={{ fontSize: 16, fontWeight: 700, margin: '12px 0 6px' }}>{r.title}</h3>}
      {r.body && (
        <p style={{ fontSize: 14, color: '#1A1A1A', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {r.body}
        </p>
      )}

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 16 }}>
          {photos.map((p, i) => (
            <img
              key={i}
              src={p}
              alt=""
              style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 10, border: '1px solid #EEE' }}
            />
          ))}
        </div>
      )}

      <div style={{
        marginTop: 20,
        paddingTop: 16,
        borderTop: '1px solid #EEE',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}>
        <button className="adm-btn-sec" onClick={onOpenFlags}>🚩 Voir signalements</button>
        {status === 'published' && flagged && (
          <button className="adm-btn-pri" onClick={onValidate}>✅ Valider (vider signalements)</button>
        )}
        {status === 'published' && (
          <button className="adm-btn-danger" onClick={onHide}>🙈 Cacher</button>
        )}
        {status === 'hidden' && (
          <button className="adm-btn-pri" onClick={onRestore}>↩️ Restaurer</button>
        )}
        <button className="adm-btn-danger" onClick={onDelete}>🗑️ Supprimer</button>
      </div>
    </ModalShell>
  );
}

function FlagsModal({ loading, flags, onClose }) {
  return (
    <ModalShell onClose={onClose} title="Signalements">
      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#6B6B6B' }}>Chargement…</div>
      ) : (flags || []).length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#6B6B6B' }}>
          Aucun signalement pour cet avis.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {flags.map((f, i) => (
            <div key={f.id || i} style={{
              border: '1px solid #EEE',
              borderRadius: 10,
              padding: 12,
              background: '#FAFAFA',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ fontSize: 13 }}>{f.user_name || 'Anonyme'}</strong>
                <span style={{ fontSize: 11, color: '#6B6B6B' }}>{timeAgo(f.created_at)}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: '#1A1A1A' }}>
                <span style={{ fontWeight: 600 }}>Raison :</span> {f.reason || '—'}
              </div>
              {f.notes && (
                <div style={{ marginTop: 4, fontSize: 13, color: '#1A1A1A', whiteSpace: 'pre-wrap' }}>
                  <span style={{ fontWeight: 600 }}>Notes :</span> {f.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', borderRadius: 16, padding: 24,
          maxWidth: 640, width: '100%', maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 16,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 20, color: '#6B6B6B', padding: 4,
            }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
