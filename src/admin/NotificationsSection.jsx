import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { confirmDialog } from '../lib/toast';

const TEMPLATE_LABELS = {
  welcome: { icon: '🎉', label: 'Bienvenue', desc: 'À l\'inscription' },
  review_reminder: { icon: '⭐', label: 'Demande d\'avis', desc: '1 jour après livraison' },
  cart_abandoned: { icon: '🛒', label: 'Panier oublié', desc: '24h après ajout sans cmd' },
  loyalty_milestone_500: { icon: '🥈', label: 'Palier Silver', desc: '500 points atteints' },
  loyalty_milestone_1000: { icon: '⭐', label: 'Palier 1000', desc: '1000 points atteints' },
  loyalty_milestone_2000: { icon: '🏆', label: 'Palier Gold', desc: '2000 points atteints' },
  loyalty_milestone_5000: { icon: '💎', label: 'Palier 5000', desc: '5000 points atteints' },
  // Templates existants Diaara
  driverAssigned: { icon: '🛵', label: 'Livreur assigné', desc: 'Au moment du dispatch' },
  orderCreatedDigital: { icon: '💳', label: 'Commande digitale créée', desc: 'Confirmation' },
  orderCreatedCash: { icon: '💵', label: 'Commande cash créée', desc: 'Confirmation COD' },
  orderShipped: { icon: '🛵', label: 'Commande en route', desc: 'Status shipped' },
  orderAwaitingConfirm: { icon: '⏳', label: 'Confirmation livraison', desc: 'Demande de confirmation cliente' },
  orderDelivered: { icon: '✅', label: 'Commande livrée', desc: 'Notification finale' },
};

