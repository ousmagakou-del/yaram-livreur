// src/lib/useOrderAlerts.js
// ════════════════════════════════════════════════════════════════
// YARAM — Alerte sonore FORTE pour les pharmacies
// ════════════════════════════════════════════════════════════════
//
// Quand une nouvelle commande arrive :
//   1. Alarme sonore 3 tons (440 → 880 → 1760 Hz) gain 0.55 + reverb subtle
//   2. Vibration mobile (pattern [200, 100, 200, 100, 400])
//   3. Notification système navigateur
//   4. Boucle TOUTES LES 5 secondes tant qu'il y a des commandes pending
//      et que pas de mute → la pharmacie ne peut pas rater
//   5. WakeLock pour empêcher l'écran de s'éteindre
//
// Realtime triple safety net :
//   - broadcast 'new_order' (instant, déclenché par client)
//   - postgres_changes INSERT (instant, déclenché par DB)
//   - polling 30s (filet)
// ════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, getPharmacyOrders } from './supabase';

const PENDING_STATUSES = ['paid', 'awaiting_confirm', 'awaiting_cash', 'pending'];

// ─── ALARME SONORE FORTE ─────────────────────────────────────────
// 3 tons en octave montante (rythme alarme), gain 0.55 (avant 0.25)
// Durée totale ~0.7s pour bien marquer l'oreille
function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Si suspended (Chrome autoplay policy), resume
    if (ctx.state === 'suspended') ctx.resume?.();

    // Pattern alarme : 3 tons ascendants
    const tones = [
      { freq: 880,  startOffset: 0.0,  duration: 0.18 },
      { freq: 1320, startOffset: 0.20, duration: 0.18 },
      { freq: 1760, startOffset: 0.40, duration: 0.28 },
    ];

    tones.forEach(({ freq, startOffset, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle'; // plus doux qu'une sine mais plus de présence
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.55, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    });

    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch (e) {
    // pas critique
  }
}

// ─── VIBRATION MOBILE ────────────────────────────────────────────
// Pattern [200ms ON, 100ms OFF, 200ms ON, 100ms OFF, 400ms ON]
function vibrateAlarm() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  } catch { /* no-op */ }
}

// ─── NOTIFICATION SYSTÈME ────────────────────────────────────────
function showSystemNotification(pendingCount) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification('🔔 Commande YARAM en attente', {
      body: `${pendingCount} commande${pendingCount > 1 ? 's' : ''} à traiter`,
      tag: 'yaram-pending',
      requireInteraction: true, // reste affichée jusqu'au clic
      silent: false,             // utilise le son système en plus du nôtre
      // badge: '/icon-192.png',
      icon: '/icon-192.png',
    });
    setTimeout(() => n.close(), 10000);
  } catch (e) { /* ignore */ }
}

// ─── WAKE LOCK (empêche l'écran de s'éteindre) ──────────────────
let _wakeLock = null;
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && navigator.wakeLock?.request) {
      _wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* no-op */ }
}
async function releaseWakeLock() {
  try {
    if (_wakeLock) {
      await _wakeLock.release();
      _wakeLock = null;
    }
  } catch { /* no-op */ }
}

// ─── ALL-IN-ONE : son + vibration + notif ───────────────────────
function fireAlert(pendingCount) {
  playAlarm();
  vibrateAlarm();
  showSystemNotification(pendingCount);
}

export function useOrderAlerts(pharmacyId) {
  const [pendingCount, setPendingCount] = useState(0);
  const [muted, setMutedState] = useState(() => {
    try { return localStorage.getItem('yaram-pharma-mute') === '1'; } catch { return false; }
  });
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const knownIdsRef = useRef(new Set());
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const setMuted = useCallback((v) => {
    setMutedState(v);
    try { localStorage.setItem('yaram-pharma-mute', v ? '1' : '0'); } catch {}
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    const p = await Notification.requestPermission();
    setNotifPermission(p);
    return p;
  }, []);

  // ─── Charge le nombre initial de commandes pending ─────
  const refresh = useCallback(async () => {
    if (!pharmacyId) return;
    try {
      const orders = await getPharmacyOrders(pharmacyId, PENDING_STATUSES);
      const ids = (orders || []).map(o => o.id);
      knownIdsRef.current = new Set(ids);
      setPendingCount(ids.length);
    } catch { /* silencieux */ }
  }, [pharmacyId]);

  // ─── Realtime triple safety net ──────────────────────
  useEffect(() => {
    if (!pharmacyId) return;
    refresh();

    const tick = async () => {
      try {
        const orders = await getPharmacyOrders(pharmacyId, PENDING_STATUSES);
        const newIds = new Set((orders || []).map(o => o.id));
        let appeared = 0;
        newIds.forEach(id => { if (!knownIdsRef.current.has(id)) appeared++; });
        knownIdsRef.current = newIds;
        setPendingCount(newIds.size);
        if (appeared > 0 && !mutedRef.current) {
          fireAlert(newIds.size);
        }
      } catch { /* silencieux */ }
    };

    // Channel realtime : broadcast + postgres_changes
    const channel = supabase
      .channel(`yaram-pharma-orders-${pharmacyId}`)
      .on('broadcast', { event: 'new_order' }, ({ payload }) => {
        const ids = Array.isArray(payload?.pharmacy_ids) ? payload.pharmacy_ids : [];
        if (ids.includes(pharmacyId)) tick();
      })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        () => tick()
      )
      .subscribe();

    // Polling 30s (filet de sécurité)
    const poll = setInterval(tick, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [pharmacyId, refresh]);

  // ─── BOUCLE alarme : ré-alarme toutes les 5s tant qu'il y a
  //     des commandes pending et que pas mute. La pharmacie NE PEUT
  //     PAS RATER une commande même si elle est loin de son tel. ───
  useEffect(() => {
    if (pendingCount <= 0 || muted) {
      releaseWakeLock();
      return;
    }
    // Acquérir le wake lock dès qu'on a des pending (écran reste allumé)
    acquireWakeLock();

    const ALARM_INTERVAL_MS = 5000; // ré-alarme toutes les 5 secondes
    let intervalId = null;

    // Re-fire la première fois après 2s (donne le temps au dashboard d'afficher)
    const firstTimeout = setTimeout(() => {
      if (!mutedRef.current) fireAlert(pendingCount);
      intervalId = setInterval(() => {
        if (!mutedRef.current) fireAlert(pendingCount);
      }, ALARM_INTERVAL_MS);
    }, 2000);

    return () => {
      clearTimeout(firstTimeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [pendingCount, muted]);

  // Cleanup wake lock au unmount
  useEffect(() => () => { releaseWakeLock(); }, []);

  // Re-acquire wake lock quand l'app revient en foreground (Safari coupe le lock)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && pendingCount > 0 && !muted) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pendingCount, muted]);

  return {
    pendingCount,
    muted,
    setMuted,
    notifPermission,
    requestNotificationPermission,
    testDing: () => fireAlert(1),
  };
}
