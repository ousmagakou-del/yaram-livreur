import { useEffect, useState, useRef } from 'react';
import { useNav } from '../App';
import { supabase, sendWhatsApp } from '../lib/supabase';
import { toast } from '../lib/toast';
import { formatPrice, safeFormatDate, safeNumber } from '../lib/utils';
import { formatArrivalDate, PREORDER_STATUS_LABELS, PREORDER_STATUS_ICONS } from '../lib/preorder';
import SignedImage from '../components/SignedImage';
import './OrderTracking.css';

// Flow classique (commande locale Dakar — J+1)
const STEPS_LOCAL = [
  { id: 'paid',      label: '✅ Payée' },
  { id: 'preparing', label: '📦 En préparation' },
  { id: 'shipped',   label: '🛵 En route' },
  { id: 'delivered', label: '🎉 Livrée' },
];

// Flow preorder (commande Import — 15j en moyenne)
const STEPS_PREORDER = [
  { id: 'pending_payment',   label: '💳 Acompte demandé' },
  { id: 'paid',              label: '✅ Acompte reçu' },
  { id: 'awaiting_supplier', label: '🛍️ Commande fournisseur' },
  { id: 'in_transit_intl',   label: '✈️ En route vers Dakar' },
  { id: 'arrived_local',     label: '🇸🇳 Arrivé à Dakar' },
  { id: 'awaiting_balance',  label: '💰 Solde à régler' },
  { id: 'shipped',           label: '🛵 Livraison' },
  { id: 'delivered',         label: '🎉 Livrée' },
];

