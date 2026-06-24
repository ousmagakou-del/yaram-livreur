import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog, promptDialog } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────
// YARAM+ — Section admin "Abonnements"
// ─────────────────────────────────────────────────────────────────────
//
// FLOW D'ACTIVATION WAVE (documentation)
// --------------------------------------
// 1. La cliente choisit un plan YARAM+ (mensuel ou annuel) dans l'app.
// 2. L'app génère une référence Wave unique (ex: YPLUS-XXXX-XXXX) et
//    crée une row `subscriptions` avec status='pending' + cette ref.
// 3. La cliente paie sur Wave (lien deeplink ou QR) en mettant la ref
//    en commentaire de transaction.
// 4. L'admin reçoit la notif "Nouvel abonnement à vérifier" et vient ici.
// 5. Admin ouvre l'app Wave Business, voit le paiement entrant avec la
//    référence en commentaire, vérifie le montant. Puis revient dans ce
//    panneau, clique "Activer" sur la ligne correspondante.
// 6. Une popup de confirmation rappelle : référence + email user + montant.
//    Si tout matche → admin valide.
// 7. RPC `activate_subscription(p_reference)` :
//      - check is_admin()
//      - met status='active'
//      - set started_at = now()
//      - calcule expires_at selon plan (mensuel = +1mois / annuel = +1an)
//      - log audit + déclenche notif push/email à la cliente
//
// EN CAS DE PROBLÈME
// ------------------
// - Cliente paie mais ref absente → vérifier manuellement le montant +
//   heure, contacter cliente pour récupérer son email, activer via SQL.
// - Annulation : bouton "Annuler" demande la raison (texarea) → RPC
//   `admin_cancel_subscription(p_id, p_reason)`. La cliente garde l'accès
//   jusqu'à expires_at mais ne sera pas re-débitée.
// - Remboursement (si cliente conteste) : bouton "Rembourser" sur les
//   subs cancelled → RPC `admin_refund_subscription(p_id)`. Le remboursement
//   Wave côté banque reste manuel ; le RPC marque juste le statut interne.
// ─────────────────────────────────────────────────────────────────────

const STATUS_META = {
  pending:   { label: 'En attente',  color: 'medium',    emoji: '⏳' },
  active:    { label: 'Active',      color: 'excellent', emoji: '✅' },
  cancelled: { label: 'Annulée',     color: 'bad',       emoji: '🚫' },
  refunded:  { label: 'Remboursée',  color: 'bad',       emoji: '💸' },
  expired:   { label: 'Expirée',     color: 'medium',    emoji: '⌛' },
};

const PLAN_META = {
  monthly: { label: 'Mensuel', color: '#1F8B4C' },
  yearly:  { label: 'Annuel',  color: '#7A2D8C' },
};

const FILTERS = [
  { id: 'pending',   label: '⏳ En attente' },
  { id: 'active',    label: '✅ Actifs' },
  { id: 'cancelled', label: '🚫 Annulés' },
  { id: 'all',       label: 'Tous' },
];

function fmtFCFA(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('fr-FR') + ' FCFA';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.info('Référence copiée');
  } catch {
    toast.error('Copie impossible');
  }
}

