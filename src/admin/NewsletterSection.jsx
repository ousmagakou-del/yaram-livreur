import { useState, useEffect, useMemo } from 'react';
import { toast, confirmDialog } from '../lib/toast';
import {
  listNewsletterSubscribers,
  getNewsletterStats,
  sendNewsletter,
} from '../lib/newsletterAdmin';
import { adminLogAction } from '../lib/adminApi';

// ─── Templates prêts-à-l'emploi (style YARAM, vert #1F8B4C) ────
const TEMPLATES = [
  {
    id: 'promo',
    label: '🔥 Promo flash',
    audience: 'promos',
    subject: '🔥 -15% sur tout le maquillage — code YARAM15',
    html: `
<div style="font-family:-apple-system,system-ui,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A;">
  <div style="background:linear-gradient(135deg,#1F8B4C 0%,#0E5B33 100%);padding:32px 24px;border-radius:14px 14px 0 0;text-align:center">
    <h1 style="color:white;font-size:28px;margin:0;font-weight:800;letter-spacing:-0.5px">🔥 Promo flash !</h1>
    <p style="color:rgba(255,255,255,0.9);font-size:15px;margin:6px 0 0">-15% sur tout le maquillage</p>
  </div>
  <div style="padding:28px 24px;background:#FFF;border:1px solid #EEE;border-top:none;border-radius:0 0 14px 14px">
    <p style="font-size:16px;line-height:1.6;margin:0 0 16px">Salut beauté ! ✨</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Pendant 24h chrono, profite de <strong style="color:#1F8B4C">-15%</strong> sur tout le maquillage validé par nos dermatos.</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px">Code à entrer au checkout :</p>
    <div style="background:#E8F5EC;border:2px dashed #1F8B4C;padding:18px;text-align:center;border-radius:10px;margin:0 0 24px">
      <span style="font-size:24px;font-weight:800;color:#1F8B4C;letter-spacing:3px">YARAM15</span>
    </div>
    <p style="text-align:center;margin:0 0 8px"><a href="https://yaram.app/?route=search&category=maquillage" style="background:#1F8B4C;color:white;padding:14px 32px;border-radius:30px;text-decoration:none;font-weight:700;display:inline-block">Shopper maintenant →</a></p>
    <p style="font-size:12px;color:#888;text-align:center;margin:24px 0 0">Offre valable 24h, cumulable avec la fidélité YARAM 💚</p>
  </div>
</div>`,
  },
  {
    id: 'nouveaute',
    label: '🆕 Nouveauté',
    audience: 'nouveautes',
    subject: '🆕 La nouveauté qu\'on a chinée pour toi',
    html: `
<div style="font-family:-apple-system,system-ui,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#FFF;padding:28px 24px;text-align:center;border-radius:14px;border:1px solid #EEE">
    <h1 style="font-size:26px;margin:0 0 6px;font-weight:800;color:#0E5B33">🆕 Du nouveau chez YARAM</h1>
    <p style="font-size:14px;color:#666;margin:0 0 22px">Validé par nos dermatos — disponible aujourd'hui</p>
    <p style="font-size:15px;line-height:1.7;text-align:left;margin:0 0 22px">[Décris ici le nouveau produit : marque, bénéfice principal, pour quel type de peau.]</p>
    <a href="https://yaram.app" style="background:#1F8B4C;color:white;padding:14px 32px;border-radius:30px;text-decoration:none;font-weight:700;display:inline-block">Découvrir →</a>
  </div>
</div>`,
  },
  {
    id: 'conseil',
    label: '✨ Conseil beauté',
    audience: 'conseils',
    subject: '✨ Le conseil beauté YARAM de la semaine',
    html: `
<div style="font-family:-apple-system,system-ui,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A;">
  <div style="padding:28px 24px;background:#FFF;border-radius:14px;border:1px solid #EEE">
    <span style="display:inline-block;background:#E8F5EC;color:#1F8B4C;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:14px">CONSEIL DERMATO</span>
    <h1 style="font-size:24px;margin:0 0 12px;font-weight:800;line-height:1.2">[Titre du conseil]</h1>
    <p style="font-size:15px;line-height:1.7;margin:0 0 14px">[Première règle d'or, exemple : appliquer ton sérum sur peau légèrement humide pour une meilleure pénétration.]</p>
    <p style="font-size:15px;line-height:1.7;margin:0 0 14px">[Deuxième règle d'or.]</p>
    <p style="font-size:15px;line-height:1.7;margin:0 0 20px">[Troisième règle d'or.]</p>
    <a href="https://yaram.app/scan" style="background:#1F8B4C;color:white;padding:12px 26px;border-radius:30px;text-decoration:none;font-weight:700;display:inline-block">Faire mon scan IA →</a>
  </div>
</div>`,
  },
  {
    id: 'event',
    label: '🎉 Événement',
    audience: 'evenements',
    subject: '🎉 RDV YARAM — date à retenir',
    html: `
<div style="font-family:-apple-system,system-ui,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A;">
  <div style="background:linear-gradient(135deg,#FFE4B5 0%,#FFD27F 100%);padding:28px 24px;border-radius:14px 14px 0 0;text-align:center">
    <h1 style="font-size:26px;margin:0;font-weight:800;color:#0E5B33">🎉 Save the date</h1>
  </div>
  <div style="padding:28px 24px;background:#FFF;border:1px solid #EEE;border-top:none;border-radius:0 0 14px 14px">
    <p style="font-size:15px;line-height:1.7;margin:0 0 16px">Salut beauté !</p>
    <p style="font-size:15px;line-height:1.7;margin:0 0 16px">[Annonce ici l'événement : pop-up, masterclass, soirée tirage au sort, lancement…]</p>
    <p style="font-size:16px;font-weight:700;text-align:center;background:#F4F4F2;padding:14px;border-radius:10px;margin:0 0 22px">📅 [Date] · 📍 [Lieu / lien]</p>
    <p style="text-align:center"><a href="https://yaram.app" style="background:#1F8B4C;color:white;padding:14px 32px;border-radius:30px;text-decoration:none;font-weight:700;display:inline-block">Je viens !</a></p>
  </div>
</div>`,
  },
];

