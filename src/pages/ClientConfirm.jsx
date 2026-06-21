import { useState, useEffect } from 'react';
import { supabase, getOrderByConfirmToken, clientConfirmDelivery, clientReportDispute, sendWhatsApp, WhatsAppTemplates } from '../lib/supabase';
import { sendOrderEmail } from '../lib/emails';
import SignedImage from '../components/SignedImage';
import { toast } from '../lib/toast';
import './ClientConfirm.css';

export default function ClientConfirm() {
  const [order, setOrder] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [showRating, setShowRating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('confirm');
    if (!t) {
      setError('Lien invalide');
      setLoading(false);
      return;
    }
    (async () => {
      const o = await getOrderByConfirmToken(t);
      if (!o) {
        setError('Lien expiré ou introuvable');
        setLoading(false);
        return;
      }
      setOrder(o);
      const { data: trk } = await supabase
        .from('delivery_tracking')
        .select('*')
        .eq('order_id', o.id)
        .maybeSingle();
      setTracking(trk);
      
      if (o.status === 'delivered') {
        setDone(true);
      }
      
      setLoading(false);
    })();
  }, []);

  const confirmYes = async () => {
    setSubmitting(true);
    // Vague 13 : la RPC attend le token (pas l'id), il vient de l'URL/order
    await clientConfirmDelivery(order.confirmation_token);
    // Email "merci pour ta commande, note ton experience" (non-bloquant)
    sendOrderEmail(order.id, 'orderDelivered').catch(e => console.warn('delivered email failed:', e?.message));
    
    // Notif WhatsApp à la cliente
    if (order.address?.phone) {
      const msg = WhatsAppTemplates.orderDelivered(order.address.name, order.id);
      sendWhatsApp(order.address.phone, msg).then(r => console.log('Final delivered notif:', r));
    }
    
    setOrder({ ...order, status: 'delivered' });
    setSubmitting(false);
    setDone(true);
    setTimeout(() => setShowRating(true), 800);
  };

  const submitDispute = async (reason) => {
    setSubmitting(true);
    await clientReportDispute(order.confirmation_token, reason);
    setSubmitting(false);
    setShowDispute(false);
    toast.success('Ton problème a été signalé à YARAM. Notre équipe va te contacter rapidement.', { duration: 6000 });
  };

  if (loading) {
    return <div className="cc-screen"><div className="cc-loader">Chargement…</div></div>;
  }

  if (error) {
    return (
      <div className="cc-screen">
        <div className="cc-card cc-error">
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h1>Erreur</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const isCash = order.payment_method === 'cod';

  if (done) {
    return (
      <div className="cc-screen">
        <div className="cc-card cc-success">
          <div style={{ fontSize: 64 }}>🎉</div>
          <h1>Merci {order.address?.name?.split(' ')[0]} !</h1>
          <p>Ta livraison est officiellement confirmée.</p>
          {order.delivery_rating ? (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 13, color: '#6B6B6B' }}>Tu as déjà noté cette livraison :</p>
              <p style={{ fontSize: 32, color: '#F4B53A' }}>{'★'.repeat(order.delivery_rating)}{'☆'.repeat(5 - order.delivery_rating)}</p>
            </div>
          ) : (
            <button 
              className="cc-btn-pri" 
              onClick={() => setShowRating(true)}
              style={{ marginTop: 20 }}
            >⭐ Noter ma livraison</button>
          )}
          <a href="/" className="cc-link">← Retour à l'app YARAM</a>
        </div>
        {showRating && (
          <RatingModal
            order={order}
            driverName={tracking?.delivery_person_name}
            onClose={() => { setShowRating(false); setOrder({ ...order, delivery_rating: order.delivery_rating || 0 }); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="cc-screen">
      <header className="cc-header">
        <div className="cc-logo">D</div>
        <div>
          <strong>YARAM</strong>
          <p>Confirmation de livraison</p>
        </div>
      </header>

      <main className="cc-main">
        <div className="cc-card">
          <div className="cc-greeting">
            <h1>Salut {order.address?.name?.split(' ')[0]} 👋</h1>
            <p>Le livreur indique avoir livré ta commande.</p>
          </div>

          <div className="cc-order-summary">
            <div className="cc-summary-row">
              <span>📦 Commande</span>
              <strong>{order.id}</strong>
            </div>
            <div className="cc-summary-row">
              <span>🛵 Livreur</span>
              <strong>{tracking?.delivery_person_name || '—'}</strong>
            </div>
            <div className="cc-summary-row">
              <span>💰 Montant</span>
              <strong>{order.total?.toLocaleString('fr-FR')} FCFA</strong>
            </div>
            <div className="cc-summary-row">
              <span>💳 Paiement</span>
              <strong>{isCash ? `💵 Cash ${order.cash_received ? '✓ remis' : ''}` : `✅ ${order.payment_method?.toUpperCase()}`}</strong>
            </div>
          </div>

          <div className="cc-articles">
            <h3>Articles livrés</h3>
            {order.items?.map((it, i) => (
              <div key={i} className="cc-item">
                <img src={it.img} alt="" loading="lazy" decoding="async" onError={(e) => e.target.style.display = 'none'} />
                <div>
                  <strong>{it.name}</strong>
                  <span>{it.qty} × {it.price.toLocaleString('fr-FR')} FCFA</span>
                </div>
              </div>
            ))}
          </div>

          {/* Preuve uploadée */}
          <div className="cc-proof">
            <h3>📸 Preuve de livraison</h3>
            {tracking?.delivery_photo_url && (
              <div className="cc-proof-item">
                <p>📷 Photo du colis remis :</p>
                <SignedImage src={tracking.delivery_photo_url} alt="Preuve" />
              </div>
            )}
            {tracking?.delivery_signature && (
              <div className="cc-proof-item">
                <p>✍️ Ta signature :</p>
                <img src={tracking.delivery_signature} alt="Signature" loading="lazy" decoding="async" style={{ background: 'white' }} />
              </div>
            )}
            {tracking?.delivery_pin && (
              <div className="cc-proof-item">
                <p>🔢 Code PIN dicté :</p>
                <div className="cc-pin">{tracking.delivery_pin}</div>
              </div>
            )}
            {!tracking?.delivery_photo_url && !tracking?.delivery_signature && !tracking?.delivery_pin && (
              <p style={{ color: '#9B9B9B' }}>Aucune preuve fournie</p>
            )}
          </div>

          <div className="cc-question">
            <h2>Confirmes-tu avoir bien reçu ta commande ?</h2>
            <p>Ta confirmation finalise la livraison.</p>
          </div>

          <div className="cc-actions">
            <button
              className="cc-btn-yes"
              onClick={confirmYes}
              disabled={submitting}
            >
              ✅ OUI, j'ai bien reçu
            </button>
            <button
              className="cc-btn-no"
              onClick={() => setShowDispute(true)}
              disabled={submitting}
            >
              ⚠️ J'ai un problème
            </button>
          </div>
        </div>
      </main>

      {showDispute && (
        <DisputeModal
          onSubmit={submitDispute}
          onCancel={() => setShowDispute(false)}
        />
      )}
    </div>
  );
}

function DisputeModal({ onSubmit, onCancel }) {
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  
  const reasons = [
    'Je n\'ai rien reçu',
    'Produits différents de ma commande',
    'Produits abîmés ou cassés',
    'Le livreur n\'est jamais passé',
    'Problème avec le montant cash',
    'Autre',
  ];
  
  const submit = () => {
    const finalReason = reason === 'Autre' ? customReason : reason;
    if (!finalReason.trim()) {
      toast.error('Sélectionne un motif');
      return;
    }
    onSubmit(finalReason);
  };
  
  return (
    <div className="cc-modal-overlay" onClick={onCancel}>
      <div className="cc-modal" onClick={e => e.stopPropagation()}>
        <h3>⚠️ Signaler un problème</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
          Choisis le motif. YARAM va te contacter rapidement.
        </p>
        <div className="cc-reasons">
          {reasons.map(r => (
            <button
              key={r}
              className={`cc-reason-btn ${reason === r ? 'active' : ''}`}
              onClick={() => setReason(r)}
            >{r}</button>
          ))}
        </div>
        {reason === 'Autre' && (
          <textarea
            value={customReason}
            onChange={e => setCustomReason(e.target.value)}
            placeholder="Décris ton problème..."
            rows={3}
            style={{
              width: '100%', padding: 12, marginTop: 10,
              border: '1px solid #DDD', borderRadius: 10,
              fontFamily: 'inherit', fontSize: 13,
            }}
          />
        )}
        <button className="cc-btn-yes" onClick={submit} style={{ marginTop: 16 }}>
          📨 Envoyer à YARAM
        </button>
        <button className="cc-btn-link" onClick={onCancel} style={{ marginTop: 8 }}>Annuler</button>
      </div>
    </div>
  );
}

function RatingModal({ order, driverName, onClose }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (rating === 0) { toast.error('Sélectionne au moins 1 étoile'); return; }
    setSaving(true);
    // Vague 13 RLS : UPDATE direct bloque, on passe par RPC client_rate_order
    await supabase.rpc('client_rate_order', {
      p_id_or_token: order.id,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="cc-modal-overlay" onClick={onClose}>
      <div className="cc-modal" onClick={e => e.stopPropagation()}>
        <h3 style={{ textAlign: 'center', fontSize: 22 }}>⭐ Note ta livraison</h3>
        <p style={{ textAlign: 'center', color: '#6B6B6B', fontSize: 13, marginBottom: 20 }}>
          Comment s'est passé avec {driverName || 'le livreur'} ?
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => setRating(n)}
              style={{
                background: 'transparent', border: 'none',
                fontSize: 40, cursor: 'pointer',
                color: n <= rating ? '#F4B53A' : '#DDD',
              }}>★</button>
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
          }} />
        <button className="cc-btn-yes" onClick={submit} disabled={saving}>
          {saving ? 'Envoi...' : '💚 Valider mon avis'}
        </button>
        <button className="cc-btn-link" onClick={onClose} style={{ marginTop: 8 }}>Plus tard</button>
      </div>
    </div>
  );
}
