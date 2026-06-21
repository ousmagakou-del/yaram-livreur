import { useState, useEffect, useRef } from 'react';
import { supabase, sendWhatsApp, WhatsAppTemplates, generateConfirmToken, compressImage } from '../lib/supabase';
import { sendOrderEmail } from '../lib/emails';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { toast, confirmDialog } from '../lib/toast';
import SignedImage from '../components/SignedImage';
import './Livreur.css';

// URL + key Supabase lus depuis import.meta.env ou fallback (centralise lib/supabase).
// (Avant : dupliques en dur dans 5 fichiers — risque de drift au prochain rotation de cle.)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

export default function Livreur() {
  const [order, setOrder] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharingGPS, setSharingGPS] = useState(false);
  const [currentPos, setCurrentPos] = useState(null);
  const [showPhotoCapture, setShowPhotoCapture] = useState(null);
  const [showSignature, setShowSignature] = useState(false);
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [proofMethod, setProofMethod] = useState(null);
  const [confirming, setConfirming] = useState(false);
  // ─── busyStep : quel bouton est en cours d'action ? ───
  // Permet l'aria-busy + spinner CSS + désactivation pour empêcher le double-tap.
  // Une seule étape active à la fois (lock optimiste).
  const [busyStep, setBusyStep] = useState(null);
  const watchIdRef = useRef(null);

  // ─── Haptique : feedback tactile sur Capacitor iOS/Android, fallback vibrate ───
  const haptic = async (type = 'light') => {
    try {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      if (type === 'success') await Haptics.notification({ type: NotificationType.Success });
      else if (type === 'error') await Haptics.notification({ type: NotificationType.Error });
      else if (type === 'medium') await Haptics.impact({ style: ImpactStyle.Medium });
      else await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Web fallback
      if (navigator.vibrate) navigator.vibrate(type === 'success' ? [40, 40, 80] : 40);
    }
  };

  // ─── Helper RPC : check error/success + toast unique. Renvoie true si OK. ───
  const rpcOk = (result, label) => {
    if (result?.error) {
      console.error(`[Livreur] ${label} RPC error:`, result.error);
      toast.error(`${label} : ${result.error.message || 'RPC en échec'}`);
      haptic('error');
      return false;
    }
    if (result?.data && result.data.success === false) {
      console.error(`[Livreur] ${label} RPC business error:`, result.data);
      toast.error(`${label} refusé : ${result.data.error || 'opération non autorisée'}`);
      haptic('error');
      return false;
    }
    return true;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('livreur');
    if (t) {
      setToken(t);
      loadTracking(t);
    } else {
      setLoading(false);
      setError('Token manquant');
    }
    return () => stopGPS();
  }, []);

  const loadTracking = async (t) => {
    // RPC livreur_load_delivery (SECURITY DEFINER) — v2 retourne errors dans data
    // au lieu de raise exception, pour debug facile.
    const { data, error } = await supabase.rpc('livreur_load_delivery', { p_token: t });

    // Erreur de transport (réseau, RPC absente, etc.)
    if (error) {
      console.error('[Livreur] RPC transport error:', error);
      const msg = error.message || '';
      setError(
        msg.includes('does not exist')
          ? 'Service livreur indisponible — contacte l\'admin'
          : msg.includes('tracking_not_found')
            ? 'Lien invalide ou expiré'
            : `Erreur de chargement : ${msg.slice(0, 120) || 'inconnue'}`
      );
      setLoading(false);
      return;
    }

    // RPC a répondu mais signale une erreur métier dans le body
    if (!data || data.error) {
      console.error('[Livreur] RPC business error:', data);
      setError(
        data?.error === 'tracking_not_found'
          ? 'Lien invalide ou expiré'
          : `Erreur : ${data?.error || 'donnée vide'} ${data?.error_code ? `(${data.error_code})` : ''}`
      );
      setLoading(false);
      return;
    }

    const tr = data.tracking || null;
    if (!tr) {
      setError('Lien invalide ou expiré');
      setLoading(false);
      return;
    }

    setTracking(tr);
    setOrder(data.order || null);
    setPharmacies(Array.isArray(data.pharmacies) ? data.pharmacies : []);

    if (tr?.delivery_photo_url) setProofMethod('photo');
    else if (tr?.delivery_signature) setProofMethod('signature');
    else if (tr?.delivery_pin) setProofMethod('pin');

    setLoading(false);
  };

  const startGPS = () => {
    if (!navigator.geolocation) { toast.error('GPS non disponible'); return; }
    setSharingGPS(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCurrentPos({ lat, lng });
        // GPS push : log d'erreur non-bloquant (un tick toutes les 5s, on
        // peut pas spammer le toast). La SQL accepte current_lat/lng OU
        // livreur_lat/lng. Si la RPC fail, le livreur continue de partager
        // localement, juste l'admin ne voit pas la position.
        const { error: gpsErr } = await supabase.rpc('livreur_update_tracking', {
          p_token: token,
          p_patch: { current_lat: lat, current_lng: lng, last_update: new Date().toISOString() },
        });
        if (gpsErr) console.warn('[Livreur] GPS push warn:', gpsErr.message);
      },
      (err) => { toast.error('Erreur GPS : ' + err.message); setSharingGPS(false); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
  };

  const stopGPS = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharingGPS(false);
  };

  // ─── updateStatus avec OPTIMISTIC UPDATE + ROLLBACK ───
  // Pattern : on met à jour le state local IMMÉDIATEMENT, on lance la RPC,
  // si elle fail on rollback. Résultat : l'UI réagit en < 50ms au lieu d'attendre
  // 500-1000ms de RTT Supabase. Plus de "rien ne se passe quand je tape".
  const updateStatus = async (newStatus, extraFields = {}, stepKey = null) => {
    const updates = { status: newStatus, last_update: new Date().toISOString(), ...extraFields };
    const prevTracking = tracking;

    if (stepKey) setBusyStep(stepKey);
    haptic('light');

    // 1. OPTIMISTIC : on patch le state local AVANT la RPC
    setTracking(prev => prev ? { ...prev, ...updates } : prev);

    // 2. RPC réelle
    const result = await supabase.rpc('livreur_update_tracking', { p_token: token, p_patch: updates });

    // 3. Rollback si fail
    if (!rpcOk(result, 'Mise à jour')) {
      setTracking(prevTracking);
      if (stepKey) setBusyStep(null);
      return false;
    }

    // 4. Side-effect pour 'in_route' → on marque aussi l'order comme shipped
    if (newStatus === 'in_route' && order) {
      const orderResult = await supabase.rpc('livreur_update_order', { p_token: token, p_patch: { status: 'shipped' } });
      if (orderResult?.error) console.warn('[Livreur] update_order error (non-bloquant):', orderResult.error?.message);
      // Email cliente : "ton livreur est en route"
      sendOrderEmail(order.id, 'orderShipped').catch(e => console.warn('shipped email failed:', e?.message));
    }

    // 5. Resync différé (300ms) pour récupérer les champs server-side (timestamps DB)
    //    sans casser l'optimistic update si l'utilisateur clique entre-temps.
    setTimeout(() => loadTracking(token), 300);

    if (stepKey) setBusyStep(null);
    haptic('success');
    return true;
  };

  const uploadPhoto = async (file, type) => {
    if (!file) return null;
    // ─── Compression avant upload ───
    // Avant : photo brute iPhone (5-10 MB) uploadée telle quelle → 30s+ sur 4G,
    // bande passante data du livreur consommée, parfois fail.
    // Apres : compress a max 1200px / 75% jpeg → 100-300 KB.
    let uploadFile = file;
    try {
      const compressed = await compressImage(file, 1200, 0.75);
      if (compressed && compressed.size > 0) uploadFile = compressed;
    } catch {
      // Si la compression echoue (cas rare), on upload le fichier original
    }
    const fileName = `${token}/${type}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('delivery-proofs')
      .upload(fileName, uploadFile, { contentType: 'image/jpeg', upsert: true });
    if (error) { toast.error('Erreur upload : ' + error.message); return null; }
    const { data } = supabase.storage.from('delivery-proofs').getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handlePhotoCapture = async (file, type) => {
    const url = await uploadPhoto(file, type);
    if (!url) return;
    const fieldMap = {
      pickup_before: 'pickup_before_photo_url',
      pickup_after: 'pickup_after_photo_url',
      pickup: 'pickup_photo_url',
      product: 'product_photo_url',
      delivery: 'delivery_photo_url',
    };
    const fieldName = fieldMap[type] || `${type}_photo_url`;

    // OPTIMISTIC : on affiche la miniature tout de suite
    const prevTracking = tracking;
    setTracking(prev => prev ? { ...prev, [fieldName]: url } : prev);

    const result = await supabase.rpc('livreur_update_tracking', {
      p_token: token,
      p_patch: { [fieldName]: url },
    });
    if (!rpcOk(result, 'Photo')) {
      setTracking(prevTracking);
      return;
    }

    setShowPhotoCapture(null);
    if (type === 'delivery') {
      setProofMethod('photo');
      toast.success('Photo enregistrée ! Confirme la livraison maintenant.');
    } else {
      toast.success('Photo enregistrée');
    }
    haptic('success');
    setTimeout(() => loadTracking(token), 300);
  };

  const handleBarcodeScan = async (barcode) => {
    const scanned = tracking?.scanned_barcodes || [];
    const newScanned = [...scanned, {
      code: barcode,
      scanned_at: new Date().toISOString(),
    }];

    // OPTIMISTIC : le compteur s'incrémente tout de suite
    const prevTracking = tracking;
    setTracking(prev => prev ? { ...prev, scanned_barcodes: newScanned } : prev);

    const result = await supabase.rpc('livreur_update_tracking', {
      p_token: token,
      p_patch: { scanned_barcodes: newScanned },
    });
    if (!rpcOk(result, 'Scan')) {
      setTracking(prevTracking);
      return;
    }

    haptic('success');
    setTimeout(() => loadTracking(token), 300);

    if (navigator.vibrate) navigator.vibrate(100);
    setShowBarcodeScanner(false);
  };

  const handleSignatureSubmit = async (signatureData) => {
    const prev = tracking;
    setTracking(p => p ? { ...p, delivery_signature: signatureData } : p);

    const result = await supabase.rpc('livreur_update_tracking', {
      p_token: token, p_patch: { delivery_signature: signatureData },
    });
    if (!rpcOk(result, 'Signature')) { setTracking(prev); return; }

    setShowSignature(false);
    setProofMethod('signature');
    haptic('success');
    setTimeout(() => loadTracking(token), 300);
    toast.success('Signature enregistrée ! Confirme la livraison maintenant.');
  };

  const handlePinSubmit = async (pin) => {
    const prev = tracking;
    setTracking(p => p ? { ...p, delivery_pin: pin } : p);

    const result = await supabase.rpc('livreur_update_tracking', {
      p_token: token, p_patch: { delivery_pin: pin },
    });
    if (!rpcOk(result, 'PIN')) { setTracking(prev); return; }

    setShowPinEntry(false);
    setProofMethod('pin');
    haptic('success');
    setTimeout(() => loadTracking(token), 300);
    toast.success('PIN enregistré ! Confirme la livraison maintenant.');
  };

  const markCashReceived = async () => {
    // CRITIQUE financier : si la RPC fail, on NE marque PAS cash_received
    // côté UI. Sinon admin verrait commande livrée sans cash collecté = perte.
    setBusyStep('cash');
    const prevOrder = order;
    setOrder(o => o ? { ...o, cash_received: true } : o);

    const result = await supabase.rpc('livreur_update_order', {
      p_token: token,
      p_patch: { cash_received: true, cash_received_at: new Date().toISOString() },
    });
    if (!rpcOk(result, 'Cash')) {
      setOrder(prevOrder);
      setBusyStep(null);
      return;
    }

    const statusOk = await updateStatus('cash_collected', {}, 'cash');
    if (!statusOk) { setOrder(prevOrder); setBusyStep(null); return; }

    haptic('success');
    toast.success('Cash de ' + (order.total || 0).toLocaleString('fr-FR') + ' FCFA confirmé reçu.');
    setBusyStep(null);
  };

  const confirmDelivery = async () => {
    if (!proofMethod) {
      toast.error('Tu dois fournir au moins une preuve : photo, signature ou PIN');
      return;
    }

    if (order.payment_method === 'cod' && !order.cash_received) {
      toast.error('Tu dois d\'abord confirmer la réception du cash !');
      return;
    }

    setConfirming(true);

    // 1. Génère et persiste le token confirmation si pas déjà fait
    let confirmToken = order.confirmation_token;
    if (!confirmToken) {
      confirmToken = generateConfirmToken();
      const tokRes = await supabase.rpc('livreur_update_order', {
        p_token: token,
        p_patch: { confirmation_token: confirmToken },
      });
      if (!rpcOk(tokRes, 'Token confirmation')) {
        setConfirming(false);
        return;
      }
    }

    // 2. Passe l'order en awaiting_confirm
    const statusRes = await supabase.rpc('livreur_update_order', {
      p_token: token,
      p_patch: { status: 'awaiting_confirm', awaiting_confirm_at: new Date().toISOString() },
    });
    if (!rpcOk(statusRes, 'Awaiting confirm')) {
      setConfirming(false);
      return;
    }

    // 3. Marque le tracking proof_uploaded
    const trackOk = await updateStatus('proof_uploaded');
    if (!trackOk) {
      setConfirming(false);
      return;
    }

    // 4. WhatsApp à la cliente avec lien de confirmation (token vraiment en DB maintenant)
    const confirmUrl = `${window.location.origin}/?confirm=${confirmToken}`;
    if (order.address?.phone) {
      const msg = order.payment_method === 'cod'
        ? WhatsAppTemplates.orderAwaitingConfirmCash(order.address.name, order.id, order.total, confirmUrl)
        : WhatsAppTemplates.orderAwaitingConfirm(order.address.name, order.id, confirmUrl);
      sendWhatsApp(order.address.phone, msg).then(r => console.log('Confirm WhatsApp:', r));
    }

    stopGPS();
    setConfirming(false);
    haptic('success');
    toast.success('Livraison signalée ! La cliente reçoit un WhatsApp pour confirmer. Merci pour ton service 💚', { duration: 5000 });
  };

  if (loading) {
    return (
      <div className="liv-screen">
        <header className="liv-header">
          <div className="liv-logo">D</div>
          <div>
            <strong>YARAM · Livraison</strong>
            <p>Chargement de ta tournée…</p>
          </div>
        </header>
        <main className="liv-main">
          <div className="liv-skeleton" />
          <div className="liv-skeleton" style={{ height: 120 }} />
          <div className="liv-skeleton" style={{ height: 180 }} />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="liv-screen">
        <div className="liv-card" style={{ margin: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h1>Erreur</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const isCash = order?.payment_method === 'cod';
  const clientWaUrl = order?.address?.phone ? 'https://wa.me/' + order.address.phone.replace(/\D/g, '') : null;
  const clientMapsUrl = order?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.address.line}, ${order.address.city}`)}` : null;
  // ─── stepDone : check si une étape est franchie ───
  // BUG FIX : avant, si tracking.status n'était pas dans ord (ex: 'pending',
  // 'created', null, undefined), indexOf retournait -1 → -1 >= n est TOUJOURS
  // false pour n >= 0 → toutes les étapes apparaissaient comme non franchies
  // mais le livreur cliquait sur "Je suis là" qui demandait stepDone('picking')
  // pour les suivantes — bloqué. Maintenant on traite null/inconnu comme 'assigned'.
  const stepDone = (s) => {
    const ord = ['assigned', 'picking', 'picked', 'in_route', 'arrived', 'cash_collected', 'proof_uploaded', 'delivered'];
    const status = tracking?.status || 'assigned';
    const cur = ord.indexOf(status);
    const target = ord.indexOf(s);
    // Si status inconnu (cur=-1), on traite comme 'assigned' (cur=0), pas comme -1
    const curSafe = cur < 0 ? 0 : cur;
    return target >= 0 && curSafe >= target;
  };

  const isCompleted = ['awaiting_confirm', 'delivered'].includes(order?.status);
  const scannedCount = (tracking?.scanned_barcodes || []).length;
  const totalProducts = (order?.items || []).reduce((sum, it) => sum + (it.qty || 1), 0);
  const allScanned = scannedCount >= totalProducts && totalProducts > 0;

  return (
    <div className="liv-screen">
      <header className="liv-header">
        <div className="liv-logo">D</div>
        <div>
          <strong>YARAM · Livraison</strong>
          <p>{tracking?.delivery_person_name || 'Livreur'}</p>
        </div>
      </header>

      <main className="liv-main">
        <div className="liv-card">
          <div className="liv-card-head">
            <code>{order?.id}</code>
            <span className={`liv-badge ${isCompleted ? 'liv-status-delivered' : `liv-status-${tracking?.status}`}`}>
              {isCompleted ? '⏳ En attente confirmation cliente'
                : tracking?.status === 'assigned' ? '⏳ Assignée'
                : tracking?.status === 'picking' ? '🏥 Récup pharmacie'
                : tracking?.status === 'picked' ? '✅ Récupérée'
                : tracking?.status === 'in_route' ? '🛵 En route'
                : tracking?.status === 'arrived' ? '📍 Arrivé'
                : tracking?.status === 'cash_collected' ? '💵 Cash reçu'
                : tracking?.status === 'proof_uploaded' ? '📷 Preuve uploadée'
                : '🎉 Livré'}
            </span>
          </div>
        </div>

        {/* PICKUP — PHARMACIE(S) */}
        {pharmacies.length > 0 && (
          <div className="liv-card" style={{ borderLeft: '4px solid #1F8B4C' }}>
            <h2>🏥 PICKUP — Récupération</h2>
            {pharmacies.map(ph => {
              const phPhone = ph.phone || ph.whatsapp;
              const phWaUrl = phPhone ? 'https://wa.me/' + phPhone.replace(/\D/g, '') : null;
              const phMapsUrl = (ph.lat && ph.lng) 
                ? `https://www.google.com/maps/dir/?api=1&destination=${ph.lat},${ph.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ph.address || ph.neighborhood || ''}, ${ph.city || 'Dakar'}`)}`;
              
              return (
                <div key={ph.id} style={{
                  background: '#F9FAFB',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 10,
                  border: '1px solid #EEE',
                }}>
                  <strong style={{ fontSize: 15, color: '#1A1A1A', display: 'block', marginBottom: 6 }}>
                    {ph.name}
                  </strong>
                  {ph.tagline && (
                    <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 6 }}>
                      {ph.tagline}
                    </p>
                  )}
                  <p style={{ fontSize: 13, marginBottom: 4 }}>
                    📍 {ph.address || ph.neighborhood}{ph.city ? ', ' + ph.city : ''}
                  </p>
                  {phPhone && (
                    <p style={{ fontSize: 13, marginBottom: 4 }}>
                      📞 <a href={`tel:${phPhone}`}>{phPhone}</a>
                    </p>
                  )}
                  {ph.hours && (
                    <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 8 }}>
                      ⏰ {ph.hours}
                    </p>
                  )}
                  
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {phWaUrl && (
                      <a href={phWaUrl} target="_blank" rel="noopener noreferrer" className="liv-wa-btn" style={{ flex: 1, minWidth: 80, textAlign: 'center' }}>
                        💬 WhatsApp
                      </a>
                    )}
                    {phPhone && (
                      <a href={`tel:${phPhone}`} className="liv-maps-btn" style={{ background: '#1F8B4C', color: 'white', flex: 1, minWidth: 80, textAlign: 'center' }}>
                        📞 Appeler
                      </a>
                    )}
                    <a href={phMapsUrl} target="_blank" rel="noopener noreferrer" className="liv-maps-btn" style={{ flex: 1, minWidth: 80, textAlign: 'center' }}>
                      🗺️ Itinéraire
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* DELIVERY — CLIENTE */}
        <div className="liv-card" style={{ borderLeft: '4px solid #1DC8F2' }}>
          <h2>🏠 DELIVERY — Livraison</h2>
          <div style={{
            background: '#F9FAFB',
            borderRadius: 10,
            padding: 14,
            border: '1px solid #EEE',
          }}>
            <strong style={{ fontSize: 15, color: '#1A1A1A', display: 'block', marginBottom: 6 }}>
              {order?.address?.name}
            </strong>
            <p style={{ fontSize: 13, marginBottom: 4 }}>
              📞 <a href={`tel:${order?.address?.phone}`}>{order?.address?.phone}</a>
            </p>
            <p style={{ fontSize: 13, marginBottom: 4 }}>
              📍 {order?.address?.line}
            </p>
            <p style={{ fontSize: 13 }}>
              {order?.address?.neighborhood}, {order?.address?.city}
            </p>
            
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {clientWaUrl && (
                <a href={clientWaUrl} target="_blank" rel="noopener noreferrer" className="liv-wa-btn" style={{ flex: 1, minWidth: 80, textAlign: 'center' }}>
                  💬 WhatsApp
                </a>
              )}
              {order?.address?.phone && (
                <a href={`tel:${order.address.phone}`} className="liv-maps-btn" style={{ background: '#1DC8F2', color: 'white', flex: 1, minWidth: 80, textAlign: 'center' }}>
                  📞 Appeler
                </a>
              )}
              {clientMapsUrl && (
                <a href={clientMapsUrl} target="_blank" rel="noopener noreferrer" className="liv-maps-btn" style={{ flex: 1, minWidth: 80, textAlign: 'center' }}>
                  🗺️ Itinéraire
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="liv-card">
          <h2>📦 Articles à livrer</h2>
          {Array.from(new Map((order?.items || []).map(it => [it.pharmacyId, it.pharmacyName]))).map(([phId, phName]) => (
            <div key={phId} className="liv-pharmacy-group">
              <strong>🏥 {phName}</strong>
              {(order?.items || []).filter(it => it.pharmacyId === phId).map((it, i) => (
                <div key={i} className="liv-item">
                  <span>{it.name}</span>
                  <span>×{it.qty}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="liv-total">
            <span>Total</span>
            <strong>{order?.total?.toLocaleString('fr-FR')} FCFA</strong>
          </div>
          {isCash ? (
            <div className="liv-cod-alert">
              💵 PAIEMENT CASH À LA LIVRAISON<br/>
              <strong style={{ fontSize: 16 }}>Encaisse {(order.total || 0).toLocaleString('fr-FR')} FCFA</strong>
            </div>
          ) : (
            <div className="liv-paid-alert">
              ✅ Déjà payé via {order?.payment_method?.toUpperCase()} — Rien à encaisser
            </div>
          )}
        </div>

        {!isCompleted && (
          <div className="liv-card">
            <h2>📡 Partage GPS</h2>
            {sharingGPS ? (
              <div>
                <div className="liv-gps-active">
                  <span className="liv-gps-dot" />
                  <strong>Position partagée en temps réel</strong>
                  <p>La cliente voit ta position</p>
                  {currentPos && (
                    <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>
                      📍 {currentPos.lat.toFixed(5)}, {currentPos.lng.toFixed(5)}
                    </p>
                  )}
                </div>
                <button className="liv-btn-stop" onClick={stopGPS}>⏸️ Pause GPS</button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
                  Active le GPS pour que la cliente suive ton arrivée
                </p>
                <button className="liv-btn-pri" onClick={startGPS}>📡 Partager ma position GPS</button>
              </div>
            )}
          </div>
        )}

        {!isCompleted && (
          <div className="liv-card">
            <h2>✅ Étapes de livraison</h2>
            <div className="liv-steps-enriched">
              
              <div className={`liv-step-card ${stepDone('picking') ? 'done' : ''} ${busyStep === 'picking' ? 'loading' : ''}`} style={{'--i': 0}}>
                <div className="liv-step-num">
                  {stepDone('picking') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark"/>
                    </svg>
                  ) : '1'}
                </div>
                <div className="liv-step-content">
                  <strong>🏥 J'arrive à la pharmacie</strong>
                  <p>Photo de la pharmacie (preuve d'arrivée)</p>
                  {tracking?.pickup_before_photo_url && <SignedImage src={tracking.pickup_before_photo_url} alt="" className="liv-thumb liv-fade-in" />}
                  <div className="liv-step-actions">
                    <button
                      className="liv-mini-btn"
                      onClick={() => setShowPhotoCapture('pickup_before')}
                      disabled={stepDone('picked') || busyStep === 'picking'}
                    >
                      📷 Photo avant
                    </button>
                    <button
                      className={stepDone('picking') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                      onClick={() => updateStatus('picking', {}, 'picking')}
                      disabled={stepDone('picking') || busyStep === 'picking'}
                      aria-busy={busyStep === 'picking'}
                    >
                      {stepDone('picking') ? '✓ Confirmé' : busyStep === 'picking' ? 'Envoi…' : 'Je suis là'}
                    </button>
                  </div>
                </div>
              </div>

              <div className={`liv-step-card ${allScanned ? 'done' : ''}`} style={{'--i': 1}}>
                <div className="liv-step-num">
                  {allScanned ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark"/>
                    </svg>
                  ) : '2'}
                </div>
                <div className="liv-step-content">
                  <strong>📊 Vérifier les produits</strong>
                  <p>Scanne le code-barres de chaque produit</p>
                  
                  <div style={{
                    background: allScanned ? '#E8F5EC' : '#FEF6E5',
                    color: allScanned ? '#1F8B4C' : '#A07700',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    marginBottom: 10,
                    textAlign: 'center',
                  }}>
                    {scannedCount} / {totalProducts} produits scannés
                    {allScanned && ' ✅'}
                  </div>

                  {scannedCount > 0 && (
                    <div style={{
                      background: '#F9FAFB',
                      borderRadius: 8,
                      padding: 8,
                      marginBottom: 10,
                      fontSize: 11,
                      maxHeight: 100,
                      overflowY: 'auto',
                    }}>
                      {(tracking?.scanned_barcodes || []).map((b, i) => (
                        <div key={i} style={{ padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{b.code}</span>
                          <span style={{ color: '#9B9B9B' }}>{new Date(b.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="liv-step-actions">
                    <button 
                      className="liv-mini-btn pri" 
                      onClick={() => setShowBarcodeScanner(true)}
                      disabled={!stepDone('picking') || allScanned}
                    >
                      📊 Scanner un code-barres
                    </button>
                    <button 
                      className="liv-mini-btn"
                      onClick={async () => {
                        if (!(await confirmDialog('Pas de code-barres sur certains produits ? On skip le scan ?'))) return;
                        // BUG FIX : avant on injectait UN SEUL barcode 'SKIPPED' → si
                        // totalProducts > 1, allScanned restait false donc "Tout pris"
                        // restait gelé. Maintenant on injecte N entrées pour matcher.
                        const skipPatch = Array.from({ length: Math.max(totalProducts, 1) }, (_, i) => ({
                          code: 'SKIPPED',
                          index: i,
                          scanned_at: new Date().toISOString(),
                        }));
                        const prev = tracking;
                        setTracking(p => p ? { ...p, scanned_barcodes: skipPatch } : p);
                        const result = await supabase.rpc('livreur_update_tracking', {
                          p_token: token,
                          p_patch: { scanned_barcodes: skipPatch },
                        });
                        if (!rpcOk(result, 'Skip')) { setTracking(prev); return; }
                        haptic('light');
                        setTimeout(() => loadTracking(token), 300);
                      }}
                      disabled={!stepDone('picking') || scannedCount > 0 || busyStep === 'skip'}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>

              <div className={`liv-step-card ${stepDone('picked') ? 'done' : ''} ${busyStep === 'picked' ? 'loading' : ''}`} style={{'--i': 2}}>
                <div className="liv-step-num">
                  {stepDone('picked') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark"/>
                    </svg>
                  ) : '3'}
                </div>
                <div className="liv-step-content">
                  <strong>📦 Produits récupérés</strong>
                  <p>Photo des produits avant de partir</p>
                  {tracking?.pickup_after_photo_url && <SignedImage src={tracking.pickup_after_photo_url} alt="" className="liv-thumb liv-fade-in" />}
                  <div className="liv-step-actions">
                    <button
                      className="liv-mini-btn"
                      onClick={() => setShowPhotoCapture('pickup_after')}
                      disabled={!allScanned || stepDone('in_route') || busyStep === 'picked'}
                    >
                      📷 Photo après
                    </button>
                    <button
                      className={stepDone('picked') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                      onClick={() => updateStatus('picked', {}, 'picked')}
                      disabled={!allScanned || stepDone('picked') || busyStep === 'picked'}
                      aria-busy={busyStep === 'picked'}
                    >
                      {stepDone('picked') ? '✓ Récupéré' : busyStep === 'picked' ? 'Envoi…' : 'Tout pris'}
                    </button>
                  </div>
                </div>
              </div>

              <div className={`liv-step-card ${stepDone('in_route') ? 'done' : ''} ${busyStep === 'in_route' ? 'loading' : ''}`} style={{'--i': 3}}>
                <div className="liv-step-num">
                  {stepDone('in_route') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark"/>
                    </svg>
                  ) : '4'}
                </div>
                <div className="liv-step-content">
                  <strong>🛵 En route vers la cliente</strong>
                  <p>{sharingGPS ? 'GPS actif · cliente notifiée' : 'Active le GPS d\'abord'}</p>
                  <button
                    className={stepDone('in_route') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                    onClick={() => updateStatus('in_route', {}, 'in_route')}
                    disabled={!stepDone('picked') || stepDone('in_route') || busyStep === 'in_route'}
                    aria-busy={busyStep === 'in_route'}
                  >
                    {stepDone('in_route') ? '✓ En route' : busyStep === 'in_route' ? 'Envoi…' : 'Je suis parti'}
                  </button>
                </div>
              </div>

              <div className={`liv-step-card ${stepDone('arrived') ? 'done' : ''} ${busyStep === 'arrived' ? 'loading' : ''}`} style={{'--i': 4}}>
                <div className="liv-step-num">
                  {stepDone('arrived') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark"/>
                    </svg>
                  ) : '5'}
                </div>
                <div className="liv-step-content">
                  <strong>📍 Arrivé chez la cliente</strong>
                  <p>Devant la porte</p>
                  <button
                    className={stepDone('arrived') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                    onClick={() => updateStatus('arrived', {}, 'arrived')}
                    disabled={!stepDone('in_route') || stepDone('arrived') || busyStep === 'arrived'}
                    aria-busy={busyStep === 'arrived'}
                  >
                    {stepDone('arrived') ? '✓ Arrivé' : busyStep === 'arrived' ? 'Envoi…' : 'Je suis arrivé'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isCompleted && isCash && stepDone('arrived') && (
          <div className="liv-card">
            <h2>💵 Encaissement Cash</h2>
            <div className="liv-cash-box">
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                Demande à la cliente <strong style={{ fontSize: 18, color: '#1F8B4C' }}>{order.total.toLocaleString('fr-FR')} FCFA</strong> cash.
              </p>
              {order.cash_received ? (
                <div className="liv-cash-done">
                  ✅ Cash de {order.total.toLocaleString('fr-FR')} FCFA reçu
                </div>
              ) : (
                <button className="liv-btn-pri" onClick={markCashReceived}>
                  💵 J'ai reçu {order.total.toLocaleString('fr-FR')} FCFA cash
                </button>
              )}
            </div>
          </div>
        )}

        {!isCompleted && stepDone('arrived') && (!isCash || order?.cash_received) && (
          <div className="liv-card">
            <h2>📸 Preuve de livraison</h2>
            <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 14 }}>
              Choisis <strong>UNE</strong> méthode pour prouver la livraison :
            </p>

            <div className="liv-proof-grid">
              <button className={`liv-proof-option ${proofMethod === 'photo' ? 'selected' : ''}`}
                onClick={() => setShowPhotoCapture('delivery')}
                disabled={proofMethod && proofMethod !== 'photo'}>
                <div className="liv-proof-icon">📷</div>
                <strong>Photo</strong>
                <span>du colis remis</span>
                {tracking?.delivery_photo_url && <span className="liv-proof-check">✓</span>}
              </button>

              <button className={`liv-proof-option ${proofMethod === 'signature' ? 'selected' : ''}`}
                onClick={() => setShowSignature(true)}
                disabled={proofMethod && proofMethod !== 'signature'}>
                <div className="liv-proof-icon">✍️</div>
                <strong>Signature</strong>
                <span>cliente signe</span>
                {tracking?.delivery_signature && <span className="liv-proof-check">✓</span>}
              </button>

              <button className={`liv-proof-option ${proofMethod === 'pin' ? 'selected' : ''}`}
                onClick={() => setShowPinEntry(true)}
                disabled={proofMethod && proofMethod !== 'pin'}>
                <div className="liv-proof-icon">🔢</div>
                <strong>Code PIN</strong>
                <span>cliente dicte</span>
                {tracking?.delivery_pin && <span className="liv-proof-check">✓</span>}
              </button>
            </div>

            {proofMethod && (
              <div className="liv-proof-preview">
                {proofMethod === 'photo' && tracking?.delivery_photo_url && (
                  <SignedImage src={tracking.delivery_photo_url} alt="" />
                )}
                {proofMethod === 'signature' && tracking?.delivery_signature && (
                  <img src={tracking.delivery_signature} alt="" style={{ background: 'white' }} />
                )}
                {proofMethod === 'pin' && tracking?.delivery_pin && (
                  <div className="liv-pin-display">PIN : {tracking.delivery_pin}</div>
                )}
              </div>
            )}

            <button className="liv-btn-final" onClick={confirmDelivery}
              disabled={!proofMethod || confirming || (isCash && !order.cash_received)}>
              {confirming ? '⏳ Envoi en cours...' : '🎉 Confirmer la livraison'}
            </button>
          </div>
        )}

        {isCompleted && (
          <div className="liv-card" style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>⏳</div>
            <h2 style={{ marginBottom: 8 }}>En attente confirmation cliente</h2>
            <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
              Tu as bien terminé ta mission ! La cliente a reçu un WhatsApp pour confirmer la réception.
            </p>
            {order.status === 'delivered' && (
              <div style={{ padding: 14, background: '#E8F5EC', borderRadius: 10, color: '#166635', fontWeight: 700 }}>
                ✅ Livraison confirmée par la cliente
              </div>
            )}
          </div>
        )}
      </main>

      {showPhotoCapture && (
        <PhotoCaptureModal type={showPhotoCapture}
          onCapture={(file) => handlePhotoCapture(file, showPhotoCapture)}
          onCancel={() => setShowPhotoCapture(null)} />
      )}
      {showSignature && <SignatureModal onSubmit={handleSignatureSubmit} onCancel={() => setShowSignature(false)} />}
      {showPinEntry && <PinEntryModal onSubmit={handlePinSubmit} onCancel={() => setShowPinEntry(false)} />}
      {showBarcodeScanner && (
        <BarcodeScannerModal 
          onScan={handleBarcodeScan} 
          onCancel={() => setShowBarcodeScanner(false)}
          alreadyScanned={(tracking?.scanned_barcodes || []).map(b => b.code)}
          orderItems={order?.items || []}
        />
      )}
    </div>
  );
}

// ─── MODAL SCANNER CODE-BARRES (intelligent OpenBeautyFacts) ───
function BarcodeScannerModal({ onScan, onCancel, alreadyScanned = [], orderItems = [] }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null);

  const verifyBarcode = async (barcode) => {
    setVerifying(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-barcode`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ barcode, orderItems }),
      });
      
      const data = await response.json();
      setVerification({ barcode, ...data });
    } catch (e) {
      setVerification({ barcode, success: false, error: e.message, message: 'Erreur réseau' });
    } finally {
      setVerifying(false);
    }
  };

  const requestPermission = async () => {
    setStatus('requesting');
    setErrorMsg('');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      setStatus('scanning');
      
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      
      reader.decodeFromVideoElement(videoRef.current, async (result, err) => {
        if (result) {
          const code = result.getText();
          
          if (alreadyScanned.includes(code)) {
            setVerification({ barcode: code, alreadyScanned: true, message: 'Déjà scanné' });
            setTimeout(() => setVerification(null), 1500);
            return;
          }
          
          if (verifying || verification) return;
          
          if (navigator.vibrate) navigator.vibrate(100);
          
          await verifyBarcode(code);
        }
      });
      
    } catch (e) {
      console.error('Camera error:', e);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setErrorMsg('Permission caméra refusée. Va dans Réglages > Safari > Caméra et autorise.');
      } else if (e.name === 'NotFoundError') {
        setErrorMsg('Aucune caméra détectée');
      } else if (e.name === 'NotReadableError') {
        setErrorMsg('La caméra est utilisée par une autre app.');
      } else {
        setErrorMsg('Erreur : ' + (e.message || e.name || 'inconnue'));
      }
      setStatus('error');
    }
  };

  const cleanup = () => {
    try {
      if (readerRef.current) {
        readerRef.current.reset();
        readerRef.current = null;
      }
    } catch (e) {}
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    } catch (e) {}
  };

  useEffect(() => {
    return () => cleanup();
  }, []);

  const handleCancel = () => {
    cleanup();
    onCancel();
  };

  const handleConfirm = () => {
    cleanup();
    onScan(verification.barcode);
  };

  const handleReject = () => {
    setVerification(null);
  };

  let bgColor = 'rgba(0,0,0,0.4)';
  let icon = '';
  if (verification) {
    if (verification.alreadyScanned) {
      bgColor = 'rgba(217,52,43,0.95)';
      icon = '⚠️';
    } else if (verification.success && verification.inOrder) {
      bgColor = 'rgba(31,139,76,0.95)';
      icon = '✅';
    } else if (verification.success && !verification.inOrder) {
      bgColor = 'rgba(255,121,0,0.95)';
      icon = '⚠️';
    } else if (verification.obfData) {
      bgColor = 'rgba(255,121,0,0.95)';
      icon = '⚠️';
    } else {
      bgColor = 'rgba(217,52,43,0.95)';
      icon = '❓';
    }
  }

  return (
    <div className="liv-modal-overlay" onClick={handleCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500, padding: 16 }}>
        <h3 style={{ marginBottom: 8 }}>📊 Scanner code-barres</h3>
        
        {status === 'idle' && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
            <p style={{ fontSize: 14, marginBottom: 16, color: '#4B4B4B' }}>
              YARAM a besoin d'accéder à ta caméra pour scanner les codes-barres
            </p>
            <button 
              className="liv-btn-pri" 
              onClick={requestPermission}
              style={{ width: '100%', marginBottom: 8 }}
            >
              📷 Activer la caméra
            </button>
            <button 
              className="liv-btn-stop" 
              onClick={handleCancel}
              style={{ width: '100%' }}
            >
              Annuler
            </button>
          </div>
        )}

        {(status === 'requesting' || status === 'scanning') && (
          <>
            <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 14 }}>
              Pointe la caméra vers le code-barres
            </p>
            
            <div style={{
              position: 'relative',
              background: '#000',
              borderRadius: 12,
              overflow: 'hidden',
              aspectRatio: '4/3',
              marginBottom: 14,
            }}>
              <video 
                ref={videoRef}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                playsInline
                muted
                autoPlay
              />
              
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{
                  width: '80%',
                  height: '40%',
                  border: '3px solid rgba(31,139,76,0.8)',
                  borderRadius: 8,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
                }} />
              </div>
              
              {status === 'requesting' && !verification && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: 14, fontWeight: 700, background: 'rgba(0,0,0,0.5)',
                }}>
                  ⏳ Activation caméra...
                </div>
              )}
              
              {verifying && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: 'white', background: 'rgba(0,0,0,0.7)',
                }}>
                  <div style={{ fontSize: 36 }}>🔍</div>
                  <div style={{ fontSize: 14, marginTop: 8, fontWeight: 700 }}>Vérification...</div>
                </div>
              )}
              
              {verification && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: 'white', background: bgColor,
                  padding: 16, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>{icon}</div>
                  
                  {(verification.product?.img || verification.obfData?.image) && (
                    <img 
                      src={verification.product?.img || verification.obfData?.image} 
                      alt=""
                      style={{ 
                        width: 60, height: 60, borderRadius: 8, 
                        objectFit: 'cover', marginBottom: 8,
                        background: 'white',
                      }}
                    />
                  )}
                  
                  {verification.product && (
                    <div style={{ fontWeight: 800, fontSize: 14 }}>
                      {verification.product.brand} · {verification.product.name}
                    </div>
                  )}
                  {!verification.product && verification.obfData && (
                    <div style={{ fontWeight: 800, fontSize: 14 }}>
                      {verification.obfData.brand} · {verification.obfData.name}
                    </div>
                  )}
                  
                  <div style={{ fontSize: 12, marginTop: 6, opacity: 0.95 }}>
                    {verification.message}
                  </div>
                  
                  <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 6, opacity: 0.7 }}>
                    {verification.barcode}
                  </div>
                </div>
              )}
            </div>
            
            {verification && !verification.alreadyScanned && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button 
                  className="liv-btn-stop" 
                  onClick={handleReject}
                  style={{ flex: 1 }}
                >
                  🔄 Re-scanner
                </button>
                <button 
                  className="liv-btn-pri" 
                  onClick={handleConfirm}
                  style={{ 
                    flex: 2,
                    background: verification.inOrder ? '#1F8B4C' : '#FF7900',
                  }}
                >
                  ✓ Confirmer
                </button>
              </div>
            )}
            
            {!verification && (
              <button className="liv-btn-stop" onClick={handleCancel} style={{ width: '100%' }}>
                Annuler
              </button>
            )}
          </>
        )}

        {status === 'error' && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
            <p style={{ fontSize: 14, marginBottom: 16, color: '#D9342B', fontWeight: 600 }}>
              {errorMsg}
            </p>
            <button className="liv-btn-pri" onClick={requestPermission} style={{ width: '100%', marginBottom: 8 }}>
              🔄 Réessayer
            </button>
            <button className="liv-btn-stop" onClick={handleCancel} style={{ width: '100%' }}>
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoCaptureModal({ type, onCapture, onCancel }) {
  const fileInputRef = useRef(null);
  const labels = {
    pickup_before: 'Photo de la pharmacie (à l\'arrivée)',
    pickup_after: 'Photo des produits récupérés',
    pickup: 'Photo de la pharmacie',
    product: 'Photo du produit (étiquette visible)',
    delivery: 'Photo du colis remis à la cliente',
  };
  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()}>
        <h3>📷 {labels[type] || 'Photo'}</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
          Prends une photo claire avec ton téléphone
        </p>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
          onChange={e => e.target.files[0] && onCapture(e.target.files[0])}
          style={{ display: 'none' }} />
        <button className="liv-btn-pri" onClick={() => fileInputRef.current?.click()}>
          📷 Ouvrir l'appareil photo
        </button>
        <button className="liv-btn-stop" onClick={onCancel} style={{ marginTop: 8 }}>Annuler</button>
      </div>
    </div>
  );
}

function SignatureModal({ onSubmit, onCancel }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.touches?.[0]?.clientX ?? e.clientX) - rect.left,
      y: (e.touches?.[0]?.clientY ?? e.clientY) - rect.top,
    };
  };

  const start = (e) => {
    e.preventDefault(); setDrawing(true);
    const { x, y } = getPos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath(); ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing) return; e.preventDefault();
    const { x, y } = getPos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y); ctx.stroke();
    setHasDrawn(true);
  };
  const end = () => setDrawing(false);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const submit = () => {
    if (!hasDrawn) { toast.error('La cliente doit signer'); return; }
    onSubmit(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()}>
        <h3>✍️ Signature de la cliente</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
          Demande à la cliente de signer avec son doigt
        </p>
        <div style={{ background: 'white', border: '2px dashed #DDD', borderRadius: 10, overflow: 'hidden' }}>
          <canvas ref={canvasRef}
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            style={{ width: '100%', height: 200, touchAction: 'none', cursor: 'crosshair' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button className="liv-btn-stop" onClick={clear} style={{ flex: 1 }}>🗑️ Effacer</button>
          <button className="liv-btn-pri" onClick={submit} style={{ flex: 2 }}>✓ Valider</button>
        </div>
        <button className="liv-btn-stop" onClick={onCancel} style={{ marginTop: 8 }}>Annuler</button>
      </div>
    </div>
  );
}

function PinEntryModal({ onSubmit, onCancel }) {
  const [pin, setPin] = useState('');
  const submit = () => {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { toast.error('PIN = 4 chiffres'); return; }
    onSubmit(pin);
  };
  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()}>
        <h3>🔢 Code PIN de la cliente</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
          Demande à la cliente d'inventer un code à 4 chiffres
        </p>
        <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4}
          value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="••••" autoFocus
          style={{
            width: '100%', padding: 16, border: '1.5px solid #EEE', borderRadius: 12,
            fontSize: 32, fontWeight: 800, textAlign: 'center', letterSpacing: '0.5em',
            marginBottom: 12,
          }} />
        <button className="liv-btn-pri" onClick={submit}>✓ Valider</button>
        <button className="liv-btn-stop" onClick={onCancel} style={{ marginTop: 8 }}>Annuler</button>
      </div>
    </div>
  );
}