export default function NotificationsSection() {
  const [stats, setStats] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });

  const flash = (text, kind = 'ok') => {
    setMsg({ text, kind });
    setTimeout(() => setMsg({ text: '', kind: '' }), 4000);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [statsRes, recentRes] = await Promise.all([
        supabase.from('whatsapp_stats').select('*'),
        supabase.from('whatsapp_log').select('*').order('sent_at', { ascending: false }).limit(50),
      ]);
      if (statsRes.error) console.warn('[NotificationsSection] whatsapp_stats:', statsRes.error.message);
      if (recentRes.error) console.warn('[NotificationsSection] whatsapp_log:', recentRes.error.message);
      setStats(statsRes.data || []);
      setRecent(recentRes.data || []);
    } catch (e) {
      console.warn('[NotificationsSection] refresh failed:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleSendReviewReminders = async () => {
    if (!await confirmDialog('Envoyer les rappels d\'avis pour toutes les commandes livrées hier ?\n\nUn WhatsApp sera envoyé à chaque cliente.')) return;
    
    setReminderLoading(true);
    try {
      const { data: orders, error } = await supabase
        .from('orders_pending_review')
        .select('*')
        .eq('reminder_sent', false);
      
      if (error) {
        flash('Erreur lecture orders: ' + error.message, 'err');
        setReminderLoading(false);
        return;
      }

      if (!orders || orders.length === 0) {
        flash('Aucune commande sans avis à notifier', 'err');
        setReminderLoading(false);
        return;
      }

      // Import dynamique du helper
      const { notifyReviewReminder } = await import('../lib/notifications');

      let sent = 0, failed = 0, skipped = 0;
      for (const o of orders) {
        if (!o.client_phone) { skipped++; continue; }
        const firstName = (o.client_name || 'toi').split(' ')[0];
        try {
          const r = await notifyReviewReminder({
            userId: o.user_id,
            phone: o.client_phone,
            firstName,
            orderId: o.id,
          });
          if (r?.sent) sent++;
          else if (r?.skipped) skipped++;
          else failed++;
        } catch (e) {
          failed++;
        }
        // Petite pause pour pas surcharger
        await new Promise(r => setTimeout(r, 200));
      }

      flash(`✓ ${sent} envoyés / ${failed} échecs / ${skipped} skip (${orders.length} cmds éligibles)`);
      refresh();
    } catch (e) {
      flash('Erreur: ' + e.message, 'err');
    }
    setReminderLoading(false);
  };

  const totalSent = stats.reduce((s, t) => s + (t.sent_count || 0), 0);
  const totalLast24h = stats.reduce((s, t) => s + (t.last_24h || 0), 0);
  const totalLast7d = stats.reduce((s, t) => s + (t.last_7d || 0), 0);
  const totalFailed = stats.reduce((s, t) => s + (t.failed_count || 0), 0);

  const formatDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Notifications WhatsApp</h1>
          <p>Suivi des messages envoyés automatiquement aux clientes</p>
        </div>
        <button 
          className="adm-btn-pri" 
          onClick={handleSendReviewReminders}
          disabled={reminderLoading}
        >
          {reminderLoading ? '⏳ Envoi...' : '⭐ Envoyer rappels d\'avis maintenant'}
        </button>
      </header>

      {msg.text && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 12,
          background: msg.kind === 'err' ? '#FCE9E7' : '#E8F5EC',
          color: msg.kind === 'err' ? '#D9342B' : '#1F8B4C',
        }}>{msg.text}</div>
      )}

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>Total envoyés</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1A1A1A' }}>{totalSent}</div>
        </div>
        <div style={{ background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>24 dernières heures</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1F8B4C' }}>{totalLast24h}</div>
        </div>
        <div style={{ background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>7 derniers jours</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#185FA5' }}>{totalLast7d}</div>
        </div>
        <div style={{ background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>Échecs total</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: totalFailed > 0 ? '#D9342B' : '#1A1A1A' }}>{totalFailed}</div>
        </div>
      </div>

      {/* Stats par template */}
      <div style={{
        background: 'white', border: '1px solid #EEE', borderRadius: 14, marginBottom: 16, overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #EEE', fontWeight: 800, fontSize: 14 }}>
          📊 Par type de notification
        </div>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9B9B9B' }}>Chargement…</div>
        ) : stats.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9B9B9B' }}>
            Aucun WhatsApp envoyé pour l'instant. Les notifs se déclencheront automatiquement quand les clientes s'inscriront / commanderont.
          </div>
        ) : (
          <table className="adm-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Total</th>
                <th>24h</th>
                <th>7j</th>
                <th>Échecs</th>
                <th>Dernier envoi</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(t => {
                const info = TEMPLATE_LABELS[t.template] || { icon: '💬', label: t.template, desc: '' };
                return (
                  <tr key={t.template}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{info.icon}</span>
                        <div>
                          <strong>{info.label}</strong>
                          <div style={{ fontSize: 11, color: '#6B6B6B' }}>{info.desc}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>{t.sent_count}</td>
                    <td>{t.last_24h}</td>
                    <td>{t.last_7d}</td>
                    <td style={{ color: t.failed_count > 0 ? '#D9342B' : '#9B9B9B' }}>{t.failed_count}</td>
                    <td style={{ fontSize: 12, color: '#6B6B6B' }}>{formatDate(t.last_sent_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Log récent */}
      <div style={{
        background: 'white', border: '1px solid #EEE', borderRadius: 14, overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #EEE', fontWeight: 800, fontSize: 14 }}>
          📜 50 derniers envois
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9B9B9B' }}>Aucun envoi</div>
        ) : (
          <table className="adm-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Téléphone</th>
                <th>Template</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => {
                const info = TEMPLATE_LABELS[r.template] || { icon: '💬', label: r.template };
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12, color: '#6B6B6B' }}>{formatDate(r.sent_at)}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.phone}</td>
                    <td>
                      <span style={{ fontSize: 13 }}>{info.icon} {info.label}</span>
                    </td>
                    <td>
                      {r.status === 'sent' ? (
                        <span className="adm-badge good">✓ Envoyé</span>
                      ) : (
                        <span className="adm-badge danger" title={r.error}>✗ Échec</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
