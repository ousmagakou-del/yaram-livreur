import { useEffect, useState } from 'react';
import { useNav, useUser } from '../App';
import { supabase, updateOrderStatus } from '../lib/supabase';
import { sendEmail, sendOrderEmail, sendOrderConfirmation } from '../lib/emails';
import { getWhatsAppDisplay, getWhatsAppNumber } from '../lib/utils';
import { isNativeApp } from '../lib/platform';
import { toast } from '../lib/toast';
import { trackEvent } from '../lib/analytics';
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
    // ─── ANALYTICS : payment_started ───
    try {
      trackEvent('payment_started', {
        order_id: orderId,
        method: order?.payment_method,
        amount: order?.total,
      });
    } catch {}
    try {
      // ─── 1. Marque la commande payée — avec timeout généreux + retry auto ───
      // 30s par tentative × 2 tentatives = 60s max. Réseau LTE sénégalais peut
      // mettre 15-25s sur une RPC Supabase un jour de surcharge tour télécom.
      // Avant : 12s → trop court, le user voyait "Réseau lent" alors que la
      // requête aurait fini si on avait juste attendu un peu plus.
      const UPDATE_TIMEOUT_MS = 30000;
      const MAX_ATTEMPTS = 2;

      // ─── ANTI-FRAUDE WAVE ───
      // Pour Wave/OM/Card, le user passe en 'awaiting_verification' (pas 'paid').
      // L'admin doit confirmer manuellement via le dashboard après vérif du
      // virement réel (montant + référence). Empêche la fraude : user édite
      // l'URL Wave pour payer 100 FCFA sur commande de 200 000 FCFA, clique
      // "J'ai payé" → si on flippait direct en 'paid', il aurait la livraison.
      // Pour COD (cash livraison), on garde le flux actuel : pas de paiement
      // amont à vérifier, on passe en 'paid' (sera vérifié à la livraison).
      const targetStatus = order?.payment_method === 'cod' ? 'paid' : 'awaiting_verification';

      const callWithTimeout = () => {
        const p = updateOrderStatus(orderId, targetStatus);
        const t = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), UPDATE_TIMEOUT_MS)
        );
        return Promise.race([p, t]);
      };

      let result, lastErr;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          result = await callWithTimeout();
          lastErr = null;
          break; // succès, on sort de la boucle
        } catch (e) {
          lastErr = e;
          console.warn(`[Payment] attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e?.message);
          if (attempt < MAX_ATTEMPTS) {
            // Petit délai avant retry (laisse la connexion respirer)
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      }

      if (lastErr) {
        // Les 2 tentatives ont échoué — on affiche un message clair
        throw new Error('Réseau trop lent. Réessaie dans 30 secondes ou contacte-nous WhatsApp.');
      }

      // ─── FIX crash timeout : si result === null (timeout a gagné Promise.race),
      // on throw explicitement au lieu de laisser result?.error crash sur undefined. ───
      if (!result) {
        throw new Error('timeout');
      }

      // updateOrderStatus retourne { error } ou { data } — pas un throw.
      if (result?.error) {
        throw new Error(result.error.message || 'Échec de la confirmation');
      }

      // ─── 2. Navigation immédiate vers le tracking ───
      toast.success(
        targetStatus === 'awaiting_verification'
          ? 'Merci ! On vérifie ton paiement, livraison déclenchée dès confirmation.'
          : 'Paiement confirmé'
      );
      // ─── ANALYTICS : payment_succeeded (status 'paid' COD ou awaiting_verification autres) ───
      try {
        trackEvent('payment_succeeded', {
          order_id: orderId,
          method: order?.payment_method,
          amount: order?.total,
          status: targetStatus,
        });
      } catch {}
      setPaying(false);
      navigate({ name: 'order_tracking', params: { orderId } });

      // ─── 3. Notifs post-paiement FIRE-AND-FORGET ───
      runPostPaidNotifications({ orderId, order, user }).catch(e => {
        console.warn('[Payment] post-paid notifs swallowed error:', e?.message);
      });
    } catch (e) {
      console.error('[Payment] handlePay error:', e);
      // ─── ANALYTICS : payment_failed ───
      try {
        trackEvent('payment_failed', {
          order_id: orderId,
          method: order?.payment_method,
          reason: e?.message || 'unknown',
        });
      } catch {}
      setPaying(false);
      toast.error(e?.message || 'Erreur inconnue');
    }
  };

  // Helper isolé pour les notifs en background. Chaque op a son timeout pour
  // ne JAMAIS hang indéfiniment, même si l'edge function est down.
  const NOTIF_TIMEOUT_MS = 8000;
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), NOTIF_TIMEOUT_MS)),
    ]);

  async function runPostPaidNotifications({ orderId, order, user }) {
    // On lance les notifs EN PARALLÈLE (Promise.allSettled) avec timeout chacune.
    // Même si une fail, les autres continuent. Aucune ne bloque l'autre.
    const ops = [];

    // ─── EMAIL CLIENT CONFIRMATION ───
    // RÈGLE MÉTIER : on n'envoie la confirmation au client QUE si le paiement
    // est réellement validé (status = 'paid'). Pour Wave/OM/Card le status
    // est 'awaiting_verification' à ce stade — l'admin déclenchera l'email
    // depuis OrdersSection.confirmPayment quand il aura vérifié le virement.
    // Pour COD (cash livraison) le status est 'paid' direct → on envoie.
    const isCOD = order?.payment_method === 'cod';
    if (isCOD && user?.email) {
      ops.push(
        withTimeout(
          // Nouveau wrapper qui fetch l'order + profile et build le bon template
          // côté DB → plus robuste que sendEmail({template}) qui dépendait
          // d'avoir un order complet en mémoire.
          sendOrderConfirmation(orderId, user.id),
          'client email'
        ).catch(e => console.warn('client email:', e?.message))
      );
    }

    // Le pharmacien doit voir la commande à préparer dès maintenant (peu
    // importe que le paiement soit awaiting_verification ou paid — il y a
    // déjà un signal commercial fort que c'est une commande à traiter).
    ops.push(
      withTimeout(sendOrderEmail(orderId, 'pharmacyNewOrder'), 'pharma email')
        .catch(e => console.warn('pharma email:', e?.message))
    );

    // Broadcast : fire-and-forget pur. Pas d'await sur .send() qui peut hang.
    // On wrap dans try synchrone juste pour catch un éventuel throw au build du channel.
    try {
      const pharmaIds = [...new Set((order?.items || []).map(it => it.pharmacy_id || it.pharmacyId).filter(Boolean))];
      const ch = supabase.channel('yaram-new-orders');
      // .send() retourne une Promise — on la lance sans await, avec timeout pour cleanup
      ops.push(
        withTimeout(
          ch.send({
            type: 'broadcast',
            event: 'new_order',
            payload: { order_id: orderId, total: order?.total, pharmacy_ids: pharmaIds, created_at: order?.created_at },
          }),
          'broadcast'
        ).catch(e => console.warn('broadcast:', e?.message))
      );
    } catch (e) {
      console.warn('broadcast setup failed:', e?.message);
    }

    await Promise.allSettled(ops);
  }

  // ─── PayTech : intégration auto (cartes + wallets via redirection) ───
  const handlePayTech = async () => {
    if (!order?.id) return;
    setCreatingPayTech(true);
    // ─── ANALYTICS : payment_started (PayTech) ───
    try {
      trackEvent('payment_started', {
        order_id: order.id,
        method: order?.payment_method || 'paytech',
        amount: order?.total,
        provider: 'paytech',
      });
    } catch {}
    try {
      // Pour preorder : on charge SEULEMENT l'acompte (50%) maintenant,
      // pas le total. Le solde sera demandé à l'arrivée de l'import.
      const chargeAmount = order.is_preorder && order.deposit_amount
        ? Number(order.deposit_amount)
        : Number(order.total);

      const { data, error: fnErr } = await supabase.functions.invoke('paytech-create-payment', {
        body: {
          order_id: order.id,
          amount: chargeAmount,
          is_preorder: !!order.is_preorder,
          item_name: `YARAM ${order.is_preorder ? 'Acompte ' : ''}Commande ${order.id}`,
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
            if (refreshed?.status === 'paid' || refreshed?.status === 'confirmed' || refreshed?.status === 'shipped' || refreshed?.status === 'delivered') {
              toast.success('✅ Paiement confirmé !');
              navigate({ name: 'order_tracking', params: { orderId: order.id } });
            } else {
              // Pas encore confirmé (webhook PayTech en retard) → poll 5 sec puis re-check
              setTimeout(async () => {
                const { data: r2 } = await supabase.rpc('client_get_order_by_id', { p_order_id: order.id });
                if (r2?.status === 'paid' || r2?.status === 'confirmed' || r2?.status === 'shipped' || r2?.status === 'delivered') {
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
      // ─── ANALYTICS : payment_failed (PayTech) ───
      try {
        trackEvent('payment_failed', {
          order_id: order?.id,
          method: order?.payment_method || 'paytech',
          reason: e?.message || 'unknown',
          provider: 'paytech',
        });
      } catch {}
      toast.error('Paiement indisponible : ' + (e?.message || 'Erreur inconnue'));
    }
  };

  if (loading) return (
    /* PERF : skeleton page paiement (header + montant + 3 méthodes) */
    <div style={{ padding: '20px 16px' }}>
      <div className="skeleton-line" style={{ width: '40%', height: 24, marginBottom: 24 }} />
      <div className="skeleton-shimmer" style={{ width: '100%', height: 110, borderRadius: 16, marginBottom: 20 }} />
      <div className="skeleton-line" style={{ width: '30%', height: 14 }} />
      {[0, 1, 2].map((i) => (
        <div key={'sk-' + i} className="skeleton-shimmer" style={{ width: '100%', height: 64, borderRadius: 14, marginBottom: 10 }} />
      ))}
    </div>
  );
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
            <img src={WAVE_LOGO} alt="Wave" loading="lazy" decoding="async" style={{ height: 56, width: 'auto', objectFit: 'contain', borderRadius: 12 }} />
          )}
          {isOM && (
            <img src={OM_LOGO} alt="Orange Money" loading="lazy" decoding="async" style={{ height: 56, width: 'auto', objectFit: 'contain', borderRadius: 12 }} />
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
              <img src={WAVE_LOGO} alt="" loading="lazy" decoding="async" style={{ height: 20, marginRight: 8, verticalAlign: 'middle', borderRadius: 4 }} />
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
