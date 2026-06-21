import { useEffect, useState, useRef, useMemo } from 'react';
import { useNav } from '../App';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { formatPrice, safeFormatDate, safeNumber, YARAM_WHATSAPP } from '../lib/utils';
import { formatArrivalDate } from '../lib/preorder';
import SignedImage from '../components/SignedImage';
import './OrderTracking.css';

/* ───────────── Flows (étapes timeline) ───────────── */
// Local : commande Dakar (J+1)
const STEPS_LOCAL = [
  { id: 'paid',      icon: '✅', label: 'Commande confirmée',  sub: 'Paiement reçu' },
  { id: 'preparing', icon: '📦', label: 'En préparation',       sub: 'La pharmacie prépare ton colis' },
  { id: 'shipped',   icon: '🛵', label: 'En route',             sub: 'Ton livreur arrive' },
  { id: 'delivered', icon: '🎉', label: 'Livrée',               sub: 'Merci pour ta confiance' },
];

// Preorder : import (15j)
const STEPS_PREORDER = [
  { id: 'paid',              icon: '💳', label: 'Acompte reçu',          sub: '50% versé' },
  { id: 'awaiting_supplier', icon: '🛍️', label: 'Commande fournisseur',  sub: 'YARAM commande à l\'étranger' },
  { id: 'in_transit_intl',   icon: '✈️', label: 'En route vers Dakar',   sub: 'Transport international' },
  { id: 'arrived_local',     icon: '🇸🇳', label: 'Arrivé à Dakar',        sub: 'Réception locale' },
  { id: 'awaiting_balance',  icon: '💰', label: 'Solde à régler',        sub: '50% restant' },
  { id: 'shipped',           icon: '🛵', label: 'En livraison',          sub: 'Ton livreur arrive' },
  { id: 'delivered',         icon: '🎉', label: 'Livrée',                sub: 'Merci pour ta confiance' },
];

/* ───────────── Hero (gros bloc en haut) ───────────── */
function statusHero(status, isPreorder) {
  // returns { tone, icon, title, subtitle }
  if (status === 'delivered') {
    return { tone: 'success', icon: '🎉', title: 'Livré !',                subtitle: 'Ton colis est bien arrivé' };
  }
  if (status === 'shipped' || status === 'in_delivery') {
    return { tone: 'route',   icon: '🛵', title: 'En route',                subtitle: 'Ton livreur arrive bientôt' };
  }
  if (status === 'preparing') {
    return { tone: 'prep',    icon: '📦', title: 'En préparation',          subtitle: 'La pharmacie prépare ta commande' };
  }
  if (status === 'awaiting_balance') {
    return { tone: 'warn',    icon: '💰', title: 'Solde à régler',          subtitle: 'Ton import est arrivé — règle le solde' };
  }
  if (status === 'arrived_local') {
    return { tone: 'route',   icon: '🇸🇳', title: 'Arrivé à Dakar',         subtitle: 'Bientôt prêt pour la livraison' };
  }
  if (status === 'in_transit_intl') {
    return { tone: 'transit', icon: '✈️', title: 'En route vers Dakar',     subtitle: 'Transport international en cours' };
  }
  if (status === 'awaiting_supplier') {
    return { tone: 'prep',    icon: '🛍️', title: 'Commande fournisseur',    subtitle: 'YARAM commande chez le fournisseur' };
  }
  if (status === 'pending_payment' || status === 'pending') {
    return { tone: 'warn',    icon: '⏳', title: 'En attente de paiement',  subtitle: 'On attend la confirmation' };
  }
  if (status === 'paid' || status === 'confirmed') {
    return { tone: 'prep',    icon: isPreorder ? '💳' : '✅', title: isPreorder ? 'Acompte reçu' : 'Commande confirmée', subtitle: isPreorder ? 'YARAM va lancer la commande' : 'Préparation imminente' };
  }
  if (status === 'cancelled') {
    return { tone: 'cancel',  icon: '❌', title: 'Annulée',                 subtitle: 'Cette commande a été annulée' };
  }
  return { tone: 'prep', icon: '📦', title: 'En cours', subtitle: 'Mise à jour bientôt' };
}

