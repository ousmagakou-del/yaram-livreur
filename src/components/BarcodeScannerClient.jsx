import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
// PERF : @zxing/browser pèse ~35KB+ (gzipped). Lazy-load uniquement quand
// l'utilisateur active la caméra, sinon le bundle initial est plombé.

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

/**
 * Scanner de code-barres pour le client.
 * Quand un code est scanne :
 *  1. Cherche le produit dans products.barcode
 *  2. Si trouve → onProductFound(productId)
 *  3. Sinon → tente OpenBeautyFacts (via verify-barcode edge function)
 *  4. Si OBF connait → propose "Cherche ce produit"
 *  5. Sinon → message "Produit non trouve"
 */
export default function BarcodeScannerClient({ onProductFound, onCancel }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | requesting | scanning | error
  const [errorMsg, setErrorMsg] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null); // { barcode, found, product?, obfData? }

  const lookupBarcode = async (barcode) => {
    setSearching(true);
    try {
      // 1) Cherche dans products.barcode
      const { data: prod } = await supabase
        .from('products')
        .select('id, name, brand, img, price')
        .eq('barcode', barcode)
        .eq('active', true)
        .maybeSingle();

      if (prod) {
        setResult({ barcode, found: true, product: prod });
        setSearching(false);
        return;
      }

      // 2) Fallback OpenBeautyFacts via Edge Function
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/verify-barcode`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ barcode, orderItems: [] }),
        });
        const data = await r.json();
        if (data?.obfData?.name) {
          setResult({ barcode, found: false, obfData: data.obfData });
        } else {
          setResult({ barcode, found: false });
        }
      } catch (e) {
        setResult({ barcode, found: false });
      }
    } catch (e) {
      setResult({ barcode, found: false, error: e.message });
    } finally {
      setSearching(false);
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

      // PERF : essaie BarcodeDetector natif (0 byte JS), fallback ZXing lazy-import
      const { startBarcodeScan } = await import('../lib/barcode');
      const handle = await startBarcodeScan(videoRef.current, async (code) => {
        if (searching || result) return;
        if (navigator.vibrate) navigator.vibrate(100);
        await lookupBarcode(code);
      });
      readerRef.current = handle;
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
    // Le handle peut etre { stop } (nouveau) ou { reset } (legacy zxing direct)
    try {
      if (readerRef.current?.stop) readerRef.current.stop();
      else if (readerRef.current?.reset) readerRef.current.reset();
    } catch {}
    readerRef.current = null;
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
    } catch {}
    streamRef.current = null;
  };

  useEffect(() => () => cleanup(), []);

  const handleCancel = () => { cleanup(); onCancel(); };

  const handleOpenProduct = () => {
    cleanup();
    if (result?.product?.id) onProductFound(result.product.id);
  };

  const handleSearchObf = () => {
    cleanup();
    if (result?.obfData?.name) {
      // Naviger vers Search avec query = nom OBF
      window.location.href = '/search?q=' + encodeURIComponent(result.obfData.name);
    }
  };

  const handleRetry = () => setResult(null);

  let bg = 'rgba(0,0,0,0.4)';
  let icon = '';
  if (result) {
    if (result.found)         { bg = 'rgba(31,139,76,0.95)'; icon = '✅'; }
    else if (result.obfData)  { bg = 'rgba(255,121,0,0.95)'; icon = '🔍'; }
    else                      { bg = 'rgba(217,52,43,0.95)'; icon = '❓'; }
  }

  return (
    <div className="bsc-overlay" onClick={handleCancel}>
      <div className="bsc-modal" onClick={e => e.stopPropagation()}>
        <h3>📊 Scanner un produit</h3>

        {status === 'idle' && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
            <p style={{ fontSize: 14, marginBottom: 16, color: '#4B4B4B' }}>
              Scanne le code-barres d'un produit pour trouver l'équivalent dans YARAM
            </p>
            <button className="bsc-btn pri" onClick={requestPermission}>
              📷 Activer la caméra
            </button>
            <button className="bsc-btn" onClick={handleCancel}>Annuler</button>
          </div>
        )}

        {(status === 'requesting' || status === 'scanning') && (
          <>
            <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 14 }}>
              Pointe la caméra vers le code-barres
            </p>

            <div className="bsc-video-wrap">
              <video ref={videoRef} playsInline muted autoPlay />

              {/* Cadre de visée */}
              <div className="bsc-aim" />

              {status === 'requesting' && !result && (
                <div className="bsc-loader">⏳ Activation caméra...</div>
              )}

              {searching && (
                <div className="bsc-result" style={{ background: 'rgba(0,0,0,0.7)' }}>
                  <div style={{ fontSize: 36 }}>🔍</div>
                  <div style={{ fontSize: 14, marginTop: 8, fontWeight: 700 }}>Recherche...</div>
                </div>
              )}

              {result && (
                <div className="bsc-result" style={{ background: bg }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>{icon}</div>

                  {result.product?.img && (
                    <img src={result.product.img} alt="" loading="lazy" decoding="async" className="bsc-result-img" />
                  )}
                  {!result.product && result.obfData?.image && (
                    <img src={result.obfData.image} alt="" loading="lazy" decoding="async" className="bsc-result-img" />
                  )}

                  {result.found && (
                    <>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>
                        {result.product.brand} · {result.product.name}
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        {result.product.price?.toLocaleString('fr-FR')} FCFA
                      </div>
                      <div style={{ fontSize: 12, marginTop: 6, opacity: 0.95 }}>
                        Disponible sur YARAM !
                      </div>
                    </>
                  )}

                  {!result.found && result.obfData && (
                    <>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>
                        {result.obfData.brand} · {result.obfData.name}
                      </div>
                      <div style={{ fontSize: 12, marginTop: 6, opacity: 0.95 }}>
                        Pas encore chez nous — on cherche des équivalents ?
                      </div>
                    </>
                  )}

                  {!result.found && !result.obfData && (
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      Produit non reconnu
                    </div>
                  )}

                  <div className="bsc-barcode-line">{result.barcode}</div>
                </div>
              )}
            </div>

            {result && (
              <div className="bsc-actions">
                <button className="bsc-btn" onClick={handleRetry}>🔄 Re-scanner</button>
                {result.found && (
                  <button className="bsc-btn pri big" onClick={handleOpenProduct}>
                    Voir le produit →
                  </button>
                )}
                {!result.found && result.obfData && (
                  <button className="bsc-btn pri big" onClick={handleSearchObf}>
                    Chercher des équivalents →
                  </button>
                )}
                {!result.found && !result.obfData && (
                  <button className="bsc-btn pri big" onClick={handleCancel}>Fermer</button>
                )}
              </div>
            )}

            {!result && (
              <button className="bsc-btn" onClick={handleCancel} style={{ width: '100%' }}>
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
            <button className="bsc-btn pri" onClick={requestPermission}>🔄 Réessayer</button>
            <button className="bsc-btn" onClick={handleCancel}>Annuler</button>
          </div>
        )}
      </div>
    </div>
  );
}