export default function OrderTracking({ orderId }) {
  const { navigate } = useNav();
  const [order, setOrder] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [showRating, setShowRating] = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    refresh();
    // Vague 12 : le realtime channel sur `orders` ne marche plus depuis le lockdown
    // RLS (anon ne peut plus voir les changements en stream). Polling 8s pour rester
    // a jour sur les changements de statut (preparation, en route, livree).
    // delivery_tracking reste en realtime (sa policy SELECT est encore permissive).
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
    // Vague 11 RLS : on passe par RPC client_get_order_by_id (verifie auth.uid)
    const { data: orderData } = await supabase.rpc('client_get_order_by_id', { p_order_id: orderId });
    setOrder(orderData);
    const { data: trackingData } = await supabase.from('delivery_tracking').select('*').eq('order_id', orderId).maybeSingle();
    if (trackingData) setTracking(trackingData);
  };

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
      mapRef.current = L.map(mapContainerRef.current).setView([tracking.current_lat, tracking.current_lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(mapRef.current);
      const livreurIcon = L.divIcon({
        html: '<div style="background:#1F8B4C;color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">🛵</div>',
        className: '', iconSize: [36, 36], iconAnchor: [18, 18],
      });
      markerRef.current = L.marker([tracking.current_lat, tracking.current_lng], { icon: livreurIcon }).addTo(mapRef.current);
    }
  }, [tracking?.current_lat, tracking?.current_lng]);

  // Pop-up notation auto après livraison
  useEffect(() => {
    if (order?.status === 'delivered' && !order?.delivery_rating) {
      setTimeout(() => setShowRating(true), 1500);
    }
  }, [order?.status, order?.delivery_rating]);

  if (!order) return <div style={{ padding: 40 }}>Chargement…</div>;

  // Choix du flow selon que la commande est preorder ou classique
  const isPreorderOrder = order.is_preorder === true;
  const STEPS = isPreorderOrder ? STEPS_PREORDER : STEPS_LOCAL;
  const currentStep = STEPS.findIndex(s => s.id === order.status);
  const hasGPS = tracking?.current_lat && order.status === 'shipped';
  const lastUpdate = tracking?.last_update ? new Date(tracking.last_update) : null;
  const secondsAgo = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000) : null;

  return (
    <div className="track-screen page-anim">
      <div className="track-header">
        <button className="icon-back-btn" onClick={() => navigate('/orders')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1>Commande {order.id}</h1>
          <p>{safeFormatDate(order.created_at, { type: 'datetime' })}</p>
        </div>
      </div>

      <div className="track-scroll">
        <div className="track-timeline">
          {STEPS.map((s, i) => (
            <div key={s.id} className={'track-step ' + (i <= currentStep ? 'done' : '')}>
              <div className="track-dot" />
              <div className="track-label">{s.label}</div>
            </div>
          ))}
        </div>

        {isPreorderOrder && (
          <div className="track-preorder-card">
            <div className="track-preorder-head">
              <span style={{ fontSize: 22 }}>✈️</span>
              <div>
                <strong>Commande Import</strong>
                <p>Délai estimé : 15 jours</p>
              </div>
            </div>
            <div className="track-preorder-rows">
              <div className="track-preorder-row">
                <span>💳 Acompte (50%)</span>
                <strong style={{ color: order.deposit_paid_at ? '#1F8B4C' : '#0066CC' }}>
                  {formatPrice(order.deposit_amount || 0)} FCFA
                  {order.deposit_paid_at && ' ✓'}
                </strong>
              </div>
              <div className="track-preorder-row">
                <span>📦 Solde à régler (50%)</span>
                <strong style={{ color: order.balance_paid_at ? '#1F8B4C' : 'var(--muted)' }}>
                  {formatPrice(order.balance_amount || 0)} FCFA
                  {order.balance_paid_at && ' ✓'}
                </strong>
              </div>
              {order.expected_arrival_date && (
                <div className="track-preorder-row">
                  <span>📅 Arrivée prévue</span>
                  <strong>{formatArrivalDate(order.expected_arrival_date)}</strong>
                </div>
              )}
              {order.arrived_dakar_at && (
                <div className="track-preorder-row">
                  <span>🇸🇳 Arrivé le</span>
                  <strong style={{ color: '#1F8B4C' }}>{safeFormatDate(order.arrived_dakar_at)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {hasGPS && (
          <div className="track-gps-card">
            <div className="track-gps-head">
              <div>
                <span className="track-gps-dot" />
                <strong>🛵 Livreur en route</strong>
              </div>
              {secondsAgo !== null && (
                <span className="track-gps-time">
                  {secondsAgo < 60 ? `Il y a ${secondsAgo}s` : `Il y a ${Math.floor(secondsAgo / 60)}min`}
                </span>
              )}
            </div>
            <div ref={mapContainerRef} className="track-map" />
            {tracking?.delivery_person_phone && (
              <a
                href={`https://wa.me/${tracking.delivery_person_phone.replace(/\D/g, '')}`}
                target="_blank" rel="noopener noreferrer"
                className="track-driver-btn"
              >
                💬 WhatsApp livreur {tracking.delivery_person_name}
              </a>
            )}
          </div>
        )}

        {/* Preuve de livraison */}
        {order.status === 'delivered' && tracking && (
          <div className="track-info-card">
            <h3>✅ Preuve de livraison</h3>
            {tracking.delivery_photo_url && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>📷 Photo du colis remis</p>
                <SignedImage src={tracking.delivery_photo_url} alt="Preuve livraison" style={{ width: '100%', borderRadius: 10, maxHeight: 300, objectFit: 'cover' }} />
              </div>
            )}
            {tracking.delivery_signature && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>✍️ Signature</p>
                <img src={tracking.delivery_signature} alt="Signature" style={{ width: '100%', maxHeight: 100, objectFit: 'contain', background: 'white', borderRadius: 8 }} />
              </div>
            )}
            {tracking.delivery_pin && (
              <p style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>
                ✓ Confirmée par code PIN {tracking.delivery_pin}
              </p>
            )}
            {tracking.delivered_at && (
              <p style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                Livré le {safeFormatDate(tracking.delivered_at, { type: 'datetime' })}
              </p>
            )}
          </div>
        )}

        {/* Notation déjà donnée */}
        {order.delivery_rating && (
          <div className="track-info-card">
            <h3>⭐ Ton avis</h3>
            <div style={{ fontSize: 20, color: '#F4B53A', margin: '6px 0' }}>
              {'★'.repeat(order.delivery_rating)}{'☆'.repeat(5 - order.delivery_rating)}
            </div>
            {order.delivery_comment && (
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic' }}>"{order.delivery_comment}"</p>
            )}
          </div>
        )}

        <div className="track-info-card">
          <h3>📍 Livraison</h3>
          <p><strong>{order.address?.name}</strong></p>
          <p>{order.address?.line}</p>
          <p>{order.address?.neighborhood}, {order.address?.city}</p>
          <p>📞 {order.address?.phone}</p>
        </div>

        <div className="track-info-card">
          <h3>📦 Articles ({order.items?.length})</h3>
          {order.items?.map((it, i) => (
            <div key={i} className="track-item">
              <img src={it.img} alt="" />
              <div>
                <strong>{it.name}</strong>
                <span>{safeNumber(it.qty, 1)} × {safeNumber(it.price).toLocaleString('fr-FR')} FCFA</span>
                <small>🏥 {it.pharmacyName}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="track-info-card">
          <h3>💰 Total</h3>
          <div className="cart-row"><span>Sous-total</span><strong>{order.subtotal?.toLocaleString('fr-FR')} FCFA</strong></div>
          <div className="cart-row"><span>Livraison</span><strong>{order.shipping?.toLocaleString('fr-FR')} FCFA</strong></div>
          <div className="cart-row cart-row-total"><span>Total</span><strong>{order.total?.toLocaleString('fr-FR')} FCFA</strong></div>
        </div>

        {/* Bouton noter si pas encore */}
        {order.status === 'delivered' && !order.delivery_rating && (
          <button
            onClick={() => setShowRating(true)}
            style={{
              width: '100%', padding: 16, marginTop: 12,
              background: 'linear-gradient(135deg, #F4B53A 0%, #E89B1B 100%)',
              color: 'white', border: 'none', borderRadius: 14,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >⭐ Noter cette livraison</button>
        )}
      </div>

      {showRating && (
        <RatingModal
          orderId={orderId}
          driverName={tracking?.delivery_person_name}
          onClose={() => { setShowRating(false); refresh(); }}
        />
      )}
    </div>
  );
}

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
    // Vague 13 RLS : UPDATE direct bloque, on passe par RPC client_rate_order
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
