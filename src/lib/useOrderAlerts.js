// src/lib/useOrderAlerts.js
// Écoute en temps réel les nouvelles commandes pour une pharmacie,
// joue un son ding répétitif et affiche une notif navigateur tant qu'il y a
// des commandes en attente non traitées et que la pharmacie n'a pas mute.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';

const PENDING_STATUSES = ['paid', 'awaiting_confirm', 'awaiting_cash', 'pending'];

// URL d'un son court "ding" en base64 (Web Audio) — on génère un beep doux 880Hz
// Pour éviter une dépendance externe, on synthétise via AudioContext
function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Bip à 2 tons (ding-dong) pour être reconnaissable
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.18);
    });
    // Ferme le context après pour libérer
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch (e) {
    // pas critique, juste pas de son
  }
}

function showSystemNotification(pendingCount) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification('🔔 Commande YARAM en attente', {
      body: `${pendingCount} commande${pendingCount > 1 ? 's' : ''} à traiter`,
      tag: 'yaram-pending', // remplace l'ancienne si déjà affichée
      requireInteraction: false,
    });
    setTimeout(() => n.close(), 6000);
  } catch (e) {
    // ignore
  }
}

export function useOrderAlerts(pharmacyId) {
  const [pendingCount, setPendingCount] = useState(0);
  // Mute initial depuis localStorage
  const [muted, setMutedState] = useState(() => {
    try { return localStorage.getItem('yaram-pharma-mute') === '1'; } catch { return false; }
  });
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const intervalRef = useRef(null);
  const knownIdsRef = useRef(new Set());

  // Persistance mute
  const setMuted = useCallback((v) => {
    setMutedState(v);
    try { localStorage.setItem('yaram-pharma-mute', v ? '1' : '0'); } catch {}
  }, []);

  // Demande la permission pour les notifs navigateur (à appeler depuis un onClick)
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    const p = await Notification.requestPermission();
    setNotifPermission(p);
    return p;
  }, []);

  // Charge le nombre initial de commandes en attente
  const refresh = useCallback(async () => {
    if (!pharmacyId) return;
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, created_at')
      .eq('pharmacy_id', pharmacyId)
      .in('status', PENDING_STATUSES);
    if (error) return;
    const ids = (data || []).map(o => o.id);
    knownIdsRef.current = new Set(ids);
    setPendingCount(ids.length);
  }, [pharmacyId]);

  // Subscribe Realtime + polling backup
  useEffect(() => {
    if (!pharmacyId) return;

    refresh();

    // Realtime sur les INSERT et UPDATE
    const channel = supabase
      .channel(`pharmacy-orders-${pharmacyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: `pharmacy_id=eq.${pharmacyId}` },
        (payload) => {
          const row = payload.new;
          if (PENDING_STATUSES.includes(row.status)) {
            if (!knownIdsRef.current.has(row.id)) {
              knownIdsRef.current.add(row.id);
              setPendingCount(c => c + 1);
              // Première sonnerie immédiate
              if (!muted) {
                playDing();
                showSystemNotification(knownIdsRef.current.size);
              }
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `pharmacy_id=eq.${pharmacyId}` },
        (payload) => {
          const row = payload.new;
          const was = knownIdsRef.current.has(row.id);
          const isPending = PENDING_STATUSES.includes(row.status);
          if (was && !isPending) {
            knownIdsRef.current.delete(row.id);
            setPendingCount(c => Math.max(0, c - 1));
          } else if (!was && isPending) {
            knownIdsRef.current.add(row.id);
            setPendingCount(c => c + 1);
            if (!muted) {
              playDing();
              showSystemNotification(knownIdsRef.current.size);
            }
          }
        }
      )
      .subscribe();

    // Polling backup toutes les 30 sec si Realtime laggue
    const poll = setInterval(refresh, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [pharmacyId, refresh, muted]);

  // Ding répétitif tant qu'il y a des commandes en attente et non mute
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (pendingCount > 0 && !muted) {
      // Ding toutes les 8 secondes
      intervalRef.current = setInterval(() => {
        playDing();
      }, 8000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pendingCount, muted]);

  return {
    pendingCount,
    muted,
    setMuted,
    notifPermission,
    requestNotificationPermission,
    testDing: playDing,
  };
}
