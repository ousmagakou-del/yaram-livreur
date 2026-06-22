/* ═══════════════════════════════════════════════════════════════════
   BonsPlansCarousel — Carrousel horizontal premium des promos actives
   • Lit promo_codes Supabase (actives, non-expirées, non-referral)
   • Cards visuelles avec %, code, scope, CTA
   • Skeleton loader pendant fetch
   • Si aucune promo active → la section disparaît proprement
   ═══════════════════════════════════════════════════════════════════ */

import { memo } from 'react';
import { supabase } from '../lib/supabase';
import { useNav } from '../App';
import { usePersistedData } from '../lib/usePersistedData';
import './BonsPlansCarousel.css';

const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

function promoBadge(p) {
  if (p.type === 'percent' || p.type === 'percentage') return `-${p.value}%`;
  if (p.type === 'amount' || p.type === 'fixed' || p.type === 'flat') return `-${fmt(p.value)} FCFA`;
  if (p.type === 'shipping' || p.type === 'free_shipping') return 'GRATUIT';
  return p.value ? `-${p.value}` : 'PROMO';
}

function promoLabel(p) {
  if (p.type === 'shipping' || p.type === 'free_shipping') return 'Livraison offerte';
  if (p.type === 'percent' || p.type === 'percentage') return `${p.value}% de réduction`;
  if (p.type === 'amount' || p.type === 'fixed' || p.type === 'flat') return `${fmt(p.value)} FCFA offerts`;
  return 'Bon plan';
}

function promoScope(p) {
  if (p.product_id) return 'product';
  if (p.category_id || p.category) return 'category';
  if (p.brand_id || p.brand) return 'brand';
  if (p.first_order || p.first_purchase_only) return 'first';
  return 'all';
}

function scopeChip(p) {
  const s = promoScope(p);
  if (s === 'product') return '🛍️ Produit';
  if (s === 'category') return '🗂️ Catégorie';
  if (s === 'brand') return `🏷️ ${p.brand || 'Marque'}`;
  if (s === 'first') return '✨ 1ère commande';
  if (p.type === 'shipping') return '🛵 Livraison';
  return '🎁 Tout le site';
}

// Palette gradients premium (rotation déterministe selon l'index)
const GRADIENTS = [
  { bg: 'linear-gradient(135deg, #FF6B6B 0%, #EE5A6F 100%)', glow: 'rgba(238, 90, 111, 0.28)' },
  { bg: 'linear-gradient(135deg, #4FACFE 0%, #00F2FE 100%)', glow: 'rgba(79, 172, 254, 0.28)' },
  { bg: 'linear-gradient(135deg, #FFA751 0%, #FFE259 100%)', glow: 'rgba(255, 167, 81, 0.28)' },
  { bg: 'linear-gradient(135deg, #A8E063 0%, #56AB2F 100%)', glow: 'rgba(86, 171, 47, 0.28)' },
  { bg: 'linear-gradient(135deg, #B721FF 0%, #21D4FD 100%)', glow: 'rgba(183, 33, 255, 0.28)' },
  { bg: 'linear-gradient(135deg, #F093FB 0%, #F5576C 100%)', glow: 'rgba(240, 147, 251, 0.28)' },
];

function PromoCard({ promo, index, onClick }) {
  const grad = GRADIENTS[index % GRADIENTS.length];
  const stockLimited = promo.max_uses && (promo.max_uses - (promo.uses_count || 0)) <= Math.max(3, Math.ceil(promo.max_uses * 0.2));
  const remaining = promo.max_uses ? promo.max_uses - (promo.uses_count || 0) : null;
  return (
    <button
      className="bp-card"
      style={{ background: grad.bg, boxShadow: `0 10px 28px ${grad.glow}, 0 2px 6px rgba(0,0,0,0.08)` }}
      onClick={() => onClick(promo)}
      aria-label={`${promoLabel(promo)} avec le code ${promo.code}`}
    >
      <div className="bp-card-shape bp-card-shape-1" />
      <div className="bp-card-shape bp-card-shape-2" />

      <div className="bp-card-head">
        <span className="bp-card-chip">{scopeChip(promo)}</span>
        {stockLimited && (
          <span className="bp-card-stock">🔥 Plus que {remaining}</span>
        )}
      </div>

      <div className="bp-card-badge">{promoBadge(promo)}</div>

      <div className="bp-card-label">{promoLabel(promo)}</div>

      {promo.min_order_amount > 0 && (
        <div className="bp-card-min">dès {fmt(promo.min_order_amount)} FCFA</div>
      )}

      <div className="bp-card-foot">
        <div className="bp-card-code">
          <span className="bp-card-code-label">CODE</span>
          <span className="bp-card-code-value">{promo.code}</span>
        </div>
        <div className="bp-card-cta">
          Voir l'offre
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7"/>
          </svg>
        </div>
      </div>
    </button>
  );
}

function BonsPlansCarousel() {
  const { navigate } = useNav();

  // Migré vers usePersistedData → cache module-level, plus de skeleton au remount.
  const { data: promosData, loading } = usePersistedData(
    'bons-plans-carousel',
    async () => {
      // FIX juin 2026 : les .or() chaînés avec ISO timestamp produisaient
      // une URL 400 (caractères spéciaux mal encodés). On simplifie : filter
      // actif + non-referral côté SQL, dates côté client (peu de rows).
      const now = Date.now();
      const { data } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('active', true)
        .neq('is_referral', true)
        .order('created_at', { ascending: false })
        .limit(20);

      return (data || []).filter(p => {
        if (p.expires_at && new Date(p.expires_at).getTime() <= now) return false;
        if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
        if (p.max_uses && p.uses_count >= p.max_uses) return false;
        return true;
      });
    },
    { ttl: 5 * 60 * 1000 }
  );
  const promos = promosData || [];

  const handleCardClick = (promo) => {
    try {
      navigator.clipboard?.writeText(promo.code);
      localStorage.setItem('yaram_pending_promo', promo.code);
    } catch {}
    if (navigator.vibrate) navigator.vibrate(40);
    navigate({ name: 'promos', params: {} });
  };

  // ─── Loading skeleton ───
  if (loading) {
    return (
      <section className="bp-section">
        <div className="bp-section-head">
          <div>
            <h2 className="bp-section-title">🎁 Bons plans</h2>
            <div className="bp-section-sub">Promos actives à saisir maintenant</div>
          </div>
        </div>
        <div className="bp-row">
          {[0, 1, 2].map(i => <div key={i} className="bp-skeleton" />)}
        </div>
      </section>
    );
  }

  // ─── Empty state — section masquée pour ne pas casser le flow ───
  if (promos.length === 0) {
    return null;
  }

  return (
    <section className="bp-section">
      <div className="bp-section-head">
        <div>
          <h2 className="bp-section-title">🎁 Bons plans</h2>
          <div className="bp-section-sub">{promos.length} promo{promos.length > 1 ? 's' : ''} à saisir maintenant</div>
        </div>
        <button className="bp-section-link" onClick={() => navigate({ name: 'promos', params: {} })}>
          Tout voir →
        </button>
      </div>
      <div className="bp-row" role="list">
        {promos.map((p, i) => (
          <div key={p.id || p.code} role="listitem">
            <PromoCard promo={p} index={i} onClick={handleCardClick} />
          </div>
        ))}
      </div>
    </section>
  );
}

// PERF : memo — pas de props, re-render parent (Home) ne doit pas
// reprovoquer le fetch + render du carousel.
export default memo(BonsPlansCarousel);
