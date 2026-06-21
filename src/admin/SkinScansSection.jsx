import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { adminUsersStats } from '../lib/adminApi';

const DAY = 24 * 60 * 60 * 1000;

export default function SkinScansSection() {
  const [scans, setScans] = useState([]);
  const [usersCount, setUsersCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('all');
  const [skinFilter, setSkinFilter] = useState('all');

  // ─── Chargement ───
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [scansRes, statsRes] = await Promise.all([
        supabase
          .from('skin_scans')
          .select('id, user_id, skin_type, skin_score, diagnosis, created_at')
          .order('created_at', { ascending: false }),
        adminUsersStats(),
      ]);
      setScans(scansRes.data || []);
      setUsersCount(statsRes.data?.total ?? null);
      setLoading(false);
    })();
  }, []);

  // ─── Filtres ───
  const cutoffMs = useMemo(() => {
    if (period === 'all') return 0;
    const days = { '7d': 7, '30d': 30, '90d': 90, 'year': 365 }[period] || 0;
    return Date.now() - days * DAY;
  }, [period]);

  const filteredScans = useMemo(() => {
    return scans.filter(s => {
      if (cutoffMs && new Date(s.created_at).getTime() < cutoffMs) return false;
      if (skinFilter !== 'all') {
        const t = (s.skin_type || s.diagnosis?.skin_type || '').toLowerCase();
        if (t !== skinFilter) return false;
      }
      return true;
    });
  }, [scans, cutoffMs, skinFilter]);

  // ─── KPI globaux ───
  const kpi = useMemo(() => {
    const total = filteredScans.length;
    const thisWeek = filteredScans.filter(s => Date.now() - new Date(s.created_at).getTime() < 7 * DAY).length;
    const validScores = filteredScans
      .map(s => s.skin_score ?? s.diagnosis?.skin_score)
      .filter(n => typeof n === 'number');
    const avgScore = validScores.length > 0
      ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
      : null;
    const uniqueUsers = new Set(filteredScans.map(s => s.user_id).filter(Boolean)).size;
    const adoptionRate = usersCount > 0 ? Math.round((uniqueUsers / usersCount) * 100) : null;
    return { total, thisWeek, avgScore, uniqueUsers, adoptionRate };
  }, [filteredScans, usersCount]);

  // ─── Répartition types de peau ───
  const skinTypeDistribution = useMemo(() => {
    const map = {};
    for (const s of filteredScans) {
      const t = (s.skin_type || s.diagnosis?.skin_type || 'inconnu').toLowerCase();
      map[t] = (map[t] || 0) + 1;
    }
    return Object.entries(map)
      .map(([type, count]) => ({ type, count, pct: filteredScans.length > 0 ? Math.round((count / filteredScans.length) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [filteredScans]);

  // ─── Top concerns ───
  const topConcerns = useMemo(() => {
    const map = {};
    for (const s of filteredScans) {
      const concerns = s.diagnosis?.concerns;
      if (!Array.isArray(concerns)) continue;
      for (const c of concerns) {
        const name = (typeof c === 'string' ? c : c?.name || '').toLowerCase().trim();
        if (!name) continue;
        if (!map[name]) map[name] = { name, count: 0, severities: { mild: 0, moderate: 0, severe: 0 } };
        map[name].count++;
        const sev = typeof c === 'object' ? c.severity : null;
        if (sev && map[name].severities[sev] !== undefined) {
          map[name].severities[sev]++;
        }
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [filteredScans]);

  // ─── Distribution des scores peau ───
  const scoreDistribution = useMemo(() => {
    const buckets = [
      { label: '< 50 (à améliorer)', min: 0,  max: 50,  color: '#D9342B', count: 0 },
      { label: '50–70 (correct)',    min: 50, max: 70,  color: '#F4B53A', count: 0 },
      { label: '70–85 (bonne)',      min: 70, max: 85,  color: '#1F8B4C', count: 0 },
      { label: '85+ (excellente)',   min: 85, max: 101, color: '#0F5C2E', count: 0 },
    ];
    for (const s of filteredScans) {
      const score = s.skin_score ?? s.diagnosis?.skin_score;
      if (typeof score !== 'number') continue;
      const b = buckets.find(b => score >= b.min && score < b.max);
      if (b) b.count++;
    }
    return buckets;
  }, [filteredScans]);

  // ─── Top ingrédients recommandés / à éviter ───
  const topIngredients = useMemo(() => {
    const reco = {};
    const avoid = {};
    for (const s of filteredScans) {
      for (const ing of (s.diagnosis?.ingredients_recommandes || [])) {
        const k = String(ing).toLowerCase().trim();
        if (k) reco[k] = (reco[k] || 0) + 1;
      }
      for (const ing of (s.diagnosis?.ingredients_a_eviter || [])) {
        const k = String(ing).toLowerCase().trim();
        if (k) avoid[k] = (avoid[k] || 0) + 1;
      }
    }
    const sort = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
    return { reco: sort(reco), avoid: sort(avoid) };
  }, [filteredScans]);

  // ─── Évolution mensuelle (12 mois) ───
  const monthlyScans = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = scans.filter(s => {
        const t = new Date(s.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      }).length;
      months.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
        count,
      });
    }
    return months;
  }, [scans]);

  // ─── Styles ───
  const S = {
    section: { padding: 24 },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: '#6B6B6B', fontSize: 13, marginTop: 4 },
    filters: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: 20, alignItems: 'center' },
    pill: { padding: '7px 14px', borderRadius: 999, border: '1px solid #DDD', background: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    pillActive: { background: '#1F8B4C', color: 'white', borderColor: '#1F8B4C' },
    select: { padding: '7px 12px', borderRadius: 8, border: '1px solid #DDD', fontSize: 13, fontFamily: 'inherit' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 },
    kpiCard: { background: 'white', border: '1px solid #EEE', borderRadius: 14, padding: 18 },
    kpiLabel: { fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em' },
    kpiValue: { fontSize: 24, fontWeight: 800, marginTop: 6, color: '#1A1A1A' },
    kpiMeta: { fontSize: 11, color: '#9B9B9B', marginTop: 4 },
    section2: { background: 'white', borderRadius: 14, border: '1px solid #EEE', padding: 20, marginBottom: 16 },
    sectionTitle: { fontSize: 16, fontWeight: 800, marginBottom: 14 },
    rowBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' },
    rowLabel: { width: 220, fontSize: 13, color: '#1A1A1A' },
    barWrap: { flex: 1, height: 18, background: '#F4F4F2', borderRadius: 4, overflow: 'hidden' },
    barInner: (pct, color) => ({ width: `${pct}%`, height: '100%', background: color || '#1F8B4C', borderRadius: 4 }),
    rowCount: { width: 70, fontSize: 12, fontWeight: 700, color: '#1A1A1A', textAlign: 'right' },
    twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
    chart: { display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, padding: '0 4px' },
    bar: { flex: 1, background: 'linear-gradient(180deg, #1F8B4C 0%, #166635 100%)', borderRadius: '4px 4px 0 0', minHeight: 2 },
    barLabel: { fontSize: 9, color: '#6B6B6B', textAlign: 'center', marginTop: 4 },
    barValue: { fontSize: 10, color: '#1A1A1A', textAlign: 'center', fontWeight: 700, marginBottom: 2 },
  };

  // Couleur de la barre type de peau
  const skinColor = (type) => {
    const c = {
      mixte: '#1F8B4C',
      grasse: '#F4B53A',
      seche: '#3B82F6',
      sèche: '#3B82F6',
      normale: '#10B981',
      sensible: '#E8385C',
    };
    return c[type] || '#9B9B9B';
  };

  const maxMonthly = Math.max(1, ...monthlyScans.map(m => m.count));
  const maxConcerns = Math.max(1, ...topConcerns.map(c => c.count));
  const maxReco = Math.max(1, ...topIngredients.reco.map(i => i.count));
  const maxAvoid = Math.max(1, ...topIngredients.avoid.map(i => i.count));
  const maxScoreBucket = Math.max(1, ...scoreDistribution.map(b => b.count));

  return (
    <div style={S.section}>
      <h1 style={S.h1}>🧠 Stats Scans IA</h1>
      <p style={S.sub}>
        Insights dermato basés sur les diagnostics Gemini Vision · données agrégées
      </p>

      {/* FILTRES */}
      <div style={S.filters}>
        {[['7d','7 jours'],['30d','30 jours'],['90d','90 jours'],['year','1 an'],['all','Tout']].map(([k, label]) => (
          <button
            key={k}
            style={{ ...S.pill, ...(period === k ? S.pillActive : {}) }}
            onClick={() => setPeriod(k)}
          >
            {label}
          </button>
        ))}
        <select style={{ ...S.select, marginLeft: 'auto' }} value={skinFilter} onChange={e => setSkinFilter(e.target.value)}>
          <option value="all">Tous types de peau</option>
          {skinTypeDistribution.map(s => (
            <option key={s.type} value={s.type}>{cap(s.type)} ({s.count})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement…</p>
      ) : (
        <>
          {/* KPI */}
          <div style={S.grid}>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>🤖 Scans IA</div>
              <div style={S.kpiValue}>{kpi.total.toLocaleString('fr-FR')}</div>
              <div style={S.kpiMeta}>+{kpi.thisWeek} cette semaine</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>⭐ Score peau moyen</div>
              <div style={{ ...S.kpiValue, color: kpi.avgScore == null ? '#9B9B9B' : kpi.avgScore >= 75 ? '#1F8B4C' : kpi.avgScore >= 50 ? '#F4B53A' : '#D9342B' }}>
                {kpi.avgScore != null ? kpi.avgScore : '—'}
              </div>
              <div style={S.kpiMeta}>sur 100</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>👥 Utilisatrices uniques</div>
              <div style={S.kpiValue}>{kpi.uniqueUsers}</div>
              <div style={S.kpiMeta}>{kpi.adoptionRate != null ? `${kpi.adoptionRate}% de la base` : 'base utilisateurs inconnue'}</div>
            </div>
            <div style={S.kpiCard}>
              <div style={S.kpiLabel}>🔁 Scans par utilisatrice</div>
              <div style={S.kpiValue}>
                {kpi.uniqueUsers > 0 ? (kpi.total / kpi.uniqueUsers).toFixed(1) : '—'}
              </div>
              <div style={S.kpiMeta}>moyenne</div>
            </div>
          </div>

          {/* RÉPARTITION TYPES DE PEAU */}
          <div style={S.section2}>
            <div style={S.sectionTitle}>🎨 Répartition des types de peau</div>
            {skinTypeDistribution.length === 0 ? (
              <p style={{ color: '#9B9B9B', fontSize: 13 }}>Aucune donnée</p>
            ) : skinTypeDistribution.map(s => (
              <div key={s.type} style={S.rowBar}>
                <div style={S.rowLabel}>{cap(s.type)}</div>
                <div style={S.barWrap}>
                  <div style={S.barInner(s.pct, skinColor(s.type))} />
                </div>
                <div style={S.rowCount}>{s.count} ({s.pct}%)</div>
              </div>
            ))}
          </div>

          {/* DISTRIBUTION DES SCORES */}
          <div style={S.section2}>
            <div style={S.sectionTitle}>📊 Distribution des scores peau</div>
            {scoreDistribution.every(b => b.count === 0) ? (
              <p style={{ color: '#9B9B9B', fontSize: 13 }}>Aucun score disponible</p>
            ) : scoreDistribution.map(b => (
              <div key={b.label} style={S.rowBar}>
                <div style={S.rowLabel}>{b.label}</div>
                <div style={S.barWrap}>
                  <div style={S.barInner((b.count / maxScoreBucket) * 100, b.color)} />
                </div>
                <div style={S.rowCount}>{b.count}</div>
              </div>
            ))}
          </div>

          {/* TOP CONCERNS */}
          <div style={S.section2}>
            <div style={S.sectionTitle}>🚨 Top 10 préoccupations détectées par l'IA</div>
            {topConcerns.length === 0 ? (
              <p style={{ color: '#9B9B9B', fontSize: 13 }}>Aucune concern détectée</p>
            ) : topConcerns.map(c => (
              <div key={c.name} style={S.rowBar}>
                <div style={S.rowLabel}>{cap(c.name)}</div>
                <div style={S.barWrap}>
                  <div style={S.barInner((c.count / maxConcerns) * 100, '#E8385C')} />
                </div>
                <div style={S.rowCount}>{c.count}</div>
              </div>
            ))}
            <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 10 }}>
              💡 Ces données t'aident à orienter le catalogue : si "hyperpigmentation" domine, met en avant les sérums anti-taches.
            </p>
          </div>

          {/* TOP INGRÉDIENTS */}
          <div style={S.twoCol}>
            <div style={S.section2}>
              <div style={S.sectionTitle}>✅ Top ingrédients recommandés</div>
              {topIngredients.reco.length === 0 ? (
                <p style={{ color: '#9B9B9B', fontSize: 13 }}>Aucune donnée</p>
              ) : topIngredients.reco.map(i => (
                <div key={i.name} style={S.rowBar}>
                  <div style={{ ...S.rowLabel, width: 180 }}>{cap(i.name)}</div>
                  <div style={S.barWrap}>
                    <div style={S.barInner((i.count / maxReco) * 100, '#1F8B4C')} />
                  </div>
                  <div style={S.rowCount}>{i.count}</div>
                </div>
              ))}
            </div>

            <div style={S.section2}>
              <div style={S.sectionTitle}>⚠️ Top ingrédients à éviter</div>
              {topIngredients.avoid.length === 0 ? (
                <p style={{ color: '#9B9B9B', fontSize: 13 }}>Aucune donnée</p>
              ) : topIngredients.avoid.map(i => (
                <div key={i.name} style={S.rowBar}>
                  <div style={{ ...S.rowLabel, width: 180 }}>{cap(i.name)}</div>
                  <div style={S.barWrap}>
                    <div style={S.barInner((i.count / maxAvoid) * 100, '#D9342B')} />
                  </div>
                  <div style={S.rowCount}>{i.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ÉVOLUTION MENSUELLE */}
          <div style={S.section2}>
            <div style={S.sectionTitle}>📈 Évolution mensuelle des scans (12 mois)</div>
            <div style={S.chart}>
              {monthlyScans.map((m, i) => (
                <div key={m.label || i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={S.barValue}>{m.count || ''}</div>
                  <div title={`${m.count} scans`} style={{
                    ...S.bar,
                    height: `${(m.count / maxMonthly) * 140}px`,
                    width: '70%',
                  }} />
                  <div style={S.barLabel}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AIDE */}
          <div style={S.section2}>
            <div style={S.sectionTitle}>ℹ️ Comment lire ces données</div>
            <ul style={{ fontSize: 13, color: '#1A1A1A', lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
              <li><strong>Score peau moyen</strong> : moyenne du `skin_score` (0-100) renvoyé par Gemini Vision</li>
              <li><strong>Types de peau</strong> : agrégation de la colonne `skin_type` (mixte, grasse, sèche, etc.)</li>
              <li><strong>Préoccupations</strong> : extrait du JSON `diagnosis.concerns` de chaque scan</li>
              <li><strong>Ingrédients</strong> : extrait de `diagnosis.ingredients_recommandes` et `ingredients_a_eviter`</li>
              <li><strong>Filtre type de peau</strong> : pour voir les concerns spécifiques aux peaux mixtes par exemple</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
