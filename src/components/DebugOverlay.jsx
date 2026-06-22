// ════════════════════════════════════════════════════════════════
//  YARAM — Debug Overlay (activable via ?debug=1 ou localStorage 'yaram-debug'=1)
// ════════════════════════════════════════════════════════════════
//
//  Affiche en live :
//    • Le pageKey actuel
//    • L'état de TOUTES les queries TanStack (pending/success/error/idle)
//    • Si placeholderData est servi (= UI restée peuplée)
//    • Le temps depuis le dernier fetch de chaque query
//
//  Utile pour diagnostiquer "page blanche" / "skeletons figés".
//  Désactivé en prod sauf si activé manuellement via URL.
//
//  POUR L'ACTIVER : ajoute `?debug=1` à l'URL OU dans Safari console :
//    localStorage.setItem('yaram-debug', '1'); location.reload();
//
//  POUR LE DÉSACTIVER :
//    localStorage.removeItem('yaram-debug'); location.reload();
// ════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

function isDebugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('debug') === '1') {
      try { localStorage.setItem('yaram-debug', '1'); } catch {}
      return true;
    }
    if (url.searchParams.get('debug') === '0') {
      try { localStorage.removeItem('yaram-debug'); } catch {}
      return false;
    }
    return localStorage.getItem('yaram-debug') === '1';
  } catch {
    return false;
  }
}

function shortKey(key) {
  if (!Array.isArray(key)) return String(key);
  return key.map(k => (typeof k === 'object' ? JSON.stringify(k) : String(k))).join('/');
}

function timeAgo(ms) {
  if (!ms) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}

export default function DebugOverlay() {
  const qc = useQueryClient();
  const [enabled] = useState(isDebugEnabled);
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Tick toutes les 500ms pour rafraîchir les statuts
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const cache = qc.getQueryCache();
  const queries = cache.getAll();
  // eslint-disable-next-line no-unused-vars
  const _t = tick; // force re-render

  const counts = queries.reduce((acc, q) => {
    const s = q.state.status;
    acc[s] = (acc[s] || 0) + 1;
    acc.total++;
    return acc;
  }, { total: 0 });

  const pendingCount = counts.pending || 0;
  const errorCount = counts.error || 0;
  const successCount = counts.success || 0;
  const fetching = queries.filter(q => q.state.fetchStatus === 'fetching').length;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 8,
        zIndex: 99999,
        background: 'rgba(13, 77, 39, 0.95)',
        color: '#fff',
        fontFamily: 'monospace, system-ui',
        fontSize: 11,
        padding: expanded ? '10px 12px' : '6px 10px',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        maxWidth: expanded ? 320 : 200,
        maxHeight: expanded ? '50vh' : 'auto',
        overflowY: expanded ? 'auto' : 'visible',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>🛠 YARAM Debug</span>
        <span style={{ opacity: 0.6 }}>{expanded ? '▼' : '▲'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
        <span>📦 {counts.total}</span>
        <span style={{ color: '#FCD34D' }}>⏳ {pendingCount}</span>
        <span style={{ color: '#86EFAC' }}>✓ {successCount}</span>
        {errorCount > 0 && <span style={{ color: '#FCA5A5' }}>✗ {errorCount}</span>}
        {fetching > 0 && <span style={{ color: '#93C5FD' }}>↻ {fetching}</span>}
      </div>

      {expanded && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 6 }}>
          <div style={{ fontSize: 9, opacity: 0.6, marginBottom: 4 }}>
            Path: {typeof window !== 'undefined' ? window.location.pathname : '/'}
          </div>
          {/* FIX iOS : afficher les infos spécifiques iOS Safari + Capacitor */}
          {typeof window !== 'undefined' && (
            <>
              <div style={{ fontSize: 9, opacity: 0.6, marginBottom: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>UA: {/iPhone|iPad|iPod/i.test(navigator.userAgent) ? '📱iOS' : '💻'}</span>
                <span>Cap: {window.Capacitor?.isNativePlatform?.() ? '🟢native' : '🌐web'}</span>
                <span>PWA: {window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches ? '✓' : '✗'}</span>
              </div>
              <div style={{ fontSize: 9, opacity: 0.6, marginBottom: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span>SW: {('serviceWorker' in navigator && navigator.serviceWorker.controller) ? '✓' : '✗'}</span>
                <span>Focused: {document.hasFocus() ? '✓' : '✗'}</span>
                <span>Vis: {document.visibilityState}</span>
              </div>
              {/* Capacitor resume stats (visible UNIQUEMENT sur iOS native) */}
              {window.__yaramCapStats && window.Capacitor?.isNativePlatform?.() && (
                <div style={{ fontSize: 9, opacity: 0.6, marginBottom: 4, color: '#86EFAC' }}>
                  Cap resumes: {window.__yaramCapStats.resumes} · pauses: {window.__yaramCapStats.pauses}
                  {window.__yaramCapStats.lastResumeAt && (
                    <> · last: {timeAgo(window.__yaramCapStats.lastResumeAt)}</>
                  )}
                </div>
              )}
            </>
          )}
          {queries.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 10 }}>Aucune query</div>
          ) : (
            queries.map((q, i) => {
              const status = q.state.status;
              const isFetching = q.state.fetchStatus === 'fetching';
              const hasData = q.state.data !== undefined;
              const updatedAt = q.state.dataUpdatedAt;
              const color = status === 'error' ? '#FCA5A5'
                : status === 'pending' && !hasData ? '#FCD34D'
                : hasData ? '#86EFAC' : '#fff';
              return (
                <div key={i} style={{
                  fontSize: 10,
                  padding: '3px 0',
                  borderBottom: '1px dashed rgba(255,255,255,0.08)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {shortKey(q.queryKey)}
                  </span>
                  <span style={{ color, fontSize: 9, flexShrink: 0 }}>
                    {hasData ? '✓' : status === 'pending' ? '⏳' : '·'}
                    {isFetching && '↻'}
                    {' '}{timeAgo(updatedAt)}
                  </span>
                </div>
              );
            })
          )}
          <div style={{ fontSize: 9, opacity: 0.5, marginTop: 8 }}>
            Tap pour réduire · ?debug=0 pour désactiver
          </div>
        </div>
      )}
    </div>
  );
}
