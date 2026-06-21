// ════════════════════════════════════════════════════════════════
// YARAM — Helper barcode universel
// ════════════════════════════════════════════════════════════════
//
// 1) Essaie le BarcodeDetector natif (Chrome/Edge Android, macOS Safari récent)
//    → 0 byte de JS supplémentaire.
// 2) Sinon fallback @zxing/browser (lazy-import → vendor-zxing chunk 468 kB)
//
// API uniforme : start(video, onDetect) → renvoie un .stop() pour cleanup.
// ════════════════════════════════════════════════════════════════

const SUPPORTED_FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'code_128', 'code_39', 'code_93',
  'qr_code', 'data_matrix',
];

/**
 * @param {HTMLVideoElement} video
 * @param {(code: string) => void} onDetect
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startBarcodeScan(video, onDetect) {
  // ─── Path 1 : BarcodeDetector natif (Android Chrome/Edge, macOS Safari récent) ───
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = SUPPORTED_FORMATS.filter(f => supported.includes(f));
      if (formats.length > 0) {
        const detector = new window.BarcodeDetector({ formats });
        let stopped = false;
        let lastCode = null;
        let rafId = null;

        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              if (codes.length > 0) {
                const code = codes[0].rawValue;
                // Dédup : ignore le même code 2x en moins de 1s
                if (code && code !== lastCode) {
                  lastCode = code;
                  setTimeout(() => { lastCode = null; }, 1000);
                  onDetect(code);
                }
              }
            }
          } catch { /* frame skip */ }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);

        return {
          stop: () => {
            stopped = true;
            if (rafId) cancelAnimationFrame(rafId);
          },
        };
      }
    } catch (e) {
      console.warn('[barcode] BarcodeDetector failed, fallback ZXing:', e?.message);
    }
  }

  // ─── Path 2 : ZXing fallback (iOS Safari, vieux Chrome) ───
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();
  reader.decodeFromVideoElement(video, (decoded) => {
    if (decoded) {
      const code = decoded.getText();
      if (code) onDetect(code);
    }
  });

  return {
    stop: () => { try { reader.reset(); } catch {} },
  };
}