export default function SubscriptionsSection() {
  const [filter, setFilter] = useState('pending');
  const [subs, setSubs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null); // id en cours d'action

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        supabase.rpc('admin_list_subscriptions', { p_status: filter }),
        supabase.rpc('admin_subscription_stats'),
      ]);
      if (listRes.error) {
        console.warn('[SubscriptionsSection] list error:', listRes.error.message);
        toast.error('Erreur chargement abonnements : ' + listRes.error.message);
      }
      if (statsRes.error) {
        console.warn('[SubscriptionsSection] stats error:', statsRes.error.message);
      }
      setSubs(Array.isArray(listRes.data) ? listRes.data : []);
      setStats(statsRes.data || null);
    } finally {
      setLoading(false);
    }
  };

  // ─── Actions admin ───────────────────────────────────────────────

  const onActivate = async (sub) => {
    const ref = sub.wave_reference || sub.reference || '—';
    const email = sub.user_email || sub.email || '—';
    const amount = fmtFCFA(sub.amount);
    const ok = await confirmDialog(
      `Activer cet abonnement ?\n\n` +
      `Référence Wave : ${ref}\n` +
      `Cliente : ${email}\n` +
      `Montant : ${amount}\n\n` +
      `Vérifie d'abord dans Wave Business que le paiement est bien reçu.`,
      { confirmLabel: '✅ Activer', cancelLabel: 'Annuler' }
    );
    if (!ok) return;

    setActing(sub.id);
    try {
      const { error } = await supabase.rpc('activate_subscription', { p_reference: ref });
      if (error) {
        toast.error('Activation échouée : ' + error.message);
        return;
      }
      toast.success('Abonnement activé ✅');
      refresh();
    } finally {
      setActing(null);
    }
  };

  const onCancel = async (sub) => {
    const reason = await promptDialog(
      `Motif de l'annulation de l'abonnement de ${sub.user_email || sub.email || 'cette cliente'} ?`,
      {
        multiline: true,
        placeholder: 'Ex : demande cliente, double paiement, fraude…',
        confirmLabel: '🚫 Annuler abonnement',
        cancelLabel: 'Retour',
        danger: true,
        validate: (v) => (v || '').trim().length >= 4,
      }
    );
    if (reason === null) return;

    setActing(sub.id);
    try {
      const { error } = await supabase.rpc('admin_cancel_subscription', {
        p_id: sub.id,
        p_reason: reason.trim(),
      });
      if (error) {
        toast.error('Annulation échouée : ' + error.message);
        return;
      }
      toast.success('Abonnement annulé');
      refresh();
    } finally {
      setActing(null);
    }
  };

  const onRefund = async (sub) => {
    const ok = await confirmDialog(
      `Marquer comme remboursé ?\n\n` +
      `Cliente : ${sub.user_email || sub.email || '—'}\n` +
      `Montant : ${fmtFCFA(sub.amount)}\n\n` +
      `Important : ce bouton met juste le statut à "refunded" en interne. ` +
      `Le virement Wave doit être fait manuellement côté banque.`,
      { confirmLabel: '💸 Confirmer remboursement', cancelLabel: 'Annuler', danger: true }
    );
    if (!ok) return;

    setActing(sub.id);
    try {
      const { error } = await supabase.rpc('admin_refund_subscription', { p_id: sub.id });
      if (error) {
        toast.error('Remboursement échoué : ' + error.message);
        return;
      }
      toast.success('Marqué comme remboursé');
      refresh();
    } finally {
      setActing(null);
    }
  };

  // ─── Stats header ────────────────────────────────────────────────

  const statsInline = useMemo(() => {
    if (!stats) return '';
    const pending = stats.pending_count ?? 0;
    const active  = stats.active_count ?? 0;
    const mrr     = stats.mrr ?? stats.monthly_revenue ?? 0;
    const yearly  = stats.yearly_revenue ?? stats.yearly_count ?? 0;
    return `${pending} en attente · ${active} actifs · MRR ${fmtFCFA(mrr)} · Annuel ${fmtFCFA(yearly)}`;
  }, [stats]);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Abonnements YARAM+</h1>
          <p>{loading ? 'Chargement…' : statsInline || `${subs.length} abonnements`}</p>
        </div>
        <button className="adm-button" onClick={refresh} disabled={loading}>
          🔄 Rafraîchir
        </button>
      </header>

      {/* ─── KPI cards ─── */}
      <div className="adm-kpi-grid" style={{ marginBottom: 16 }}>
        <div className="adm-kpi">
          <div className="adm-kpi-label">EN ATTENTE</div>
          <div className="adm-kpi-value" style={{ color: '#F4B53A' }}>
            {stats?.pending_count ?? 0}
          </div>
          <div className="adm-kpi-meta">à vérifier sur Wave</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">ACTIFS</div>
          <div className="adm-kpi-value" style={{ color: '#1F8B4C' }}>
            {stats?.active_count ?? 0}
          </div>
          <div className="adm-kpi-meta">abonnements en cours</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">MRR</div>
          <div className="adm-kpi-value">
            {fmtFCFA(stats?.mrr ?? stats?.monthly_revenue ?? 0)}
          </div>
          <div className="adm-kpi-meta">revenu mensuel récurrent</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">ANNUEL</div>
          <div className="adm-kpi-value">
            {fmtFCFA(stats?.yearly_revenue ?? 0)}
          </div>
          <div className="adm-kpi-meta">CA abonnements annuels</div>
        </div>
      </div>

      {/* ─── Filtres ─── */}
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

      {/* ─── Table ─── */}
      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : subs.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>💎</div>
          <p>Aucun abonnement</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #ECECEC' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#FAFAFA', borderBottom: '1px solid #ECECEC' }}>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Cliente</th>
                <th style={th}>Plan</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Montant</th>
                <th style={th}>Référence Wave</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map(s => {
                const status = STATUS_META[s.status] || { label: s.status, color: 'medium', emoji: '•' };
                const plan = PLAN_META[s.plan] || { label: s.plan || '—', color: '#666' };
                const ref = s.wave_reference || s.reference || '—';
                const email = s.user_email || s.email || '—';
                const name = s.user_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || '—';
                const isActing = acting === s.id;

                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #F2F2F2' }}>
                    <td style={td}>{fmtDate(s.created_at)}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{name}</div>
                      <div style={{ fontSize: 11, color: '#6B6B6B' }}>{email}</div>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: plan.color + '22',
                          color: plan.color,
                        }}
                      >
                        {plan.label}
                      </span>
                    </td>
                    <td style={td}>
                      <span className={`adm-badge ${status.color}`}>
                        {status.emoji} {status.label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                      {fmtFCFA(s.amount)}
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => copyToClipboard(ref)}
                        title="Cliquer pour copier"
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          background: '#F4F4F4',
                          border: '1px solid #E0E0E0',
                          borderRadius: 6,
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {ref}
                      </button>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {s.status === 'pending' && (
                        <button
                          className="adm-btn-pri"
                          disabled={isActing}
                          onClick={() => onActivate(s)}
                        >
                          {isActing ? '…' : '✅ Activer'}
                        </button>
                      )}
                      {s.status === 'active' && (
                        <button
                          className="adm-btn-danger"
                          disabled={isActing}
                          onClick={() => onCancel(s)}
                        >
                          {isActing ? '…' : '🚫 Annuler'}
                        </button>
                      )}
                      {s.status === 'cancelled' && (
                        <button
                          className="adm-button"
                          disabled={isActing}
                          onClick={() => onRefund(s)}
                        >
                          {isActing ? '…' : '💸 Rembourser'}
                        </button>
                      )}
                      {(s.status === 'refunded' || s.status === 'expired') && (
                        <span style={{ color: '#999', fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  color: '#6B6B6B',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const td = {
  padding: '10px 12px',
  verticalAlign: 'middle',
};
