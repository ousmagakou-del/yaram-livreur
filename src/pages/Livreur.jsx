import { useState, useEffect, useRef } from 'react';
import { supabase, sendWhatsApp, WhatsAppTemplates, generateConfirmToken } from '../lib/supabase';
import { BrowserMultiFormatReader } from '@zxing/browser';
import './Livreur.css';

export default function Livreur() {
  const [order, setOrder] = useState(null);
  const [tracking, setTracking] = useState(null);
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
  const watchIdRef = useRef(null);

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
    const { data, error } = await supabase
      .from('delivery_tracking')
      .select('*, orders(*)')
      .eq('delivery_token', t)
      .single();
    if (error || !data) {
      setError('Lien invalide ou expiré');
      setLoading(false);
      return;
    }
    setTracking(data);
    setOrder(data.orders);
    
    if (data.delivery_photo_url) setProofMethod('photo');
    else if (data.delivery_signature) setProofMethod('signature');
    else if (data.delivery_pin) setProofMethod('pin');
    
    setLoading(false);
  };

  const startGPS = () => {
    if (!navigator.geolocation) { alert('GPS non disponible'); return; }
    setSharingGPS(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCurrentPos({ lat, lng });
        await supabase.from('delivery_tracking').update({
          current_lat: lat, current_lng: lng,
          last_update: new Date().toISOString(),
        }).eq('delivery_token', token);
      },
      (err) => { alert('Erreur GPS : ' + err.message); setSharingGPS(false); },
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

  const updateStatus = async (newStatus, extraFields = {}) => {
    const timestampField = {
      picking: 'pickup_at', picked: 'picked_at',
      in_route: 'in_route_at', arrived: 'arrived_at',
      delivered: 'delivered_at',
    }[newStatus];
    
    const updates = { status: newStatus, last_update: new Date().toISOString(), ...extraFields };
    if (timestampField) updates[timestampField] = new Date().toISOString();
    
    await supabase.from('delivery_tracking').update(updates).eq('delivery_token', token);
    
    if (newStatus === 'in_route' && order) {
      await supabase.from('orders').update({ status: 'shipped' }).eq('id', order.id);
    }
    loadTracking(token);
  };

  const uploadPhoto = async (file, type) => {
    if (!file) return null;
    const fileName = `${token}/${type}_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('delivery-proofs')
      .upload(fileName, file, { contentType: 'image/jpeg', upsert: true });
    if (error) { alert('Erreur upload : ' + error.message); return null; }
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
    await supabase.from('delivery_tracking')
      .update({ [fieldName]: url }).eq('delivery_token', token);
    setShowPhotoCapture(null);
    if (type === 'delivery') {
      setProofMethod('photo');
      loadTracking(token);
      alert('📸 Photo enregistrée ! Confirme la livraison maintenant.');
    } else {
      loadTracking(token);
      alert('✅ Photo enregistrée');
    }
  };

  const handleBarcodeScan = async (barcode) => {
    // Ajoute le code-barres scanné à la liste
    const scanned = tracking?.scanned_barcodes || [];
    const newScanned = [...scanned, {
      code: barcode,
      scanned_at: new Date().toISOString(),
    }];
    
    await supabase.from('delivery_tracking')
      .update({ scanned_barcodes: newScanned })
      .eq('delivery_token', token);
    
    loadTracking(token);
    
    // Feedback
    if (navigator.vibrate) navigator.vibrate(100);
    setShowBarcodeScanner(false);
  };

  const handleSignatureSubmit = async (signatureData) => {
    await supabase.from('delivery_tracking')
      .update({ delivery_signature: signatureData })
      .eq('delivery_token', token);
    setShowSignature(false);
    setProofMethod('signature');
    loadTracking(token);
    alert('✍️ Signature enregistrée ! Confirme la livraison maintenant.');
  };

  const handlePinSubmit = async (pin) => {
    await supabase.from('delivery_tracking')
      .update({ delivery_pin: pin }).eq('delivery_token', token);
    setShowPinEntry(false);
    setProofMethod('pin');
    loadTracking(token);
    alert('🔢 PIN enregistré ! Confirme la livraison maintenant.');
  };

  const markCashReceived = async () => {
    await supabase.from('orders').update({
      cash_received: true,
      cash_received_at: new Date().toISOString(),
    }).eq('id', order.id);
    await updateStatus('cash_collected');
    alert('💵 Cash de ' + order.total.toLocaleString('fr-FR') + ' FCFA confirmé reçu.');
    setOrder({ ...order, cash_received: true });
  };

  const confirmDelivery = async () => {
    if (!proofMethod) {
      alert('⚠️ Tu dois fournir au moins une preuve : photo, signature ou PIN');
      return;
    }
    
    if (order.payment_method === 'cod' && !order.cash_received) {
      alert('⚠️ Tu dois d\'abord confirmer la réception du cash !');
      return;
    }
    
    setConfirming(true);
    
    let confirmToken = order.confirmation_token;
    if (!confirmToken) {
      confirmToken = generateConfirmToken();
      await supabase.from('orders').update({
        confirmation_token: confirmToken,
      }).eq('id', order.id);
    }
    
    await supabase.from('orders').update({
      status: 'awaiting_confirm',
      awaiting_confirm_at: new Date().toISOString(),
    }).eq('id', order.id);
    
    await updateStatus('proof_uploaded');
    
    const confirmUrl = `${window.location.origin}/?confirm=${confirmToken}`;
    if (order.address?.phone) {
      const msg = order.payment_method === 'cod'
        ? WhatsAppTemplates.orderAwaitingConfirmCash(order.address.name, order.id, order.total, confirmUrl)
        : WhatsAppTemplates.orderAwaitingConfirm(order.address.name, order.id, confirmUrl);
      sendWhatsApp(order.address.phone, msg).then(r => console.log('Confirm WhatsApp:', r));
    }
    
    stopGPS();
    setConfirming(false);
    alert('✅ Livraison signalée ! La cliente reçoit un WhatsApp pour confirmer.\n\nMerci pour ton service 💚');
  };

  if (loading) return <div className="liv-screen"><p style={{padding:40,textAlign:'center'}}>Chargement…</p></div>;

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
  const waUrl = order?.address?.phone ? 'https://wa.me/' + order.address.phone.replace(/\D/g, '') : null;
  const mapsUrl = order?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.address.line}, ${order.address.city}`)}` : null;
  const stepDone = (s) => {
    const ord = ['assigned', 'picking', 'picked', 'in_route', 'arrived', 'cash_collected', 'proof_uploaded', 'delivered'];
    return ord.indexOf(tracking?.status) >= ord.indexOf(s);
  };

  const isCompleted = ['awaiting_confirm', 'delivered'].includes(order?.status);
  
  // Compteur produits scannés
  const scannedCount = (tracking?.scanned_barcodes || []).length;
  const totalProducts = (order?.items || []).reduce((sum, it) => sum + (it.qty || 1), 0);
  const allScanned = scannedCount >= totalProducts && totalProducts > 0;

  return (
    <div className="liv-screen">
      <header className="liv-header">
        <div className="liv-logo">D</div>
        <div>
          <strong>Diaara · Livraison</strong>
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

          <h2>👤 Cliente</h2>
          <p><strong>{order?.address?.name}</strong></p>
          <p>📞 <a href={`tel:${order?.address?.phone}`}>{order?.address?.phone}</a></p>
          <p>📍 {order?.address?.line}</p>
          <p>{order?.address?.neighborhood}, {order?.address?.city}</p>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer" className="liv-wa-btn">💬 WhatsApp</a>}
            {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="liv-maps-btn">🗺️ Itinéraire</a>}
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
              <strong style={{ fontSize: 16 }}>Encaisse {order.total.toLocaleString('fr-FR')} FCFA</strong>
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
              
              {/* Étape 1 — Arrivée pharmacie */}
              <div className={`liv-step-card ${stepDone('picking') ? 'done' : ''}`}>
                <div className="liv-step-num">1</div>
                <div className="liv-step-content">
                  <strong>🏥 J'arrive à la pharmacie</strong>
                  <p>Photo de la pharmacie (preuve d'arrivée)</p>
                  {tracking?.pickup_before_photo_url && <img src={tracking.pickup_before_photo_url} alt="" className="liv-thumb" />}
                  <div className="liv-step-actions">
                    <button className="liv-mini-btn" onClick={() => setShowPhotoCapture('pickup_before')} disabled={stepDone('picked')}>
                      📷 Photo avant
                    </button>
                    <button className={stepDone('picking') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                      onClick={() => updateStatus('picking')} disabled={stepDone('picking')}>
                      {stepDone('picking') ? '✓ Confirmé' : 'Je suis là'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Étape 2 — Scan code-barres */}
              <div className={`liv-step-card ${allScanned ? 'done' : ''}`}>
                <div className="liv-step-num">2</div>
                <div className="liv-step-content">
                  <strong>📊 Vérifier les produits</strong>
                  <p>Scanne le code-barres de chaque produit</p>
                  
                  {/* Compteur de scans */}
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

                  {/* Liste des scans déjà faits */}
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
                        if (confirm('Pas de code-barres sur certains produits ? On skip le scan ?')) {
                          await supabase.from('delivery_tracking')
                            .update({ scanned_barcodes: [{ code: 'SKIPPED', scanned_at: new Date().toISOString() }] })
                            .eq('delivery_token', token);
                          loadTracking(token);
                        }
                      }}
                      disabled={!stepDone('picking') || scannedCount > 0}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>

              {/* Étape 3 — Photo produit final + récupération */}
              <div className={`liv-step-card ${stepDone('picked') ? 'done' : ''}`}>
                <div className="liv-step-num">3</div>
                <div className="liv-step-content">
                  <strong>📦 Produits récupérés</strong>
                  <p>Photo des produits avant de partir</p>
                  {tracking?.pickup_after_photo_url && <img src={tracking.pickup_after_photo_url} alt="" className="liv-thumb" />}
                  <div className="liv-step-actions">
                    <button className="liv-mini-btn" onClick={() => setShowPhotoCapture('pickup_after')} disabled={!allScanned || stepDone('in_route')}>
                      📷 Photo après
                    </button>
                    <button className={stepDone('picked') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                      onClick={() => updateStatus('picked')} disabled={!allScanned || stepDone('picked')}>
                      {stepDone('picked') ? '✓ Récupéré' : 'Tout pris'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Étape 4 */}
              <div className={`liv-step-card ${stepDone('in_route') ? 'done' : ''}`}>
                <div className="liv-step-num">4</div>
                <div className="liv-step-content">
                  <strong>🛵 En route vers la cliente</strong>
                  <p>{sharingGPS ? 'GPS actif · cliente notifiée' : 'Active le GPS d\'abord'}</p>
                  <button className={stepDone('in_route') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                    onClick={() => updateStatus('in_route')} disabled={!stepDone('picked') || stepDone('in_route')}>
                    {stepDone('in_route') ? '✓ En route' : 'Je suis parti'}
                  </button>
                </div>
              </div>

              {/* Étape 5 */}
              <div className={`liv-step-card ${stepDone('arrived') ? 'done' : ''}`}>
                <div className="liv-step-num">5</div>
                <div className="liv-step-content">
                  <strong>📍 Arrivé chez la cliente</strong>
                  <p>Devant la porte</p>
                  <button className={stepDone('arrived') ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
                    onClick={() => updateStatus('arrived')} disabled={!stepDone('in_route') || stepDone('arrived')}>
                    {stepDone('arrived') ? '✓ Arrivé' : 'Je suis arrivé'}
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
                  <img src={tracking.delivery_photo_url} alt="" />
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
        />
      )}
    </div>
  );
}

// ─── MODAL SCANNER CODE-BARRES ───
function BarcodeScannerModal({ onScan, onCancel, alreadyScanned = [] }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [detected, setDetected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;
    
    (async () => {
      try {
        setStatus('starting');
        
        // Préfère la caméra arrière
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        const backCamera = devices.find(d => /back|rear|environment/i.test(d.label));
        const deviceId = backCamera?.deviceId || devices[0]?.deviceId;
        
        if (!deviceId) {
          setStatus('no-camera');
          return;
        }
        
        setStatus('scanning');
        
        await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result, err) => {
          if (cancelled) return;
          if (result) {
            const code = result.getText();
            
            // Vérifie pas déjà scanné
            if (alreadyScanned.includes(code)) {
              setDetected({ code, alreadyScanned: true });
              setTimeout(() => setDetected(null), 1500);
              return;
            }
            
            // Beep + vibration
            if (navigator.vibrate) navigator.vibrate(100);
            
            setDetected({ code, success: true });
            
            // Valide après 800ms
            setTimeout(() => {
              if (!cancelled) onScan(code);
            }, 800);
          }
        });
      } catch (e) {
        console.error('Scanner error:', e);
        setStatus('error');
      }
    })();
    
    return () => {
      cancelled = true;
      try {
        if (readerRef.current) {
          readerRef.current.reset();
        }
      } catch (e) {}
    };
  }, []);

  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500, padding: 16 }}>
        <h3 style={{ marginBottom: 8 }}>📊 Scanner code-barres</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 14 }}>
          Pointe la caméra vers le code-barres du produit
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
          />
          
          {/* Overlay scan zone */}
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
          
          {/* Statut */}
          {status === 'starting' && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 14,
              fontWeight: 700,
              background: 'rgba(0,0,0,0.5)',
            }}>
              ⏳ Démarrage caméra...
            </div>
          )}
          
          {status === 'no-camera' && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 13,
              fontWeight: 700,
              background: 'rgba(217,52,43,0.9)',
              padding: 20,
              textAlign: 'center',
            }}>
              📷 Pas de caméra détectée<br />Vérifie les permissions
            </div>
          )}
          
          {/* Feedback succès */}
          {detected?.success && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              background: 'rgba(31,139,76,0.9)',
              animation: 'fadeIn 0.2s',
            }}>
              <div style={{ fontSize: 48 }}>✅</div>
              <div style={{ fontFamily: 'monospace', fontSize: 14, marginTop: 8 }}>{detected.code}</div>
            </div>
          )}
          
          {/* Feedback déjà scanné */}
          {detected?.alreadyScanned && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              background: 'rgba(217,52,43,0.9)',
            }}>
              <div style={{ fontSize: 48 }}>⚠️</div>
              <div style={{ fontSize: 14, marginTop: 8 }}>Déjà scanné</div>
            </div>
          )}
        </div>
        
        <button className="liv-btn-stop" onClick={onCancel} style={{ width: '100%' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── MODAL PHOTO ───
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

// ─── MODAL SIGNATURE ───
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
    if (!hasDrawn) { alert('La cliente doit signer'); return; }
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

// ─── MODAL PIN ───
function PinEntryModal({ onSubmit, onCancel }) {
  const [pin, setPin] = useState('');
  const submit = () => {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { alert('PIN = 4 chiffres'); return; }
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