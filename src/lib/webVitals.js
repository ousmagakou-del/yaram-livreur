// ════════════════════════════════════════════════════════════════
// YARAM — Web Vitals (LCP, CLS, INP, FCP, TTFB) → PostHog
// ════════════════════════════════════════════════════════════════
//
// Mesure les Core Web Vitals réels chez les utilisateurs et les push
// dans PostHog pour identifier les vrais points de friction perf en prod.
//
// PERF : `web-vitals` pèse ~3kb gzip et load via dynamic import APRES
// idle, donc aucun impact sur le boot.
//
// Métriques :
//   - LCP   : Largest Contentful Paint (cible <2.5s)
//   - CLS   : Cumulative Layout Shift  (cible <0.1)
//   - INP   : Interaction to Next Paint (cible <200ms)
//   - FCP   : First Contentful Paint   (cible <1.8s)
//   - TTFB  : Time to First Byte       (cible <0.8s)
// ════════════════════════════════════════════════════════════════

import { trackEvent } from './analytics';

let reported = new Set();

function report(metric) {
  // Dédup : on capture chaque métrique une seule fois par session
  if (reported.has(metric.name)) return;
  reported.add(metric.name);

  try {
    trackEvent('web_vital', {
      metric: metric.name,
      value: Math.round(metric.value),
      rating: metric.rating,         // 'good' | 'needs-improvement' | 'poor'
      navigation_type: metric.navigationType,
      url: typeof window !== 'undefined' ? window.location.pathname : null,
      connection: getConnectionInfo(),
    });
  } catch { /* analytics non bloquant */ }
}

function getConnectionInfo() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return null;
    return {
      effective_type: c.effectiveType,
      downlink: c.downlink,
      rtt: c.rtt,
      save_data: !!c.saveData,
    };
  } catch { return null; }
}

export async function initWebVitals() {
  // Skip en dev pour pas polluer
  if (import.meta.env.MODE !== 'production') return;
  try {
    const { onLCP, onCLS, onINP, onFCP, onTTFB } = await import('web-vitals');
    onLCP(report);
    onCLS(report);
    onINP(report);
    onFCP(report);
    onTTFB(report);
  } catch (e) {
    console.warn('[webVitals] init failed:', e?.message);
  }
}