const AUDIENCE_LABEL = {
  all: '👥 Tous les abonnés',
  promos: '🔥 Promos',
  nouveautes: '🆕 Nouveautés',
  conseils: '✨ Conseils beauté',
  evenements: '🎉 Événements',
};

export default function NewsletterSection() {
  // ─── State ───────────────────────────────
  const [tab, setTab] = useState('compose'); // 'compose' | 'subscribers' | 'history'

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [subs, setSubs] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsFilter, setSubsFilter] = useState('active');
  const [search, setSearch] = useState('');

  // Compose
  const [subject, setSubject]   = useState('');
  const [html, setHtml]         = useState('');
  const [audience, setAudience] = useState('all');
  const [testEmail, setTestEmail] = useState('');
  const [sending, setSending]     = useState(false);
  const [preview, setPreview]     = useState(false);
  const [lastResult, setLastResult] = useState(null);

  // ─── Load stats au mount + après envoi ───
  const refreshStats = async () => {
    setStatsLoading(true);
    const { data, error } = await getNewsletterStats();
    if (error) toast.error('Stats : ' + error);
    setStats(data);
    setStatsLoading(false);
  };

  useEffect(() => {
    refreshStats();
  }, []);

  // ─── Load subs quand onglet "subscribers" ─
  useEffect(() => {
    if (tab !== 'subscribers') return;
    let cancel = false;
    (async () => {
      setSubsLoading(true);
      const { data, error } = await listNewsletterSubscribers({ status: subsFilter, limit: 1000 });
      if (cancel) return;
      if (error) toast.error('Abonnés : ' + error);
      setSubs(data);
      setSubsLoading(false);
    })();
    return () => { cancel = true; };
  }, [tab, subsFilter]);

  // ─── Filter local des subs par search ──
  const subsFiltered = useMemo(() => {
    if (!search.trim()) return subs;
    const q = search.toLowerCase();
    return subs.filter(s => (s.email || '').toLowerCase().includes(q));
  }, [subs, search]);

  // ─── Audience target count ──────────────
  const targetCount = useMemo(() => {
    if (!stats) return null;
    if (audience === 'all') return stats.active || 0;
    return stats[audience] || 0;
  }, [stats, audience]);

  // ─── Apply template ─────────────────────
  const applyTemplate = (id) => {
    const t = TEMPLATES.find(x => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setHtml(t.html.trim());
    setAudience(t.audience);
    setPreview(false);
    toast.success(`Template "${t.label}" appliqué`);
  };

  // ─── Envoi ──────────────────────────────
  const handleSendTest = async () => {
    if (!subject.trim() || !html.trim()) return toast.error('Sujet + HTML requis');
    if (!testEmail.trim()) return toast.error('Adresse email de test requise');

    setSending(true);
    const res = await sendNewsletter({
      subject: subject.trim(),
      html: html.trim(),
      audience,
      testTo: testEmail.trim(),
    });
    setSending(false);
    setLastResult(res);

    if (res?.ok || res?.sent > 0) {
      toast.success(`✅ Test envoyé à ${testEmail.trim()}`);
    } else {
      toast.error('Échec : ' + (res?.error || 'inconnu'));
    }
  };

  const handleSendAll = async () => {
    if (!subject.trim() || !html.trim()) return toast.error('Sujet + HTML requis');
    if (!targetCount) return toast.error(`0 abonné dans l'audience "${AUDIENCE_LABEL[audience]}"`);

    const ok = await confirmDialog(
      `📧 ENVOI MASSE NEWSLETTER\n\n` +
      `Audience : ${AUDIENCE_LABEL[audience]}\n` +
      `Destinataires : ${targetCount} abonné·es\n` +
      `Sujet : ${subject}\n\n` +
      `⚠️ Action irréversible. Les emails partent immédiatement via Resend.`
    );
    if (!ok) return;

    setSending(true);
    setLastResult(null);

    adminLogAction({
      action:     'send_newsletter',
      targetType: 'newsletter',
      targetId:   null,
      before:     null,
      after:      { subject, audience, target_count: targetCount },
    }).catch(() => {});

    const res = await sendNewsletter({
      subject: subject.trim(),
      html: html.trim(),
      audience,
    });
    setSending(false);
    setLastResult(res);

    if (res?.ok && res?.sent > 0) {
      toast.success(`✅ ${res.sent} email${res.sent > 1 ? 's' : ''} envoyé${res.sent > 1 ? 's' : ''} (${res.failed || 0} échec${res.failed > 1 ? 's' : ''})`);
      refreshStats();
    } else {
      toast.error('Échec : ' + (res?.error || 'inconnu'));
    }
  };

  // ─── Export CSV ────────────────────────
  const exportCsv = () => {
    if (!subsFiltered.length) return toast.error('Rien à exporter');
    const header = 'email,subscribed_at,source,promos,nouveautes,conseils,evenements\n';
    const rows = subsFiltered.map(s => {
      const p = s.preferences || {};
      return [
        s.email,
        s.subscribed_at || '',
        s.source || '',
        p.promos ? '1' : '0',
        p.nouveautes ? '1' : '0',
        p.conseils ? '1' : '0',
        p.evenements ? '1' : '0',
      ].join(',');
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newsletter-${subsFilter}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`📁 ${subsFiltered.length} abonné${subsFiltered.length > 1 ? 's' : ''} exporté${subsFiltered.length > 1 ? 's' : ''}`);
  };

  // ─── UI ─────────────────────────────────
  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>📬 Newsletter</h1>
          <p>Composer, envoyer et gérer la newsletter YARAM</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adm-btn-sec" onClick={refreshStats} disabled={statsLoading}>
            🔄 Rafraîchir
          </button>
        </div>
      </header>

      {/* ─── Cards stats ─────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 20,
      }}>
        {[
          { label: '✅ Actifs',     val: stats?.active     ?? '—', color: '#1F8B4C' },
          { label: '🔥 Promos',     val: stats?.promos     ?? '—', color: '#E14' },
          { label: '🆕 Nouveautés', val: stats?.nouveautes ?? '—', color: '#0070F3' },
          { label: '✨ Conseils',   val: stats?.conseils   ?? '—', color: '#9333EA' },
          { label: '7 derniers j.', val: stats?.last_7d    ?? '—', color: '#666' },
          { label: '30 derniers j.',val: stats?.last_30d   ?? '—', color: '#666' },
        ].map(c => (
          <div key={c.label} style={{
            background: 'white',
            borderRadius: 12,
            padding: 14,
            border: '1px solid #EFEFEF',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.color }}>
              {statsLoading ? '…' : c.val}
            </div>
          </div>
        ))}
      </div>

      {/* ─── Tabs ────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid #F4F4F2' }}>
        {[
          { id: 'compose',     label: '✍️ Composer' },
          { id: 'subscribers', label: '👥 Abonnés' },
          { id: 'history',     label: '📜 Historique' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #1F8B4C' : '2px solid transparent',
              marginBottom: -2,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? '#1F8B4C' : '#666',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════ COMPOSE ════════════ */}
      {tab === 'compose' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
          <div>
            {/* Templates */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Templates rapides
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyTemplate(t.id)}
                    style={{
                      padding: '8px 14px',
                      background: '#F4F4F2',
                      border: '1px solid #EAEAEA',
                      borderRadius: 20,
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sujet */}
            <label style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Sujet ({subject.length}/120)
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Ex : 🔥 -15% sur tout le maquillage"
              maxLength={120}
              style={{
                width: '100%', padding: 12, fontSize: 15,
                border: '1px solid #DDD', borderRadius: 8,
                boxSizing: 'border-box', marginTop: 6, marginBottom: 16,
              }}
            />

            {/* HTML body / Preview */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Corps HTML
              </label>
              <button
                onClick={() => setPreview(p => !p)}
                style={{ background: 'transparent', border: 'none', color: '#1F8B4C', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
              >
                {preview ? '✏️ Éditer' : '👁️ Aperçu'}
              </button>
            </div>

            {preview ? (
              <div style={{
                border: '1px solid #DDD', borderRadius: 8, padding: 16,
                background: '#FAFAFA', minHeight: 320,
                maxHeight: 500, overflow: 'auto',
              }}>
                <div dangerouslySetInnerHTML={{ __html: html || '<em style="color:#999">Aperçu vide</em>' }} />
              </div>
            ) : (
              <textarea
                value={html}
                onChange={e => setHtml(e.target.value)}
                placeholder="<div>Ton HTML ici... ou clique sur un template au-dessus</div>"
                style={{
                  width: '100%', padding: 12, fontSize: 13,
                  border: '1px solid #DDD', borderRadius: 8,
                  boxSizing: 'border-box', minHeight: 320,
                  fontFamily: 'ui-monospace, SF Mono, monospace',
                  resize: 'vertical',
                }}
              />
            )}

            {/* Résultat dernier envoi */}
            {lastResult && (
              <div style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 10,
                background: lastResult.ok ? '#E8F5EC' : '#FCE9E7',
                borderLeft: `4px solid ${lastResult.ok ? '#1F8B4C' : '#D9342B'}`,
              }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>
                  {lastResult.ok ? '✅ Envoi terminé' : '❌ Échec'}
                </strong>
                {lastResult.ok ? (
                  <div style={{ fontSize: 13, color: '#333' }}>
                    Destinataires : <strong>{lastResult.recipients || 0}</strong> ·
                    Envoyés : <strong>{lastResult.sent || 0}</strong> ·
                    Échecs : <strong>{lastResult.failed || 0}</strong>
                    {lastResult.test && ' (mode test)'}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#C00' }}>{lastResult.error || JSON.stringify(lastResult)}</div>
                )}
              </div>
            )}
          </div>

          {/* ─── Sidebar envoi ────────── */}
          <div style={{
            background: 'white', borderRadius: 12, padding: 16,
            border: '1px solid #EFEFEF',
            position: 'sticky', top: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Audience
            </div>
            <select
              value={audience}
              onChange={e => setAudience(e.target.value)}
              style={{
                width: '100%', padding: 10, fontSize: 14,
                border: '1px solid #DDD', borderRadius: 8,
                boxSizing: 'border-box', marginBottom: 4,
              }}
            >
              {Object.entries(AUDIENCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 16, paddingLeft: 4 }}>
              {targetCount === null
                ? 'Chargement…'
                : <>Cible : <strong>{targetCount}</strong> abonné{targetCount > 1 ? 's' : ''}</>}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Test (1 envoi)
            </div>
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="ton@email.com"
              style={{
                width: '100%', padding: 10, fontSize: 13,
                border: '1px solid #DDD', borderRadius: 8,
                boxSizing: 'border-box', marginBottom: 8,
              }}
            />
            <button
              onClick={handleSendTest}
              disabled={sending}
              style={{
                width: '100%', padding: 10, marginBottom: 16,
                background: '#F4F4F2', border: '1px solid #EAEAEA',
                borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13,
              }}
            >
              {sending ? 'Envoi…' : '🧪 Envoyer un test'}
            </button>

            <button
              onClick={handleSendAll}
              disabled={sending || !targetCount}
              style={{
                width: '100%', padding: 14,
                background: sending || !targetCount ? '#999' : 'linear-gradient(135deg,#1F8B4C 0%,#0E5B33 100%)',
                color: 'white', border: 'none',
                borderRadius: 10, fontWeight: 800, cursor: sending || !targetCount ? 'not-allowed' : 'pointer',
                fontSize: 15, boxShadow: '0 4px 12px rgba(31,139,76,0.25)',
              }}
            >
              {sending
                ? 'Envoi en cours…'
                : `📧 Envoyer à ${targetCount ?? '?'} abonné${(targetCount ?? 0) > 1 ? 's' : ''}`}
            </button>
            <p style={{ fontSize: 11, color: '#999', marginTop: 10, lineHeight: 1.4 }}>
              Envoi via Resend depuis <code>hello@yaram.app</code>. Footer de désabonnement ajouté automatiquement.
            </p>
          </div>
        </div>
      )}

      {/* ════════════ SUBSCRIBERS ════════════ */}
      {tab === 'subscribers' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {['active', 'unsubscribed', 'all'].map(f => (
              <button
                key={f}
                onClick={() => setSubsFilter(f)}
                style={{
                  padding: '8px 14px',
                  background: subsFilter === f ? '#1F8B4C' : '#F4F4F2',
                  color: subsFilter === f ? 'white' : '#333',
                  border: 'none', borderRadius: 20, fontSize: 13,
                  fontWeight: subsFilter === f ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {f === 'active' ? '✅ Actifs' : f === 'unsubscribed' ? '🚫 Désabonnés' : '👥 Tous'}
              </button>
            ))}
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Recherche email…"
              style={{
                marginLeft: 'auto', padding: '8px 12px',
                border: '1px solid #DDD', borderRadius: 8,
                fontSize: 13, minWidth: 220,
              }}
            />
            <button className="adm-btn-sec" onClick={exportCsv} disabled={!subsFiltered.length}>
              📁 Export CSV
            </button>
          </div>

          {subsLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement…</div>
          ) : subsFiltered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
              {search ? 'Aucun résultat' : 'Aucun abonné dans cette catégorie'}
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #EFEFEF', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#FAFAFA', textAlign: 'left' }}>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Préférences</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Inscrit</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {subsFiltered.map(s => {
                    const p = s.preferences || {};
                    const tags = [
                      p.promos      && '🔥',
                      p.nouveautes  && '🆕',
                      p.conseils    && '✨',
                      p.evenements  && '🎉',
                    ].filter(Boolean);
                    return (
                      <tr key={s.id} style={{ borderTop: '1px solid #F4F4F2' }}>
                        <td style={{ padding: 12, fontWeight: 500 }}>{s.email}</td>
                        <td style={{ padding: 12, fontSize: 16 }}>{tags.length ? tags.join(' ') : <span style={{ color: '#CCC' }}>—</span>}</td>
                        <td style={{ padding: 12, color: '#666' }}>{s.source || '—'}</td>
                        <td style={{ padding: 12, color: '#666' }}>
                          {s.subscribed_at ? new Date(s.subscribed_at).toLocaleDateString('fr-FR') : '—'}
                        </td>
                        <td style={{ padding: 12 }}>
                          {s.unsubscribed_at
                            ? <span style={{ background: '#FCE9E7', color: '#D9342B', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>Désabonné</span>
                            : <span style={{ background: '#E8F5EC', color: '#1F8B4C', padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>Actif</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: '#999', marginTop: 10 }}>
            {subsFiltered.length} affiché{subsFiltered.length > 1 ? 's' : ''} sur {subs.length} chargé{subs.length > 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* ════════════ HISTORY ════════════ */}
      {tab === 'history' && (
        <div>
          {!stats?.history?.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
              Aucune campagne envoyée pour le moment.
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #EFEFEF', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#FAFAFA', textAlign: 'left' }}>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Date</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Sujet</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Audience</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Cible</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>OK</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>KO</th>
                    <th style={{ padding: 12, fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.history.map(h => (
                    <tr key={h.id} style={{ borderTop: '1px solid #F4F4F2' }}>
                      <td style={{ padding: 12, color: '#666' }}>
                        {h.sent_at ? new Date(h.sent_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td style={{ padding: 12, fontWeight: 600 }}>{h.subject}</td>
                      <td style={{ padding: 12 }}>{AUDIENCE_LABEL[h.audience] || h.audience}</td>
                      <td style={{ padding: 12 }}>{h.recipients}</td>
                      <td style={{ padding: 12, color: '#1F8B4C', fontWeight: 700 }}>{h.ok_count}</td>
                      <td style={{ padding: 12, color: h.err_count > 0 ? '#D9342B' : '#999', fontWeight: h.err_count > 0 ? 700 : 400 }}>{h.err_count}</td>
                      <td style={{ padding: 12, color: '#666', fontSize: 12 }}>{h.admin_email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
