import { useEffect, useState } from 'react';
import { useNav, useUser } from '../App';
import { supabase, updateOrderStatus } from '../lib/supabase';
import { sendEmail, sendOrderEmail } from '../lib/emails';
import { getWhatsAppDisplay, getWhatsAppNumber } from '../lib/utils';
import { isNativeApp } from '../lib/platform';
import { toast } from '../lib/toast';
import "./payment.css";

// Capacitor Browser : ouvre un browser in-app sur native (Safari View Controller iOS)
// → après paiement, l'user reste dans YARAM au lieu d'être éjecté vers Safari externe.
async function openPaymentBrowser(url) {
  if (!isNativeApp()) {
    // Web : redirection normale
    window.location.href = url;
    return null;
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover' });
    return Browser;
  } catch (e) {
    console.warn('[Payment] Browser plugin error, fallback redirect:', e?.message);
    window.location.href = url;
    return null;
  }
}

// ─── Logos officiels (déjà uploadés dans Supabase Storage) ───
const WAVE_LOGO = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/logo-wave.jpg';
const OM_LOGO   = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/logo-orange.png';

// ─── Wave Business Merchant ID YARAM ───
// Trouvé dans ton compte Wave Business → "Envoi de lien" → URL générée commence par
// https://pay.wave.com/m/M_sn_XXXXXXXX/c/sn/
// Format URL paiement : https://pay.wave.com/m/{MERCHANT_ID}/c/sn?amount=XXXX
// → ouvre directement l'app Wave avec le montant prefilé.
const WAVE_MERCHANT_ID = 'M_sn_1n3_7fYSI-Io';

