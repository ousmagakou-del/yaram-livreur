/* ═══════════════════════════════════════════════════════════════════
   BonsPlansWidget — Mini popup flottant qui suggère la meilleure promo
   • Apparaît après quelques secondes sur Home, en bas au-dessus de la TabBar
   • Bouton × pour fermer → stocké en localStorage (silence 48h)
   • Tap → navigation vers /promos + copie du code
   • Disparaît si aucune promo active
   ═══════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNav } from '../App';
import './BonsPlansWidget.css';

const DISMISS_KEY = 'yaram_bons_plans_widget_dismissed_at';
const DISMISS_HOURS = 48; // ne réapparaît pas avant 48h après dismiss
const REVEAL_DELAY_MS = 2500; // laisse l'utilisateur voir la home d'abord

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

function bestPromoLabel(p) {
  if (p.type === 'shipping' || p.type === 'free_shipping') return 'Livraison offerte';
  if (p.type === 'percent' || p.type === 'percentage') return `-${p.value}% sur ta commande`;
  if (p.type === 'amount' || p.type === 'fixed' || p.type === 'flat') return `-${fmt(p.value)} FCFA offerts`;
  return 'Une promo t\'attend';
}

function bestPromoScore(p) {
  // Score : pourcentage > montant fixe > shipping, et garde la plus récente
  if (p.type === 'percent' || p.type === 'percentage') return 1000 + Number(p.value || 0);
  if (p.type === 'amount' || p.type === 'fixed' || p.type === 'flat') return 500 + Math.min(Number(p.value || 0) / 100, 500);
  if (p.type === 'shipping' || p.type === 'free_shipping') return 200;
  return 0;
}

export default function BonsPlansWidget() {
  const { navigate } = useNav();
  const [promo, setPromo] = useState(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // ─── 1. check dismiss state ───
  useEffect(() => {
    let alive = true;
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const dismissedAt = parseInt(raw, 10);
        const hoursAgo = (Date.now() - dismissedAt) / (1000 * 60 * 60);
        if (hoursAgo < DISMISS_HOURS) return; // silence
      }
    } catch {}

    // ─── 2. fetch best active promo ───
    (async () => {
      try {
        // FIX juin 2026 : .or() chaînés cassaient l'URL → 400. Filter dates client.
        const now = Date.now();
        const { data } = await supabase
          .from('promo_codes')
          .select('*')
          .eq('active', true)
          .neq('is_referral', true)
          .limit(20);

        const usable = (data || []).filter(p => {
          if (p.expires_at && new Date(p.expires_at).getTime() <= now) return false;
          if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
          return !p.max_uses || p.uses_count < p.max_uses;
        });
        if (usable.length === 0) return;

        const best = usable.sort((a, b) => bestPromoScore(b) - bestPromoScore(a))[0];
        if (!alive) return;
        setPromo(best);
        // ─── 3. delay reveal ───
        setTimeout(() => { if (alive) setVisible(true); }, REVEAL_DELAY_MS);
      } catch (e) {
        console.error('[BonsPlansWidget] load error:', e);
      }
    })();
    return () => { alive = false; };
  }, []);

  const handleDismiss = (e) => {
    e?.stopPropagation();
    setClosing(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    if (navigator.vibrate) navigator.vibrate(20);
    setTimeout(() => setVisible(false), 280);
  };

  const handleOpen = () => {
    try {
      navigator.clipboard?.writeText(promo.code);
      localStorage.setItem('yaram_pending_promo', promo.code);
    } catch {}
    if (navigator.vibrate) navigator.vibrate(35);
    navigate({ name: 'promos', params: {} });
  };

  if (!visible || !promo) return null;

  return (
    <div
      className={`bpw-wrap ${closing ? 'bpw-closing' : ''}`}
      role="dialog"
      aria-label="Bon plan disponible"
    >
      <button className="bpw-card" onClick={handleOpen}>
        <div className="bpw-shape bpw-shape-1" />
        <div className="bpw-shape bpw-shape-2" />

        <div className="bpw-icon">🎁</div>
        <div className="bpw-body">
          <div className="bpw-title">Bon plan dispo</div>
          <div className="bpw-sub">{bestPromoLabel(promo)} · code <strong>{promo.code}</strong></div>
        </div>
        <div className="bpw-arrow" aria-hidden>→</div>
      </button>
      <button className="bpw-close" onClick={handleDismiss} aria-label="Fermer">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