/* ───────────── ETA estimée ───────────── */
function computeETA(order, tracking) {
  // Priorité 1 : ETA du tracking (livreur)
  if (tracking?.eta_at) {
    const d = new Date(tracking.eta_at);
    if (!isNaN(d.getTime())) {
      return `Livraison vers ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
  // Priorité 2 : si shipped, on suppose ~30min
  if (order.status === 'shipped') {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    return `Livraison vers ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  // Priorité 3 : preorder arrival date
  if (order.is_preorder && order.expected_arrival_date) {
    return `Arrivée prévue ${formatArrivalDate(order.expected_arrival_date)}`;
  }
  // Local non shipped : J+1
  if (!order.is_preorder && (order.status === 'paid' || order.status === 'preparing')) {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return `Livraison estimée ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}`;
  }
  return null;
}

export default function OrderTracking({ orderId }) {
  const { navigate } = useNav();
  const [order, setOrder] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [showRating, setShowRating] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const prevStatusRef = useRef(null);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    refresh();
    const sub = supabase
      .channel('order-tracking-tr-' + orderId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_tracking', filter: `order_id=eq.${orderId}` },
        (payload) => { if (payload.new) setTracking(payload.new); })
      .subscribe();
    const interval = setInterval(refresh, 8000);
    return () => { sub.unsubscribe(); clearInterval(interval); };
  }, [orderId]);

  const refresh = async () => {
    const { data: orderData } = await supabase.rpc('client_get_order_by_id', { p_order_id: orderId });
    setOrder(orderData);
    const { data: trackingData } = await supabase.from('delivery_tracking').select('*').eq('order_id', orderId).maybeSingle();
    if (trackingData) setTracking(trackingData);
  };

  // Trigger confettis quand on passe en 'delivered' en live
  useEffect(() => {
    if (!order) return;
    if (prevStatusRef.current && prevStatusRef.current !== 'delivered' && order.status === 'delivered') {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4500);
    }
    prevStatusRef.current = order.status;
  }, [order?.status]);

  // Carte Leaflet
  useEffect(() => {
    if (!tracking?.current_lat || !mapContainerRef.current) return;
    if (!window.L) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else {
      initMap();
    }

    function initMap() {
      const L = window.L;
      if (!L) return;
      if (mapRef.current) {
        markerRef.current.setLatLng([tracking.current_lat, tracking.current_lng]);
        mapRef.current.setView([tracking.current_lat, tracking.current_lng], 15);
        return;
      }
      mapRef.current = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([tracking.current_lat, tracking.current_lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(mapRef.current);
      const livreurIcon = L.divIcon({
        html: '<div class="track-rider-pin">🛵</div>',
        className: '', iconSize: [44, 44], iconAnchor: [22, 22],
      });
      markerRef.current = L.marker([tracking.current_lat, tracking.current_lng], { icon: livreurIcon }).addTo(mapRef.current);
    }
  }, [tracking?.current_lat, tracking?.current_lng]);

  // Pop-up notation auto après livraison
  useEffect(() => {
    if (order?.status === 'delivered' && !order?.delivery_rating) {
      const t = setTimeout(() => setShowRating(true), 2500);
      return () => clearTimeout(t);
    }
  }, [order?.status, order?.delivery_rating]);

  // Numéro de commande compact (#XXXX)
  const compactId = useMemo(() => {
    if (!order?.id) return '';
    const s = String(order.id);
    return s.length > 6 ? '#' + s.slice(-6).toUpperCase() : '#' + s.toUpperCase();
  }, [order?.id]);

  if (!order) {
    return (
      <div className="track-screen page-anim">
        <div className="track-loading">
          <div className="track-loading-spinner" />
          <p>Chargement du suivi…</p>
        </div>
      </div>
    );
  }

  const isPreorderOrder = order.is_preorder === true;
  const STEPS = isPreorderOrder ? STEPS_PREORDER : STEPS_LOCAL;
  const currentStep = STEPS.findIndex(s => s.id === order.status);
  const hasGPS = tracking?.current_lat && (order.status === 'shipped' || order.status === 'in_delivery');
  const lastUpdate = tracking?.last_update ? new Date(tracking.last_update) : null;
  const secondsAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null;

  const hero = statusHero(order.status, isPreorderOrder);
  const eta = computeETA(order, tracking);
  const paymentLabel =
    order.payment_method === 'wave' ? 'Payé via Wave' :
    order.payment_method === 'orange_money' ? 'Payé via Orange Money' :
    order.payment_method === 'card' ? 'Payé par carte' :
    order.payment_method === 'cod' ? 'Cash à la livraison' :
    'Paiement enregistré';

  const paymentDone = order.status !== 'pending' && order.status !== 'pending_payment' && order.payment_method !== 'cod';

  const helpHref = `https://wa.me/${YARAM_WHATSAPP}?text=${encodeURIComponent(
    `Bonjour YARAM, j'ai besoin d'aide concernant ma commande ${compactId}.`
  )}`;

  const driverPhoneClean = tracking?.delivery_person_phone?.replace(/\D/g, '');

  return (
    <div className="track-screen page-anim">
      {/* ═══ Header sticky glass ═══ */}
      <header className="track-top">
        <button className="track-top-btn" onClick={() => navigate('/orders')} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="track-top-id">
          <span className="track-top-id-label">Commande</span>
          <strong className="track-top-id-num">{compactId}</strong>
        </div>
        <a className="track-top-help" href={helpHref} target="_blank" rel="noopener noreferrer">
          <span className="track-top-help-dot">?</span>
          Aide
        </a>
      </header>

      <div className="track-scroll">
        {/* ═══ Hero status premium ═══ */}
        <section className={`track-hero track-hero-${hero.tone}`}>
          <div className="track-hero-iconwrap">
            <div className="track-hero-pulse" aria-hidden="true" />
            <div className="track-hero-icon">{hero.icon}</div>
          </div>
          <h1 className="track-hero-title">{hero.title}</h1>
          <p className="track-hero-sub">{hero.subtitle}</p>
          {eta && (
            <div className="track-hero-eta">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>
              </svg>
              <span>{eta}</span>
            </div>
          )}
        </section>

        {/* ═══ Timeline verticale premium ═══ */}
        <section className="track-card">
          <h3 className="track-card-title">Suivi de ta commande</h3>
          <ol className="track-tl">
            {STEPS.map((s, i) => {
              const isDone = i < currentStep || (i === currentStep && order.status === 'delivered');
              const isCurrent = i === currentStep && order.status !== 'delivered';
              const isFuture = i > currentStep;
              const cls = isDone ? 'done' : isCurrent ? 'current' : 'future';
              return (
                <li key={s.id} className={`track-tl-step track-tl-${cls}`} style={{ animationDelay: `${i * 80}ms` }}>
                  <div className="track-tl-rail">
                    <div className="track-tl-bullet">
                      {isDone && (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                      {isCurrent && <span className="track-tl-spin" />}
                    </div>
                    {i < STEPS.length - 1 && <div className="track-tl-line" />}
                  </div>
                  <div className="track-tl-body">
                    <div className="track-tl-label">
                      <span className="track-tl-emoji">{s.icon}</span>
                      <span>{s.label}</span>
                    </div>
                    <div className="track-tl-sub">{s.sub}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* ═══ Preorder spécial (si import) ═══ */}
        {isPreorderOrder && (
          <section className="track-card track-import">
            <div className="track-import-head">
              <span className="track-import-plane">✈️</span>
              <div>
                <strong>Import en cours</strong>
                <p>Délai estimé : 15 jours</p>
              </div>
            </div>
            <div className="track-import-progress">
              <div className="track-import-bar">
                <div
                  className="track-import-fill"
                  style={{ width: `${Math.max(0, Math.min(100, ((currentStep + 1) / STEPS.length) * 100))}%` }}
                />
              </div>
              <div className="track-import-pct">
                {Math.round(((currentStep + 1) / STEPS.length) * 100)}%
              </div>
            </div>
            <div className="track-import-rows">
              <div className="track-import-row">
                <span>💳 Acompte (50%)</span>
                <strong className={order.deposit_paid_at ? 'ok' : 'pending'}>
                  {formatPrice(order.deposit_amount || 0)} FCFA{order.deposit_paid_at && ' ✓'}
                </strong>
              </div>
              <div className="track-import-row">
                <span>📦 Solde (50%)</span>
                <strong className={order.balance_paid_at ? 'ok' : 'wait'}>
                  {formatPrice(order.balance_amount || 0)} FCFA{order.balance_paid_at && ' ✓'}
                </strong>
              </div>
              {order.expected_arrival_date && (
                <div className="track-import-row">
                  <span>📅 Arrivée prévue</span>
                  <strong>{formatArrivalDate(order.expected_arrival_date)}</strong>
                </div>
              )}
              {order.arrived_dakar_at && (
                <div className="track-import-row">
                  <span>🇸🇳 Arrivé le</span>
                  <strong className="ok">{safeFormatDate(order.arrived_dakar_at)}</strong>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ═══ Section Livraison (adresse + livreur + GPS) ═══ */}
        <section className="track-card">
          <h3 className="track-card-title">📍 Livraison</h3>
          <div className="track-addr">
            <strong>{order.address?.name}</strong>
            <p>{order.address?.line}</p>
            <p className="muted">{order.address?.neighborhood}{order.address?.neighborhood && order.address?.city ? ', ' : ''}{order.address?.city}</p>
            {order.address?.phone && <p className="muted">📞 {order.address.phone}</p>}
          </div>

          {tracking?.delivery_person_name && (
            <div className="track-driver">
              <div className="track-driver-avatar">
                {tracking.delivery_person_photo ? (
                  <img src={tracking.delivery_person_photo} alt={tracking.delivery_person_name} />
                ) : (
                  <span>{(tracking.delivery_person_name || '?').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="track-driver-info">
                <small>Ton livreur</small>
                <strong>{tracking.delivery_person_name}</strong>
                {secondsAgo !== null && hasGPS && (
                  <span className="track-driver-live">
                    <span className="live-dot" />
                    {secondsAgo < 60 ? `Position il y a ${secondsAgo}s` : `Il y a ${Math.floor(secondsAgo / 60)}min`}
                  </span>
                )}
              </div>
              <div className="track-driver-actions">
                {driverPhoneClean && (
                  <a className="track-driver-call" href={`tel:+${driverPhoneClean}`} aria-label="Appeler">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                  </a>
                )}
                {driverPhoneClean && (
                  <a className="track-driver-wa" href={`https://wa.me/${driverPhoneClean}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.18 1.6 6L0 24l6.21-1.63A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.2-1.25-6.21-3.48-8.52zM12 21.82c-1.79 0-3.55-.48-5.09-1.39l-.36-.21-3.69.97.99-3.59-.24-.37A9.78 9.78 0 0 1 2.18 12C2.18 6.57 6.57 2.18 12 2.18S21.82 6.57 21.82 12 17.43 21.82 12 21.82zm5.42-7.31c-.3-.15-1.76-.87-2.04-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.93 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.47-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.91-2.18-.24-.58-.49-.5-.66-.51l-.56-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.21 5.08 4.5.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/>
                    </svg>
                  </a>
                )}
              </div>
            </div>
          )}

          {hasGPS && (
            <div className="track-mapwrap">
              <div ref={mapContainerRef} className="track-map" />
              <div className="track-map-overlay">
                <span className="live-dot" />
                <span>Position en direct</span>
              </div>
            </div>
          )}
        </section>

        {/* ═══ Preuve de livraison (delivered) ═══ */}
        {order.status === 'delivered' && tracking && (tracking.delivery_photo_url || tracking.delivery_signature || tracking.delivery_pin) && (
          <section className="track-card">
            <h3 className="track-card-title">✅ Preuve de livraison</h3>
            {tracking.delivery_photo_url && (
              <div className="track-proof-img">
                <SignedImage src={tracking.delivery_photo_url} alt="Preuve livraison" style={{ width: '100%', borderRadius: 12, maxHeight: 280, objectFit: 'cover' }} />
                <small>📷 Photo du colis remis</small>
              </div>
            )}
            {tracking.delivery_signature && (
              <div className="track-proof-sig">
                <img src={tracking.delivery_signature} alt="Signature" />
                <small>✍️ Signature reçue</small>
              </div>
            )}
            {tracking.delivery_pin && (
              <p className="track-proof-pin">✓ Confirmée par code PIN <strong>{tracking.delivery_pin}</strong></p>
            )}
            {tracking.delivered_at && (
              <p className="track-proof-time">Livré le {safeFormatDate(tracking.delivered_at, { type: 'datetime' })}</p>
            )}
          </section>
        )}

        {/* ═══ Notation existante ═══ */}
        {order.delivery_rating && (
          <section className="track-card track-rating-recap">
            <h3 className="track-card-title">⭐ Ton avis</h3>
            <div className="track-rating-stars">
              {'★'.repeat(order.delivery_rating)}<span className="muted">{'★'.repeat(5 - order.delivery_rating)}</span>
            </div>
            {order.delivery_comment && <p className="track-rating-com">"{order.delivery_comment}"</p>}
          </section>
        )}

        {/* ═══ Récap items (collapsible) ═══ */}
        <section className="track-card">
          <button
            type="button"
            className="track-card-collapse"
            onClick={() => setItemsExpanded(v => !v)}
            aria-expanded={itemsExpanded}
          >
            <span className="track-card-title">📦 Récap commande</span>
            <span className="track-card-meta">
              {order.items?.length} article{order.items?.length > 1 ? 's' : ''}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`track-chevron ${itemsExpanded ? 'open' : ''}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </span>
          </button>
          <div className={`track-items ${itemsExpanded ? 'open' : ''}`}>
            {order.items?.map((it, i) => (
              <div key={i} className="track-item">
                {it.img && <img src={it.img} alt="" />}
                <div className="track-item-info">
                  <strong>{it.name}</strong>
                  <span>{safeNumber(it.qty, 1)} × {safeNumber(it.price).toLocaleString('fr-FR')} FCFA</span>
                  {it.pharmacyName && <small>🏥 {it.pharmacyName}</small>}
                </div>
              </div>
            ))}
          </div>
          <div className="track-totals">
            <div className="track-totals-row"><span>Sous-total</span><strong>{order.subtotal?.toLocaleString('fr-FR')} FCFA</strong></div>
            <div className="track-totals-row"><span>Livraison</span><strong>{order.shipping?.toLocaleString('fr-FR')} FCFA</strong></div>
            <div className="track-totals-row track-totals-grand"><span>Total</span><strong>{order.total?.toLocaleString('fr-FR')} FCFA</strong></div>
          </div>
        </section>

        {/* ═══ Paiement ═══ */}
        <section className="track-card track-pay">
          <h3 className="track-card-title">💳 Paiement</h3>
          <div className={`track-pay-badge ${paymentDone ? 'paid' : 'pending'}`}>
            <span className="track-pay-icon">{paymentDone ? '✅' : '💵'}</span>
            <div>
              <strong>{paymentLabel}</strong>
              {order.paid_at && <small>{safeFormatDate(order.paid_at, { type: 'datetime' })}</small>}
            </div>
          </div>
        </section>

        <div style={{ height: 100 }} />
      </div>

      {/* ═══ Bottom CTA ═══ */}
      <BottomCTA
        order={order}
        onRate={() => setShowRating(true)}
        navigate={navigate}
      />

      {/* ═══ Modal notation ═══ */}
      {showRating && (
        <RatingModal
          orderId={orderId}
          driverName={tracking?.delivery_person_name}
          onClose={() => { setShowRating(false); refresh(); }}
        />
      )}

      {/* ═══ Confettis ═══ */}
      {showConfetti && <Confetti />}
    </div>
  );
}

/* ───────────── Bottom CTA ───────────── */
function BottomCTA({ order, onRate, navigate }) {
  const isDelivered = order.status === 'delivered';
  const isAwaitingConfirm = order.status === 'awaiting_confirm';
  const isAwaitingBalance = order.status === 'awaiting_balance';

  if (isAwaitingBalance) {
    return (
      <div className="track-bottom">
        <button className="track-cta track-cta-warn" onClick={() => navigate('/checkout?balance=' + order.id)}>
          💰 Régler le solde
        </button>
      </div>
    );
  }
  if (isAwaitingConfirm) {
    return (
      <div className="track-bottom">
        <button
          className="track-cta track-cta-pri"
          onClick={async () => {
            await supabase.rpc('client_confirm_delivery', { p_order_id: order.id });
            toast.success('Livraison confirmée 🎉');
          }}
        >
          ✅ Confirmer la livraison
        </button>
      </div>
    );
  }
  if (isDelivered && !order.delivery_rating) {
    return (
      <div className="track-bottom">
        <button className="track-cta track-cta-star" onClick={onRate}>
          ⭐ Noter ma livraison
        </button>
      </div>
    );
  }
  if (isDelivered) {
    return (
      <div className="track-bottom">
        <button className="track-cta track-cta-ghost" onClick={() => navigate('/shop')}>
          🔁 Refaire cette commande
        </button>
      </div>
    );
  }
  return null;
}

/* ───────────── Confettis ───────────── */
function Confetti() {
  const pieces = Array.from({ length: 36 });
  return (
    <div className="track-confetti" aria-hidden="true">
      {pieces.map((_, i) => (
        <span
          key={i}
          className="track-confetti-piece"
          style={{
            left: `${(i * 100) / pieces.length}%`,
            animationDelay: `${(i % 8) * 80}ms`,
            background: ['#1F8B4C', '#F4B53A', '#0066CC', '#E89B1B', '#25D366'][i % 5],
          }}
        />
      ))}
    </div>
  );
}

/* ───────────── Modal notation ───────────── */
function RatingModal({ orderId, driverName, onClose }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (rating === 0) {
      toast.error('Sélectionne au moins 1 étoile');
      return;
    }
    setSaving(true);
    await supabase.rpc('client_rate_order', {
      p_id_or_token: orderId,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="liv-modal-overlay" onClick={onClose}>
      <div className="liv-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center', fontSize: 22 }}>⭐ Note ta livraison</h3>
        <p style={{ textAlign: 'center', color: '#6B6B6B', fontSize: 13, marginBottom: 20 }}>
          Comment s'est passé ton expérience{driverName ? ` avec ${driverName}` : ''} ?
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setRating(n)}
              style={{
                background: 'transparent', border: 'none',
                fontSize: 40, cursor: 'pointer',
                color: n <= rating ? '#F4B53A' : '#DDD',
                transition: 'transform 0.1s',
              }}
            >★</button>
          ))}
        </div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Un mot pour le livreur ? (optionnel)"
          rows={3}
          style={{
            width: '100%', padding: 12,
            border: '1.5px solid #EEE', borderRadius: 10,
            fontSize: 13, fontFamily: 'inherit',
            marginBottom: 12,
          }}
        />
        <button
          className="liv-btn-pri"
          onClick={submit}
          disabled={saving}
        >{saving ? 'Envoi...' : '💚 Valider mon avis'}</button>
        <button className="liv-btn-stop" onClick={onClose} style={{ marginTop: 8 }}>Plus tard</button>
      </div>
    </div>
  );
}