export default function Payment({ orderId }) {
  const { navigate } = useNav();
  const { user } = useUser();
  const [order, setOrder] = useState(null);
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null); // 'number' | 'amount' | 'ref'
  const [creatingPayTech, setCreatingPayTech] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: rpcErr } = await supabase.rpc('client_get_order_by_id', { p_order_id: orderId });
        if (cancelled) return;
        if (rpcErr) throw new Error(rpcErr.message || 'rpc_failed');
        if (!data) throw new Error('order_not_found');
        setOrder(data);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Erreur de chargement de la commande');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [orderId]);

  // ─── Helpers UX ───
  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success('Copié !');
      setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error('Erreur de copie');
    }
  };

  const handlePay = async () => {
    setPaying(true);
    try {
      // 1. Marque la commande comme payée
      await updateOrderStatus(orderId, 'paid');

      // 2. ─── NOTIFS post-paiement (déclenchées MAINTENANT, pas avant) ───
      // Pourquoi : éviter que la pharmacie prépare une commande non payée.
      // Une fois le user a cliqué "J'ai payé" → on lance toutes les notifs.
      try {
        // Email client de confirmation
        if (user?.email) {
          await sendEmail({
            to: user.email,
            template: 'orderConfirmed',
            params: {
              firstName: user.first_name || 'Toi',
              order,
            },
          }).catch(e => console.warn('client email failed:', e?.message));
        }
        // Email pharmacie : nouvelle commande à préparer
        await sendOrderEmail(orderId, 'pharmacyNewOrder')
          .catch(e => console.warn('pharma email failed:', e?.message));

        // Broadcast realtime : ping admin + pharmacies pour refresh instant
        try {
          const pharmaIds = [...new Set((order?.items || []).map(it => it.pharmacy_id || it.pharmacyId).filter(Boolean))];
          await supabase.channel('yaram-new-orders').send({
            type: 'broadcast',
            event: 'new_order',
            payload: {
              order_id: orderId,
              total: order?.total,
              pharmacy_ids: pharmaIds,
              created_at: order?.created_at,
            },
          });
        } catch (e) {
          console.warn('broadcast new_order failed:', e?.message);
        }
      } catch (notifErr) {
        console.warn('[Payment] post-paid notifs failed (non-bloquant):', notifErr?.message);
      }

      toast.success('Paiement confirmé');
      navigate({ name: 'order_tracking', params: { orderId } });
    } catch (e) {
      setPaying(false);
      toast.error('Erreur : ' + e.message);
    }
  };

  // ─── PayTech : intégration auto (cartes + wallets via redirection) ───
  const handlePayTech = async () => {
    if (!order?.id) return;
    setCreatingPayTech(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('paytech-create-payment', {
        body: {
          order_id: order.id,
          amount: order.total,
          item_name: `YARAM Commande ${order.id}`,
          target_payment: order.payment_method === 'wave' ? 'Wave'
                       : order.payment_method === 'om'   ? 'Orange Money'
                       : null,
        },
      });
      if (fnErr || !data?.redirect_url) {
        throw new Error(fnErr?.message || data?.error || 'Erreur PayTech');
      }

      // Ouvre PayTech dans un browser in-app (iOS/Android natif) ou redirige (web)
      const browser = await openPaymentBrowser(data.redirect_url);

      // ─── Sur natif : écoute la fermeture du browser pour refetch le statut ───
      if (browser && isNativeApp()) {
        const listener = await browser.addListener('browserFinished', async () => {
          listener.remove();
          // Le user a fermé le browser → on refetch le statut commande
          // (l'IPN webhook a peut-être déjà confirmé le paiement)
          try {
            toast('Vérification du paiement…');
            const { data: refreshed } = await supabase.rpc('client_get_order_by_id', { p_order_id: order.id });
            if (refreshed?.status === 'paid' || refreshed?.status === 'shipped' || refreshed?.status === 'delivered') {
              toast.success('✅ Paiement confirmé !');
              navigate({ name: 'order_tracking', params: { orderId: order.id } });
            } else {
              // Pas encore confirmé (webhook PayTech en retard) → poll 5 sec puis re-check
              setTimeout(async () => {
                const { data: r2 } = await supabase.rpc('client_get_order_by_id', { p_order_id: order.id });
                if (r2?.status === 'paid' || r2?.status === 'shipped' || r2?.status === 'delivered') {
                  toast.success('✅ Paiement confirmé !');
                  navigate({ name: 'order_tracking', params: { orderId: order.id } });
                } else {
                  toast('Paiement en cours de confirmation. Si problème, contacte-nous WhatsApp.');
                  setOrder(r2 || order);
                  setCreatingPayTech(false);
                }
              }, 5000);
            }
          } catch (e) {
            console.warn('[Payment] refetch after browser close failed:', e?.message);
            setCreatingPayTech(false);
          }
        });
      }
    } catch (e) {
      setCreatingPayTech(false);
      toast.error('Paiement indisponible : ' + (e?.message || 'Erreur inconnue'));
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  if (error) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ marginBottom: 8 }}>Erreur</h2>
      <p style={{ color: '#666', marginBottom: 20 }}>{error}</p>
      <button className="btn-primary" onClick={() => navigate('/')}>Retour</button>
    </div>
  );
  if (!order) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <p>Commande introuvable</p>
      <button className="btn-primary" onClick={() => navigate('/')}>Retour</button>
    </div>
  );

  const yaramNumberDisplay = getWhatsAppDisplay();     // "+221 77 438 87 66"
  const yaramNumberRaw     = getWhatsAppNumber();       // "221774388766"
  const amountStr          = order.total.toLocaleString('fr-FR');
  const isWave             = order.payment_method === 'wave';
  const isOM               = order.payment_method === 'om';
  const isCOD              = order.payment_method === 'cod';
  const isCard             = order.payment_method === 'card';

  return (
    <div className="pay-screen page-anim">
      <div className="pay-content">
        {/* Logo officiel du moyen de paiement (au lieu d'emoji fallback) */}
        <div className="pay-icon" style={{ marginBottom: 8 }}>
          {isWave && (
            <img src={WAVE_LOGO} alt="Wave" style={{ height: 56, width: 'auto', objectFit: 'contain', borderRadius: 12 }} />
          )}
          {isOM && (
            <img src={OM_LOGO} alt="Orange Money" style={{ height: 56, width: 'auto', objectFit: 'contain', borderRadius: 12 }} />
          )}
          {isCOD && <span style={{ fontSize: 48 }}>💵</span>}
          {isCard && <span style={{ fontSize: 48 }}>💳</span>}
        </div>

        <h1>Confirme le paiement</h1>
        <div className="pay-order-id">Commande {order.id}</div>
        <div className="pay-amount">{amountStr} <small>FCFA</small></div>

        {/* ─── WAVE : carte verte avec action bouton + copy ─── */}
        {isWave && (
          <div className="pay-card pay-card-wave">
            <div className="pay-row">
              <span className="pay-label">📱 Numéro YARAM</span>
              <button className="pay-copy-btn" onClick={() => copyToClipboard(yaramNumberRaw, 'number')}>
                {copied === 'number' ? '✓ Copié' : '📋 Copier'}
              </button>
            </div>
            <div className="pay-value">{yaramNumberDisplay}</div>

            <div className="pay-row" style={{ marginTop: 14 }}>
              <span className="pay-label">💰 Montant</span>
              <button className="pay-copy-btn" onClick={() => copyToClipboard(String(order.total), 'amount')}>
                {copied === 'amount' ? '✓ Copié' : '📋 Copier'}
              </button>
            </div>
            <div className="pay-value">{amountStr} FCFA</div>

            <div className="pay-row" style={{ marginTop: 14 }}>
              <span className="pay-label">🔖 Référence</span>
              <button className="pay-copy-btn" onClick={() => copyToClipboard(order.id, 'ref')}>
                {copied === 'ref' ? '✓ Copié' : '📋 Copier'}
              </button>
            </div>
            <div className="pay-value">{order.id}</div>

            {/* Action principale : ouvrir Wave directement */}
            <a
              href={`https://pay.wave.com/m/${WAVE_MERCHANT_ID}/c/sn?amount=${order.total}`}
              target="_blank"
              rel="noopener noreferrer"
              className="pay-action-wave"
              style={{ marginTop: 18 }}
            >
              <img src={WAVE_LOGO} alt="" style={{ height: 20, marginRight: 8, verticalAlign: 'middle', borderRadius: 4 }} />
              Ouvrir Wave et payer
            </a>
          </div>
        )}

        {/* ─── ORANGE MONEY : carte orange avec action USSD ─── */}
        {isOM && (
          <div className="pay-card pay-card-om">
            <div className="pay-step">
              <span className="pay-step-num">1</span>
              <span>Compose le code suivant sur ton téléphone</span>
            </div>
            <a
              href={`tel:%23144%2A8%2A1%2A${order.total}%23`}
              className="pay-ussd-btn"
            >
              <span style={{ fontSize: 18 }}>#144*8*1*{order.total}#</span>
              <span style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>Tap pour composer →</span>
            </a>

            <div className="pay-step" style={{ marginTop: 18 }}>
              <span className="pay-step-num">2</span>
              <span>Envoie au numéro YARAM</span>
            </div>
            <div className="pay-row" style={{ marginTop: 6 }}>
              <div className="pay-value">{yaramNumberDisplay}</div>
              <button className="pay-copy-btn" onClick={() => copyToClipboard(yaramNumberRaw, 'number')}>
                {copied === 'number' ? '✓' : '📋'}
              </button>
            </div>

            <div className="pay-step" style={{ marginTop: 18 }}>
              <span className="pay-step-num">3</span>
              <span>Réfère ta commande : <strong>{order.id}</strong></span>
            </div>
          </div>
        )}

        {/* ─── CASH ─── */}
        {isCOD && (
          <div className="pay-card pay-card-cod">
            <p style={{ fontSize: 16, lineHeight: 1.5, color: '#444' }}>
              Tu paieras <strong>{amountStr} FCFA</strong> en cash au livreur YARAM à l'arrivée.
            </p>
            <p style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
              Pas besoin de pré-payer. Prépare juste l'appoint pour gagner du temps 🙏
            </p>
          </div>
        )}

        {/* ─── CARTE BANCAIRE ─── */}
        {isCard && (
          <div className="pay-card pay-card-card">
            <p style={{ fontSize: 14, color: '#444' }}>
              Paiement carte sécurisé via PayTech.
            </p>
          </div>
        )}

        {/* ─── PayTech : désactivé pour l'instant (juin 2026), code conservé pour réactivation future ───
        {(isWave || isOM || isCard) && (
          <button
            className="pay-paytech-btn"
            onClick={handlePayTech}
            disabled={creatingPayTech}
            style={{ marginTop: 14 }}
          >
            {creatingPayTech ? '⏳ Préparation…' : '🔒 Payer automatiquement (PayTech)'}
          </button>
        )}
        */}

        {/* ─── ACTION PRINCIPALE : confirmation manuelle ─── */}
        <button
          className="btn-primary"
          onClick={handlePay}
          disabled={paying}
          style={{ marginTop: 14 }}
        >
          {paying ? 'Confirmation…' : isCOD ? "C'est noté →" : "J'ai payé →"}
        </button>

        {/* ─── Lien support WhatsApp ─── */}
        <a
          href={`https://wa.me/${yaramNumberRaw}?text=${encodeURIComponent(
            `Bonjour, j'ai un souci avec le paiement de ma commande ${order.id} (${amountStr} FCFA via ${
              isWave ? 'Wave' : isOM ? 'Orange Money' : isCOD ? 'Cash' : 'Carte'
            })`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="pay-help-link"
        >
          💬 Besoin d'aide ? Contacte-nous WhatsApp
        </a>
      </div>
    </div>
  );
}
