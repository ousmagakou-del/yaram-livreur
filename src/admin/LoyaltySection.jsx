import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function LoyaltySection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [msg, setMsg] = useState({ text: '', kind: '' });
  const [stats, setStats] = useState({ totalPoints: 0, totalEarned: 0, totalUsers: 0 });

  const flash = (text, kind = 'ok') => {
    setMsg({ text, kind });
    setTimeout(() => setMsg({ text: '', kind: '' }), 3000);
  };

  const refresh = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('users_profile')
      .select('id, first_name, last_name, email, phone, loyalty_points, loyalty_tier, loyalty_total_earned, created_at')
      .order('loyalty_points', { ascending: false })
      .limit(200);

    setUsers(data || []);

    // Stats globales
    const sumPoints = (data || []).reduce((s, u) => s + (u.loyalty_points || 0), 0);
    const sumEarned = (data || []).reduce((s, u) => s + (u.loyalty_total_earned || 0), 0);
    setStats({
      totalPoints: sumPoints,
      totalEarned: sumEarned,
      totalUsers: (data || []).filter(u => (u.loyalty_total_earned || 0) > 0).length,
    });

    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleAdjust = async () => {
    const pts = parseInt(adjustPoints);
    if (!pts || isNaN(pts)) { flash('Points invalides', 'err'); return; }
    if (!adjustReason.trim()) { flash('La raison est obligatoire', 'err'); return; }

    const { data, error } = await supabase.rpc('add_loyalty_points', {
      p_user_id: adjustModal.id,
      p_points: pts,
      p_reason: adjustReason.trim(),
    });

    if (error || !data?.success) {
      flash('Erreur : ' + (error?.message || 'inconnue'), 'err');
      return;
    }

    flash(`${adjustModal.first_name} a maintenant ${data.new_balance} pts`);
    setAdjustModal(null);
    setAdjustPoints('');
    setAdjustReason('');
    refresh();
  };

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      u.first_name?.toLowerCase().includes(s) ||
      u.last_name?.toLowerCase().includes(s) ||
      u.email?.toLowerCase().includes(s) ||
      u.phone?.includes(s)
    );
  });

  const tierBadge = (tier) => {
    const map = {
      bronze: { bg: '#FFE8D5', color: '#8C5A2C', icon: '🥉' },
      silver: { bg: '#E5E9ED', color: '#6B7780', icon: '🥈' },
      gold:   { bg: '#FFF5D5', color: '#A07700', icon: '🏆' },
    };
    const c = map[tier] || map.bronze;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: c.bg, color: c.color,
        padding: '2px 8px', borderRadius: 999,
        fontSize: 11, fontWeight: 700,
      }}>
        {c.icon} {tier?.toUpperCase() || 'BRONZE'}
      </span>
    );
  };

  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Fidélité</h1>
          <p>Gestion des points clientes</p>
        </div>
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
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>Clientes actives</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1A1A1A' }}>{fmt(stats.totalUsers)}</div>
        </div>
        <div style={{ background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>Points en circulation</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1F8B4C' }}>{fmt(stats.totalPoints)}</div>
          <div style={{ fontSize: 11, color: '#9B9B9B' }}>≈ {fmt(Math.floor(stats.totalPoints / 100) * 1000)} FCFA</div>
        </div>
        <div style={{ background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>Total distribué</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#185FA5' }}>{fmt(stats.totalEarned)}</div>
        </div>
      </div>

      <input
        type="search"
        placeholder="🔍 Rechercher par nom, email, téléphone..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          width: '100%', padding: 10, borderRadius: 8,
          border: '1px solid #DDD', fontSize: 14, marginBottom: 14,
          boxSizing: 'border-box', fontFamily: 'inherit',
        }}
      />

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          {search ? `Aucune cliente ne correspond à "${search}"` : 'Aucune cliente'}
        </div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Tier</th>
              <th>Points actuels</th>
              <th>Total gagné</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td>
                  <strong>{u.first_name || ''} {u.last_name || ''}</strong>
                  <div style={{ fontSize: 11, color: '#6B6B6B' }}>{u.email || u.phone || '—'}</div>
                </td>
                <td>{tierBadge(u.loyalty_tier)}</td>
                <td style={{ fontWeight: 700, color: '#1F8B4C' }}>{fmt(u.loyalty_points)} pts</td>
                <td style={{ color: '#6B6B6B' }}>{fmt(u.loyalty_total_earned)} pts</td>
                <td>
                  <button className="adm-btn-sec" onClick={() => setAdjustModal(u)}>
                    ⚙️ Ajuster
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adjustModal && (
        <div className="adm-form-overlay" onClick={() => setAdjustModal(null)}>
          <div className="adm-form-card" onClick={e => e.stopPropagation()}>
            <h3>Ajuster les points</h3>
            <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
              {adjustModal.first_name} {adjustModal.last_name}<br/>
              Solde actuel : <strong>{fmt(adjustModal.loyalty_points)} points</strong>
            </p>

            <label>
              Points (+ pour ajouter, − pour retirer)
              <input
                type="number"
                value={adjustPoints}
                onChange={e => setAdjustPoints(e.target.value)}
                placeholder="Ex: 100 ou -50"
                autoFocus
              />
            </label>

            <label>
              Raison *
              <input
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="Bonus parrainage / Correction / Geste commercial..."
              />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {[10, 50, 100, 500].map(p => (
                <button key={p} className="adm-btn-sec" onClick={() => setAdjustPoints(String(p))}>+{p}</button>
              ))}
              {[-10, -50, -100].map(p => (
                <button key={p} className="adm-btn-sec" onClick={() => setAdjustPoints(String(p))}>{p}</button>
              ))}
            </div>

            <div className="adm-form-actions" style={{ marginTop: 14 }}>
              <button className="adm-btn-sec" onClick={() => { setAdjustModal(null); setAdjustPoints(''); setAdjustReason(''); }}>
                Annuler
              </button>
              <button className="adm-btn-pri" onClick={handleAdjust}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
