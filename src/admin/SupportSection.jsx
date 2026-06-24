import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────
// YARAM — Section admin "Support"
// ─────────────────────────────────────────────────────────────────────
// Layout : 30/70 split sur desktop (liste tickets | chat).
// Sur mobile (≤ 760px) : full width + back button quand un ticket est ouvert.
// Polling : refresh liste + messages toutes les 30s.
// ─────────────────────────────────────────────────────────────────────

const STATUS_META = {
  open:              { label: 'Ouvert',           color: '#1F8B4C', bg: '#1F8B4C22' },
  awaiting_response: { label: 'À traiter',        color: '#F4B53A', bg: '#F4B53A33' },
  awaiting_user:     { label: 'Attente cliente',  color: '#7A2D8C', bg: '#7A2D8C22' },
  resolved:          { label: 'Résolu',           color: '#1F8B4C', bg: '#1F8B4C22' },
  closed:            { label: 'Fermé',            color: '#6B6B6B', bg: '#6B6B6B22' },
};

const STATUS_OPTIONS = ['open', 'awaiting_response', 'awaiting_user', 'resolved', 'closed'];

const FILTERS = [
  { id: 'awaiting_response', label: '⚠️ À traiter' },
  { id: 'open',              label: '💬 Ouverts' },
  { id: 'awaiting_user',     label: '⌛ Attente cliente' },
  { id: 'resolved',          label: '✅ Résolus' },
  { id: 'all',               label: 'Tous' },
];

const POLL_MS = 30000;
const MOBILE_BP = 760;

function fmtRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function initial(name) {
  if (!name) return '?';
  const t = name.trim();
  if (!t) return '?';
  return t.charAt(0).toUpperCase();
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BP);
  useEffect(() => {
    const onR = () => setM(window.innerWidth <= MOBILE_BP);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  return m;
}

export default function SupportSection() {
  const isMobile = useIsMobile();

  const [filter, setFilter]       = useState('awaiting_response');
  const [tickets, setTickets]     = useState([]);
  const [stats, setStats]         = useState(null);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedId, setSelectedId]     = useState(null);
  const [messages, setMessages]         = useState([]);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);
  const [draft, setDraft]               = useState('');
  const [sending, setSending]           = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const scrollRef = useRef(null);
  const pollRef = useRef(null);

  const selectedTicket = useMemo(
    () => tickets.find(t => t.id === selectedId) || null,
    [tickets, selectedId]
  );

  // ─── Refresh liste + stats ───────────────────────────────────────
  const refreshList = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        supabase.rpc('admin_list_tickets', { p_status: filter }),
        supabase.rpc('admin_ticket_stats'),
      ]);
      if (listRes.error) {
        console.warn('[SupportSection] list error:', listRes.error.message);
        if (!silent) toast.error('Erreur chargement tickets : ' + listRes.error.message);
      }
      if (statsRes.error) {
        console.warn('[SupportSection] stats error:', statsRes.error.message);
      }
      setTickets(Array.isArray(listRes.data) ? listRes.data : []);
      setStats(statsRes.data || null);
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [filter]);

  // ─── Refresh messages du ticket sélectionné ──────────────────────
  const refreshMessages = useCallback(async (ticketId, silent = false) => {
    if (!ticketId) return;
    if (!silent) setLoadingMsgs(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_ticket_messages', {
        p_ticket_id: ticketId,
      });
      if (error) {
        console.warn('[SupportSection] messages error:', error.message);
        if (!silent) toast.error('Erreur chargement messages : ' + error.message);
        return;
      }
      setMessages(Array.isArray(data) ? data : []);
    } finally {
      if (!silent) setLoadingMsgs(false);
    }
  }, []);

  // ─── Initial + filter change ─────────────────────────────────────
  useEffect(() => { refreshList(); }, [refreshList]);

  // ─── Selected ticket change ──────────────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    refreshMessages(selectedId);
  }, [selectedId, refreshMessages]);

  // ─── Polling 30s ─────────────────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      refreshList(true);
      if (selectedId) refreshMessages(selectedId, true);
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refreshList, refreshMessages, selectedId]);

  // ─── Auto-scroll chat to bottom on new messages ──────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, selectedId]);

  // ─── Send message ────────────────────────────────────────────────
  const onSend = async () => {
    const content = draft.trim();
    if (!content || !selectedId || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc('admin_send_ticket_message', {
        p_ticket_id: selectedId,
        p_content: content,
        p_admin_name: null,
      });
      if (error) {
        toast.error('Envoi échoué : ' + error.message);
        return;
      }
      setDraft('');
      await Promise.all([
        refreshMessages(selectedId, true),
        refreshList(true),
      ]);
    } finally {
      setSending(false);
    }
  };

  // ─── Change status ───────────────────────────────────────────────
  const onChangeStatus = async (newStatus) => {
    if (!selectedTicket || newStatus === selectedTicket.status) return;
    if (newStatus === 'closed' || newStatus === 'resolved') {
      const ok = await confirmDialog(
        `Confirmer le passage au statut "${STATUS_META[newStatus]?.label || newStatus}" ?`,
        { confirmLabel: 'Oui', cancelLabel: 'Annuler' }
      );
      if (!ok) return;
    }
    setSavingStatus(true);
    try {
      const { error } = await supabase.rpc('admin_update_ticket_status', {
        p_ticket_id: selectedTicket.id,
        p_status: newStatus,
      });
      if (error) {
        toast.error('Statut non mis à jour : ' + error.message);
        return;
      }
      toast.success('Statut mis à jour');
      refreshList(true);
    } finally {
      setSavingStatus(false);
    }
  };

  const onKeyDown = (e) => {
    // Cmd/Ctrl + Enter pour envoyer
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSend();
    }
  };

  // ─── Render: list panel ──────────────────────────────────────────
  const listPanel = (
    <aside style={{
      width: isMobile ? '100%' : '32%',
      minWidth: isMobile ? 'auto' : 280,
      borderRight: isMobile ? 'none' : '1px solid #ECECEC',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      maxHeight: isMobile ? 'auto' : '70vh',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #ECECEC' }}>
        <div className="adm-filters" style={{ margin: 0, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={`adm-filter ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
              style={{ fontSize: 12 }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loadingList ? (
          <div className="adm-empty" style={{ padding: 24 }}>Chargement…</div>
        ) : tickets.length === 0 ? (
          <div className="adm-empty" style={{ padding: 24 }}>
            <div style={{ fontSize: 36, opacity: 0.2 }}>💬</div>
            <p>Aucun ticket</p>
          </div>
        ) : (
          tickets.map(t => {
            const status = STATUS_META[t.status] || { label: t.status, color: '#666', bg: '#6661' };
            const isSel = selectedId === t.id;
            const needsReply = t.status === 'awaiting_response';
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderBottom: '1px solid #F4F4F4',
                  background: isSel ? '#FFF7E6' : 'transparent',
                  border: 'none',
                  borderLeft: isSel ? '3px solid #F4B53A' : '3px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 18,
                  background: '#7A2D8C', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, flexShrink: 0,
                }}>
                  {initial(t.user_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.user_name || 'Cliente'}
                    </strong>
                    <span style={{ fontSize: 10, color: '#999', flexShrink: 0 }}>
                      {fmtRelative(t.last_message_at || t.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#6B6B6B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.user_email || ''}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.subject || '(sans sujet)'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                    {t.category && (
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4,
                        background: '#F4F4F4', color: '#6B6B6B', fontWeight: 600,
                      }}>
                        {t.category}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 4,
                      background: status.bg, color: status.color, fontWeight: 700,
                    }}>
                      {status.label}
                    </span>
                    {needsReply && (
                      <span style={{
                        width: 8, height: 8, borderRadius: 4, background: '#2C7BE5',
                        display: 'inline-block',
                      }} title="Doit répondre" />
                    )}
                  </div>
                  {t.last_message_preview && (
                    <div style={{
                      fontSize: 11, color: '#6B6B6B', marginTop: 4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.last_message_preview}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );

  // ─── Render: chat panel ──────────────────────────────────────────
  const chatPanel = (
    <section style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      background: '#FAFAFA',
      maxHeight: isMobile ? 'auto' : '70vh',
    }}>
      {!selectedTicket ? (
        <div className="adm-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 48, opacity: 0.2 }}>👈</div>
          <p>Sélectionne un ticket à gauche</p>
        </div>
      ) : (
        <>
          {/* ─── Header ticket ─── */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #ECECEC',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            {isMobile && (
              <button
                className="adm-button"
                onClick={() => setSelectedId(null)}
                style={{ padding: '4px 10px' }}
              >
                ← Retour
              </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedTicket.subject || '(sans sujet)'}
              </div>
              <div style={{ fontSize: 11, color: '#6B6B6B' }}>
                {selectedTicket.user_name} · {selectedTicket.user_email}
                {selectedTicket.user_phone ? ` · ${selectedTicket.user_phone}` : ''}
                {selectedTicket.order_id ? ` · Cmd ${selectedTicket.order_id}` : ''}
              </div>
            </div>
            <select
              value={selectedTicket.status}
              disabled={savingStatus}
              onChange={(e) => onChangeStatus(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #DDD',
                background: STATUS_META[selectedTicket.status]?.bg || '#fff',
                color: STATUS_META[selectedTicket.status]?.color || '#000',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
              ))}
            </select>
          </div>

          {/* ─── Messages ─── */}
          <div ref={scrollRef} style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 280,
          }}>
            {loadingMsgs ? (
              <div className="adm-empty">Chargement…</div>
            ) : messages.length === 0 ? (
              <div className="adm-empty">Aucun message</div>
            ) : (
              messages.map(m => {
                const isAdmin  = m.sender_type === 'admin';
                const isSystem = m.sender_type === 'system';
                const align    = isSystem ? 'center' : isAdmin ? 'flex-end' : 'flex-start';
                const bg       = isSystem ? '#ECECEC' : isAdmin ? '#7A2D8C' : '#fff';
                const fg       = isSystem ? '#6B6B6B' : isAdmin ? '#fff' : '#1A1A1A';
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: align }}>
                    <div style={{
                      maxWidth: isSystem ? '90%' : '78%',
                      padding: isSystem ? '6px 12px' : '10px 14px',
                      borderRadius: isSystem ? 12 : 14,
                      background: bg,
                      color: fg,
                      border: !isAdmin && !isSystem ? '1px solid #ECECEC' : 'none',
                      boxShadow: isSystem ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
                      fontSize: isSystem ? 11 : 13,
                      textAlign: isSystem ? 'center' : 'left',
                    }}>
                      {!isSystem && (
                        <div style={{
                          fontSize: 10,
                          fontWeight: 700,
                          opacity: 0.7,
                          marginBottom: 4,
                        }}>
                          {m.sender_name || (isAdmin ? 'Admin' : 'Cliente')} · {fmtTime(m.created_at)}
                        </div>
                      )}
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {m.content}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ─── Input ─── */}
          <div style={{
            borderTop: '1px solid #ECECEC',
            padding: 12,
            background: '#fff',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
          }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Écris ta réponse… (⌘+Entrée pour envoyer)"
              rows={2}
              disabled={selectedTicket.status === 'closed'}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #DDD',
                fontSize: 13,
                resize: 'vertical',
                fontFamily: 'inherit',
                minHeight: 40,
              }}
            />
            <button
              className="adm-btn-pri"
              disabled={sending || !draft.trim() || selectedTicket.status === 'closed'}
              onClick={onSend}
              style={{ height: 40 }}
            >
              {sending ? '…' : 'Envoyer'}
            </button>
          </div>
        </>
      )}
    </section>
  );

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Support clientes</h1>
          <p>
            {stats
              ? `${stats.open || 0} ouverts · ${stats.awaiting_response || 0} à traiter · ${stats.resolved || 0} résolus · ${stats.today_new || 0} aujourd'hui`
              : 'Chargement…'}
          </p>
        </div>
        <button className="adm-button" onClick={() => { refreshList(); if (selectedId) refreshMessages(selectedId); }}>
          🔄 Rafraîchir
        </button>
      </header>

      {/* KPIs */}
      <div className="adm-kpi-grid" style={{ marginBottom: 16 }}>
        <div className="adm-kpi">
          <div className="adm-kpi-label">À TRAITER</div>
          <div className="adm-kpi-value" style={{ color: '#F4B53A' }}>{stats?.awaiting_response ?? 0}</div>
          <div className="adm-kpi-meta">tickets en attente de réponse</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">OUVERTS</div>
          <div className="adm-kpi-value">{stats?.open ?? 0}</div>
          <div className="adm-kpi-meta">conversations en cours</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">RÉSOLUS</div>
          <div className="adm-kpi-value" style={{ color: '#1F8B4C' }}>{stats?.resolved ?? 0}</div>
          <div className="adm-kpi-meta">total clos avec succès</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi-label">AUJOURD'HUI</div>
          <div className="adm-kpi-value">{stats?.today_new ?? 0}</div>
          <div className="adm-kpi-meta">nouveaux tickets du jour</div>
        </div>
      </div>

      {/* Split layout */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        border: '1px solid #ECECEC',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#fff',
        minHeight: 480,
      }}>
        {isMobile
          ? (selectedId ? chatPanel : listPanel)
          : (<>{listPanel}{chatPanel}</>)}
      </div>
    </div>
  );
}
