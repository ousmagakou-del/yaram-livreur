import { useState, useEffect, useRef } from 'react';
import { supabase, sendWhatsApp, WhatsAppTemplates, generateConfirmToken, compressImage } from '../lib/supabase';
import { sendOrderEmail } from '../lib/emails';
// PERF : @zxing/browser lazy-import dans le scanner barcode (~35KB).
// Importé seulement quand le livreur ouvre le scanner.
import { toast, confirmDialog } from '../lib/toast';
import SignedImage from '../components/SignedImage';
import './Livreur.css';

// URL + key Supabase lus depuis import.meta.env ou fallback (centralise lib/supabase).
// (Avant : dupliques en dur dans 5 fichiers — risque de drift au prochain rotation de cle.)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

// ─── Numéro WhatsApp support pour les liens cassés ───
const SUPPORT_WHATSAPP = '221770000000';

// ─── Sourcing helpers (Instacart-style) ────────────────────────────
// Couleurs status sourcing (réutilisées dans le JSX inline)
const SOURCING_COLORS = {
  pending: '#94A3B8',
  found: '#1F8B4C',
  substituted: '#F4B53A',
  unavailable: '#EF4444',
};

const SOURCING_LABELS = {
  pending: 'À sourcer',
  found: 'Trouvé',
  substituted: 'Substitué',
  unavailable: 'Indisponible',
};

const SOURCING_ICONS = {
  pending: '●',
  found: '✓',
  substituted: '↔',
  unavailable: '✗',
};

// Wrapper RPC sourcing : valide success + toast unique.
async function callSourcingRpc(name, args, label) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.error(`[Livreur] ${label} RPC error:`, error);
    toast.error(`${label} : ${error.message || 'RPC en échec'}`);
    return { ok: false, data: null };
  }
  if (data && data.success === false) {
    console.error(`[Livreur] ${label} business error:`, data);
    toast.error(`${label} : ${data.error || 'opération refusée'}`);
    return { ok: false, data };
  }
  return { ok: true, data };
}

// Promise wrapper pour navigator.geolocation
function getCurrentPositionAsync(opts = { enableHighAccuracy: true, timeout: 15000 }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Géolocalisation non disponible'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      opts,
    );
  });
}

// ─── LOGO YARAM (inline SVG) ─────────────────────────────────────
// Y blanc sur disque vert dégradé + petit point orange signature.
// Utilisé dans le header pro du livreur.
function YaramLogo({ size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      className="liv-yaram-logo"
    >
      <defs>
        <linearGradient id="liv-y-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22B564" />
          <stop offset="100%" stopColor="#0E6A38" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1024" height="1024" rx="240" fill="url(#liv-y-grad)" />
      <g transform="translate(-251.23 -174.85) scale(6)">
        <path
          fill="#fff"
          d="M153.9,64.45l-20.93,30.57-21.02-30.57h-24.32l28.48,41.39v58.66h23.8v-60.88l26.87-39.16h-12.87Z"
        />
      </g>
      <circle fill="#F4B53A" cx="780" cy="780" r="64" />
    </svg>
  );
}

// ─── Status pill mapping ─────────────────────────────────────────
// Reflète tracking.status avec couleur dédiée + dot animé.
const TRACKING_PILL = {
  assigned:        { label: 'Assigné',         tone: 'idle'     },
  picking:         { label: 'Au pickup',       tone: 'pickup'   },
  picked:          { label: 'Articles pris',   tone: 'pickup'   },
  in_route:        { label: 'En route',        tone: 'route'    },
  arrived:         { label: 'Arrivé',          tone: 'arrived'  },
  cash_collected:  { label: 'Cash encaissé',   tone: 'arrived'  },
  proof_uploaded:  { label: 'Preuve envoyée',  tone: 'confirm'  },
  delivered:       { label: 'Livré',           tone: 'delivered'},
};

function TrackingPill({ status }) {
  const cfg = TRACKING_PILL[status] || TRACKING_PILL.assigned;
  return (
    <span className={`liv-tracking-pill liv-tp-${cfg.tone}`}>
      <span className="liv-tp-dot" aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

// ─── PROGRESS TIMELINE (DoorDash-style) ──────────────────────────
// 5 étapes : Assigné → Pickup → Articles → En route → Livré.
// Utilise stepDone() pour déterminer le status de chaque cercle.
function ProgressTimeline({ stepDone, currentStatus }) {
  const steps = [
    { key: 'assigned', label: 'Assigné',  short: 'Mission reçue'        },
    { key: 'picking',  label: 'Pickup',   short: 'À la pharmacie'        },
    { key: 'picked',   label: 'Récupéré', short: 'Articles en main'      },
    { key: 'in_route', label: 'En route', short: 'Vers la cliente'       },
    { key: 'delivered', label: 'Livré',   short: 'Mission terminée'      },
  ];
  // Index courant : dernière étape franchie
  const lastDoneIdx = steps.reduce((acc, s, i) => (stepDone(s.key) ? i : acc), 0);
  // L'étape "en cours" est celle juste après la dernière franchie (sauf si tout est livré)
  const activeIdx = currentStatus === 'delivered' ? steps.length - 1
                    : Math.min(lastDoneIdx + 1, steps.length - 1);
  const current = steps[activeIdx];

  return (
    <div className="liv-timeline-wrap" aria-label={`Étape ${activeIdx + 1} sur ${steps.length}`}>
      <div className="liv-timeline">
        {steps.map((s, i) => {
          const done = stepDone(s.key);
          const isActive = i === activeIdx && !done;
          const cls = done ? 'done' : isActive ? 'active' : 'idle';
          return (
            <div key={s.key} className={`liv-tl-step liv-tl-${cls}`}>
              <div className="liv-tl-dot">
                {done ? (
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                ) : (
                  <span className="liv-tl-num">{i + 1}</span>
                )}
              </div>
              <div className="liv-tl-label">{s.label}</div>
              {i < steps.length - 1 && (
                <div className={`liv-tl-line ${stepDone(steps[i + 1].key) ? 'done' : ''}`} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
      <div className="liv-tl-meta">
        <span className="liv-tl-counter">Étape {activeIdx + 1}/{steps.length}</span>
        <span className="liv-tl-dot-sep" aria-hidden="true">·</span>
        <span className="liv-tl-short">{current.short}</span>
      </div>
    </div>
  );
}

// ─── DoorDash-style location card ────────────────────────────────
// Utilisée pour "RÉCUPÉRER À" (pickup) et "LIVRER À" (delivery).
// Props :
//  - kind: 'pickup' | 'delivery'  (couleur de l'icône)
//  - title: nom (gros bold)
//  - subtitle: adresse
//  - phone: pour bouton "Appeler"
//  - mapsUrl: deeplink Google Maps
//  - meta: array de petits chips info (montant, paiement, etc.)
//  - hint: phrase d'aide en pied de card (ex: "Sourcing libre")
function DoorDashLocationCard({
  kind = 'pickup',
  sectionLabel,
  title,
  subtitle,
  phone,
  mapsUrl,
  meta = [],
  hint,
  children,
}) {
  return (
    <section className="liv-dd-section">
      <div className="liv-dd-section-label">{sectionLabel}</div>
      <div className={`liv-dd-card liv-dd-${kind}`}>
        <div className="liv-dd-head">
          <div className={`liv-dd-icon liv-dd-icon-${kind}`} aria-hidden="true">
            {kind === 'pickup' ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h18l-2 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L3 7Z" />
                <path d="M8 7V5a4 4 0 0 1 8 0v2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            )}
          </div>
          <div className="liv-dd-head-text">
            <div className="liv-dd-title">{title || '—'}</div>
            {subtitle && <div className="liv-dd-sub">{subtitle}</div>}
          </div>
        </div>

        {meta.length > 0 && (
          <div className="liv-dd-meta">
            {meta.map((m, i) => (
              <span key={i} className={`liv-dd-chip liv-dd-chip-${m.tone || 'neutral'}`}>
                {m.icon && <span aria-hidden="true">{m.icon}</span>}{m.label}
              </span>
            ))}
          </div>
        )}

        {children}

        <div className="liv-dd-divider" />

        <div className="liv-dd-actions">
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="liv-dd-btn liv-dd-btn-maps"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="3 6 9 4 15 6 21 4 21 18 15 20 9 18 3 20 3 6" />
                <line x1="9" y1="4" x2="9" y2="18" />
                <line x1="15" y1="6" x2="15" y2="20" />
              </svg>
              Itinéraire
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="liv-dd-btn liv-dd-btn-call"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
              </svg>
              Appeler
            </a>
          )}
        </div>

        {hint && <div className="liv-dd-hint">{hint}</div>}
      </div>
    </section>
  );
}

// ─── Helper : Google Maps deeplink avec fallback ─────────────────
// Si lat/lng dispo → mode "direction" (turn-by-turn).
// Sinon → mode "search" avec adresse texte.
function buildMapsUrl({ lat, lng, address, city }) {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  const q = encodeURIComponent([address, city || 'Dakar'].filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// ─── Label méthode paiement ──────────────────────────────────────
function paymentLabel(method) {
  if (!method) return 'Paiement';
  const m = method.toLowerCase();
  if (m === 'cod' || m === 'cash') return 'Cash';
  if (m === 'wave') return 'Wave';
  if (m === 'om' || m === 'orange_money') return 'Orange Money';
  if (m === 'stripe' || m === 'card') return 'Carte bancaire';
  return method.toUpperCase();
}

export default function Livreur() {
  const [order, setOrder] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [sourcing, setSourcing] = useState([]);
  const [token, setToken] = useState('');
  const [pwaInstallPrompt, setPwaInstallPrompt] = useState(null);

  // ─── PWA install prompt (Android/Desktop) ─────────────────
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPwaInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPwa = async () => {
    if (!pwaInstallPrompt) return;
    pwaInstallPrompt.prompt();
    const choice = await pwaInstallPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      setPwaInstallPrompt(null);
    }
  };
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

  // ─── Sourcing state ───
  // sourcingItemIndex : index dans order.items quand on ouvre un modal lié à un item précis
  const [sourcingItemIndex, setSourcingItemIndex] = useState(null);
  const [showSourcingScanner, setShowSourcingScanner] = useState(false);
  const [showPharmaPicker, setShowPharmaPicker] = useState(false);
  const [showSubstituteModal, setShowSubstituteModal] = useState(false);
  const [showUnavailableModal, setShowUnavailableModal] = useState(false);
  const [forceSourcingMode, setForceSourcingMode] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
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
    let t = params.get('livreur');

    // PWA mode : si le livreur lance YARAM depuis l'icône PWA avec ?livreur=last,
    // on récupère son dernier token sauvegardé en localStorage
    if (t === 'last' || !t) {
      try {
        const saved = localStorage.getItem('yaram_livreur_last_token');
        if (saved) {
          const { token: savedToken, expiresAt } = JSON.parse(saved);
          // Token expiré (> 7 jours) → on l'ignore
          if (savedToken && (!expiresAt || Date.parse(expiresAt) > Date.now())) {
            t = savedToken;
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (t && t !== 'last') {
      setToken(t);
      loadTracking(t);
      // Persiste pour le mode PWA "icône d'accueil"
      try {
        localStorage.setItem('yaram_livreur_last_token', JSON.stringify({
          token: t,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          savedAt: new Date().toISOString(),
        }));
      } catch (e) { /* ignore */ }
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
    setSourcing(Array.isArray(data.sourcing) ? data.sourcing : []);

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

  // ────────────────────────────────────────────────────────────
  // SOURCING (Instacart-style) — helpers
  // ────────────────────────────────────────────────────────────

  // Reload juste la liste sourcing après une upsert/log
  const reloadSourcing = async () => {
    const { data } = await supabase.rpc('livreur_list_sourcing', { p_token: token });
    if (data && data.success && Array.isArray(data.rows)) {
      setSourcing(data.rows);
    }
  };

  // UPSERT order_item_sourcing via RPC
  const upsertSourcing = async (itemIndex, patch, label = 'Sourcing') => {
    const res = await callSourcingRpc(
      'livreur_upsert_sourcing',
      { p_token: token, p_item_index: itemIndex, p_patch: patch },
      label,
    );
    if (res.ok) {
      haptic('success');
      await reloadSourcing();
    } else {
      haptic('error');
    }
    return res;
  };

  // Log un événement scanner (analytics)
  const logScan = async (itemIndex, payload) => {
    const { error } = await supabase.rpc('livreur_log_scan', {
      p_token: token,
      p_item_index: itemIndex,
      p_payload: payload,
    });
    if (error) console.warn('[Livreur] logScan warn:', error.message);
  };

  // Upload facture pharma vers le bucket 'receipts' et sauve sur la 1ère ligne sourcing
  const uploadReceipt = async (file) => {
    if (!file || !order?.id) return;
    setUploadingReceipt(true);
    let uploadFile = file;
    try {
      const compressed = await compressImage(file, 1400, 0.78);
      if (compressed && compressed.size > 0) uploadFile = compressed;
    } catch {}
    const fileName = `${order.id}/${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('receipts')
      .upload(fileName, uploadFile, { contentType: 'image/jpeg', upsert: true });
    if (upErr) {
      toast.error('Erreur upload facture : ' + upErr.message);
      setUploadingReceipt(false);
      return;
    }
    const { data: pub } = supabase.storage.from('receipts').getPublicUrl(fileName);
    const url = pub?.publicUrl;
    if (!url) {
      toast.error('Erreur publicUrl facture');
      setUploadingReceipt(false);
      return;
    }

    // On épingle l'URL sur la 1ère ligne sourcing (premier item) — sinon on en
    // crée une sur l'item 0 pour porter la facture.
    const targetIdx = (sourcing[0]?.item_index ?? 0);
    const res = await upsertSourcing(targetIdx, { receipt_photo_url: url }, 'Facture');
    if (res.ok) toast.success('Facture pharma uploadée');
    setUploadingReceipt(false);
  };

  // Confirme que tous les items sont sourcés (status != pending)
  // Affiché en bas de la section sourcing pour passer à la livraison.
  const markAllSourced = async () => {
    // L'order.sourcing_status est maintenu par trigger ; ici on ne fait
    // qu'un feedback UI + scroll vers la section livraison.
    haptic('success');
    toast.success('Sourcing terminé. Tu peux passer à la livraison.');
    setForceSourcingMode(false);
    // Petit délai pour laisser le toast respirer
    setTimeout(() => {
      const el = document.querySelector('.liv-glass-label');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
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

  // ─── SKELETON LOADING ───
  if (loading) {
    return (
      <div className="liv-screen">
        <header className="liv-topbar">
          <div className="liv-topbar-logo">Y</div>
          <div className="liv-topbar-meta">
            <strong>YARAM · Livraison</strong>
            <p>Chargement de ta tournée…</p>
          </div>
        </header>
        <main className="liv-main">
          <div className="liv-skeleton" style={{ height: 160 }} />
          <div className="liv-skeleton" style={{ height: 120 }} />
          <div className="liv-skeleton" style={{ height: 180 }} />
        </main>
      </div>
    );
  }

  // ─── ERROR SCREEN PREMIUM ───
  if (error) {
    const supportWaUrl = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Salut, mon lien de livraison YARAM ne marche pas : ' + error)}`;
    return (
      <div className="liv-screen liv-error-screen">
        <div className="liv-error-card">
          <div className="liv-error-icon">⚠️</div>
          <h1>Lien expiré ou invalide</h1>
          <p>{error}</p>
          <p className="liv-error-sub">Contacte l'admin pour recevoir un nouveau lien.</p>
          <a href={supportWaUrl} target="_blank" rel="noopener noreferrer" className="liv-error-btn">
            💬 Contacter le support
          </a>
        </div>
      </div>
    );
  }

  const isCash = order?.payment_method === 'cod';
  const clientWaUrl = order?.address?.phone
    ? `https://wa.me/${(order.address?.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent('Salut, je suis ton livreur YARAM, je suis en route !')}`
    : null;

  // ─── stepDone : check si une étape est franchie ───
  const stepDone = (s) => {
    const ord = ['assigned', 'picking', 'picked', 'in_route', 'arrived', 'cash_collected', 'proof_uploaded', 'delivered'];
    const status = tracking?.status || 'assigned';
    const cur = ord.indexOf(status);
    const target = ord.indexOf(s);
    const curSafe = cur < 0 ? 0 : cur;
    return target >= 0 && curSafe >= target;
  };

  const isCompleted = ['awaiting_confirm', 'delivered'].includes(order?.status);
  const isDeliveredFinal = order?.status === 'delivered';
  const scannedCount = (tracking?.scanned_barcodes || []).length;
  const totalProducts = (order?.items || []).reduce((sum, it) => sum + (it.qty || 1), 0);
  const allScanned = scannedCount >= totalProducts && totalProducts > 0;

  // ─── HERO STATE : gradient + icon + label selon le status ───
  const heroState = (() => {
    if (isDeliveredFinal) {
      return { phase: 'delivered', icon: '🎉', title: 'Mission accomplie', sub: 'Cliente a confirmé la réception' };
    }
    if (order?.status === 'awaiting_confirm' || tracking?.status === 'proof_uploaded') {
      return { phase: 'confirm', icon: '✅', title: 'En attente confirmation', sub: 'La cliente a reçu le WhatsApp' };
    }
    if (tracking?.status === 'arrived' || tracking?.status === 'cash_collected') {
      return { phase: 'arrived', icon: '📍', title: 'Devant la porte', sub: isCash && !order?.cash_received ? 'Encaisse le cash' : 'Prends la preuve de livraison' };
    }
    if (tracking?.status === 'in_route') {
      return { phase: 'route', icon: '🛵', title: 'En route vers la cliente', sub: sharingGPS ? 'GPS actif · cliente notifiée' : 'Active ton GPS' };
    }
    // assigned / picking / picked / default
    const sub = tracking?.status === 'picked' ? 'Produits récupérés — en route' :
                tracking?.status === 'picking' ? 'Vérifie et scanne les produits' :
                'Récupère les produits';
    return { phase: 'pickup', icon: '📦', title: 'Pickup pharmacie', sub };
  })();

  // ─── CTA prioritaire selon le status ───
  const primaryCta = (() => {
    if (isDeliveredFinal) return null;
    if (order?.status === 'awaiting_confirm' || tracking?.status === 'proof_uploaded') {
      return { label: '⏳ Attente confirmation cliente', disabled: true, action: null };
    }
    if (tracking?.status === 'arrived' && isCash && !order?.cash_received) {
      return { label: `💵 Encaisser ${Number(order?.total || 0).toLocaleString('fr-FR')} FCFA`, disabled: busyStep === 'cash', action: markCashReceived };
    }
    if (stepDone('arrived') && (!isCash || order?.cash_received)) {
      return {
        label: confirming ? '⏳ Envoi en cours...' : '🎉 Confirmer la livraison',
        disabled: !proofMethod || confirming || (isCash && !order?.cash_received),
        action: confirmDelivery,
      };
    }
    if (tracking?.status === 'in_route') {
      return { label: '📍 Je suis arrivé', disabled: busyStep === 'arrived', action: () => updateStatus('arrived', {}, 'arrived') };
    }
    if (stepDone('picked')) {
      return { label: '🛵 Je suis parti', disabled: busyStep === 'in_route', action: () => updateStatus('in_route', {}, 'in_route') };
    }
    return null;
  })();

  return (
    <div className="liv-screen">
      {/* ─── HERO STICKY PREMIUM (DoorDash-style header) ─── */}
      <header className={`liv-hero liv-hero-${heroState.phase}`}>
        <div className="liv-hero-bg" aria-hidden="true" />

        {/* Top brand bar : logo YARAM + statut pill */}
        <div className="liv-hero-topbar">
          <div className="liv-hero-brandblock">
            <YaramLogo size={40} />
            <div className="liv-hero-brandtext">
              <span className="liv-hero-brandname">YARAM</span>
              <span className="liv-hero-brandsub">Livreur</span>
            </div>
          </div>
          <TrackingPill status={tracking?.status || 'assigned'} />
        </div>

        <div className="liv-hero-inner">
          <div className="liv-hero-icon" aria-hidden="true">{heroState.icon}</div>
          <div className="liv-hero-text">
            <div className="liv-hero-orderid">Commande #{order?.id || '—'}</div>
            <div className="liv-hero-title">{heroState.title}</div>
            <div className="liv-hero-sub">{heroState.sub}</div>
            {isCash && !order?.cash_received && !isCompleted && order?.total > 0 && (
              <div className="liv-hero-cash">
                Total à encaisser : <strong>{Number(order.total).toLocaleString('fr-FR')} FCFA</strong>
              </div>
            )}
          </div>
        </div>

        {/* Progress timeline en bas du hero */}
        {!isCompleted && (
          <ProgressTimeline stepDone={stepDone} currentStatus={tracking?.status} />
        )}
      </header>

      {/* ─── CONFETTI sur delivered ─── */}
      {isDeliveredFinal && (
        <div className="liv-confetti" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className={`liv-confetti-bit liv-confetti-bit-${i}`} />
          ))}
        </div>
      )}

      <main className="liv-main">

        {/* ─── RÉCUPÉRER À (DoorDash-style pickup section) ─── */}
        {!isCompleted && (
          <div className="liv-card-stagger" style={{ '--i': 0 }}>
            {pharmacies.length > 0 ? (
              pharmacies.map((ph, idx) => {
                const phPhone = ph?.phone || ph?.whatsapp;
                const phMapsUrl = buildMapsUrl({
                  lat: ph?.lat, lng: ph?.lng,
                  address: ph?.address || ph?.neighborhood,
                  city: ph?.city,
                });
                const addrLine = [ph?.address, ph?.neighborhood, ph?.city].filter(Boolean).join(', ');
                return (
                  <DoorDashLocationCard
                    key={ph?.id || ph?.name || idx}
                    kind="pickup"
                    sectionLabel={pharmacies.length > 1
                      ? `RÉCUPÉRER À · ${idx + 1}/${pharmacies.length}`
                      : 'RÉCUPÉRER À'}
                    title={ph?.name || 'Pharmacie partenaire'}
                    subtitle={addrLine || 'Adresse non renseignée'}
                    phone={phPhone}
                    mapsUrl={phMapsUrl}
                    meta={[
                      { icon: '🏥', label: 'Pharmacie partenaire', tone: 'primary' },
                    ]}
                    hint={order?.fulfillment_mode === 'driver_sourcing'
                      ? 'Sourcing libre — démarre par la pharma la plus proche'
                      : null}
                  />
                );
              })
            ) : (
              order?.fulfillment_mode === 'driver_sourcing' && (
                <DoorDashLocationCard
                  kind="pickup"
                  sectionLabel="RÉCUPÉRER À"
                  title="Sourcing libre"
                  subtitle="Aucune pharmacie pré-assignée"
                  hint="Démarre par la pharma la plus proche — scanne chaque produit dans la section sourcing."
                />
              )
            )}
          </div>
        )}

        {/* ─── LIVRER À (DoorDash-style delivery section) ─── */}
        {!isCompleted && (
          <div className="liv-card-stagger" style={{ '--i': 1 }}>
            <DoorDashLocationCard
              kind="delivery"
              sectionLabel="LIVRER À"
              title={order?.address?.name || 'Cliente'}
              subtitle={[
                order?.address?.line,
                [order?.address?.neighborhood, order?.address?.city || 'Dakar'].filter(Boolean).join(', '),
              ].filter(Boolean).join(' · ')}
              phone={order?.address?.phone}
              mapsUrl={buildMapsUrl({
                lat: order?.address?.lat,
                lng: order?.address?.lng,
                address: order?.address?.line,
                city: order?.address?.city,
              })}
              meta={[
                isCash
                  ? { icon: '💵', label: `Encaisser ${Number(order?.total || 0).toLocaleString('fr-FR')} FCFA`, tone: 'cash' }
                  : { icon: '✅', label: `Payé · ${paymentLabel(order?.payment_method)}`, tone: 'paid' },
                clientWaUrl && { icon: '💬', label: 'WhatsApp', tone: 'wa', href: clientWaUrl },
              ].filter(Boolean)}
            >
              {clientWaUrl && (
                <a
                  href={clientWaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="liv-dd-wa-link"
                >
                  💬 Envoyer un WhatsApp à la cliente
                </a>
              )}
            </DoorDashLocationCard>
          </div>
        )}

        {/* ─── SOURCING (Instacart-style) ─── */}
        <SourcingSection
          order={order}
          sourcing={sourcing}
          forceSourcingMode={forceSourcingMode}
          setForceSourcingMode={setForceSourcingMode}
          openScanner={(idx) => { setSourcingItemIndex(idx); setShowSourcingScanner(true); }}
          openPharmaPicker={(idx) => { setSourcingItemIndex(idx); setShowPharmaPicker(true); }}
          openSubstitute={(idx) => { setSourcingItemIndex(idx); setShowSubstituteModal(true); }}
          openUnavailable={(idx) => { setSourcingItemIndex(idx); setShowUnavailableModal(true); }}
          onUploadReceipt={uploadReceipt}
          uploadingReceipt={uploadingReceipt}
          onAllSourced={markAllSourced}
          isCompleted={isCompleted}
        />

        {/* ─── ARTICLES À LIVRER (collapsible details) ─── */}
        <details className="liv-glass liv-card-stagger liv-articles-details" style={{ '--i': 3 }}>
          <summary className="liv-articles-summary">
            <div className="liv-articles-summary-left">
              <div className="liv-avatar liv-avatar-pharma" aria-hidden="true">📦</div>
              <div>
                <div className="liv-glass-label">Articles à livrer</div>
                <div className="liv-articles-count">
                  Voir les {totalProducts} article{totalProducts > 1 ? 's' : ''} · {(order?.total || 0).toLocaleString('fr-FR')} FCFA
                </div>
              </div>
            </div>
            <div className="liv-articles-summary-right">
              <span className={`liv-pay-badge ${isCash ? 'liv-pay-cash' : 'liv-pay-card'}`}>
                {isCash ? 'CASH' : 'PAYÉ'}
              </span>
              <span className="liv-articles-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </summary>

          <div className="liv-articles-body">
            <div className="liv-items-list">
              {Array.from(new Map((order?.items || []).map(it => [it.pharmacyId, it.pharmacyName]))).map(([phId, phName]) => (
                <div key={phId} className="liv-pharmacy-group">
                  <strong>🏥 {phName || 'Pharmacie'}</strong>
                  {(order?.items || []).filter(it => it.pharmacyId === phId).map((it, i) => (
                    <div key={`${it.id || it.name}-${i}`} className="liv-item">
                      <span>{it?.name || '—'}</span>
                      <span>×{it?.qty || 1}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="liv-total">
              <span>Total</span>
              <strong>{(order?.total || 0).toLocaleString('fr-FR')} FCFA</strong>
            </div>
            {isCash ? (
              <div className="liv-cod-alert">
                💵 PAIEMENT CASH À LA LIVRAISON<br />
                <strong style={{ fontSize: 16 }}>Encaisse {(order?.total || 0).toLocaleString('fr-FR')} FCFA</strong>
              </div>
            ) : (
              <div className="liv-paid-alert">
                ✅ Déjà payé via {paymentLabel(order?.payment_method)} — Rien à encaisser
              </div>
            )}
          </div>
        </details>

        {/* ─── GPS ─── */}
        {!isCompleted && (
          <section className="liv-glass liv-card-stagger" style={{ '--i': 4 }}>
            <div className="liv-glass-label" style={{ marginBottom: 10 }}>📡 Partage GPS</div>
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
          </section>
        )}

        {/* ─── STEPS (logique inchangée) ─── */}
        {!isCompleted && (
          <section className="liv-glass liv-card-stagger" style={{ '--i': 5 }}>
            <div className="liv-glass-label" style={{ marginBottom: 12 }}>✅ Étapes de livraison</div>
            <div className="liv-steps-enriched">

              <div className={`liv-step-card ${stepDone('picking') ? 'done' : ''} ${busyStep === 'picking' ? 'loading' : ''}`} style={{ '--i': 0 }}>
                <div className="liv-step-num">
                  {stepDone('picking') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark" />
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

              <div className={`liv-step-card ${allScanned ? 'done' : ''}`} style={{ '--i': 1 }}>
                <div className="liv-step-num">
                  {allScanned ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark" />
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
                        <div key={b.code || i} style={{ padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
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

              <div className={`liv-step-card ${stepDone('picked') ? 'done' : ''} ${busyStep === 'picked' ? 'loading' : ''}`} style={{ '--i': 2 }}>
                <div className="liv-step-num">
                  {stepDone('picked') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark" />
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

              <div className={`liv-step-card ${stepDone('in_route') ? 'done' : ''} ${busyStep === 'in_route' ? 'loading' : ''}`} style={{ '--i': 3 }}>
                <div className="liv-step-num">
                  {stepDone('in_route') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark" />
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

              <div className={`liv-step-card ${stepDone('arrived') ? 'done' : ''} ${busyStep === 'arrived' ? 'loading' : ''}`} style={{ '--i': 4 }}>
                <div className="liv-step-num">
                  {stepDone('arrived') ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12l5 5L20 7" className="liv-checkmark" />
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
          </section>
        )}

        {/* ─── ENCAISSEMENT CASH ─── */}
        {!isCompleted && isCash && stepDone('arrived') && (
          <section className="liv-glass liv-card-stagger" style={{ '--i': 6 }}>
            <div className="liv-glass-label" style={{ marginBottom: 10 }}>💵 Encaissement Cash</div>
            <div className="liv-cash-box">
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                Demande à la cliente <strong style={{ fontSize: 18, color: '#1F8B4C' }}>{Number(order?.total || 0).toLocaleString('fr-FR')} FCFA</strong> cash.
              </p>
              {order?.cash_received ? (
                <div className="liv-cash-done">
                  ✅ Cash de {Number(order?.total || 0).toLocaleString('fr-FR')} FCFA reçu
                </div>
              ) : (
                <button className="liv-btn-pri" onClick={markCashReceived}>
                  💵 J'ai reçu {Number(order?.total || 0).toLocaleString('fr-FR')} FCFA cash
                </button>
              )}
            </div>
          </section>
        )}

        {/* ─── PREUVE DE LIVRAISON ─── */}
        {!isCompleted && stepDone('arrived') && (!isCash || order?.cash_received) && (
          <section className="liv-glass liv-card-stagger" style={{ '--i': 7 }}>
            <div className="liv-glass-label" style={{ marginBottom: 10 }}>📸 Preuve de livraison</div>
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
                  <img src={tracking.delivery_signature} alt="" loading="lazy" decoding="async" style={{ background: 'white' }} />
                )}
                {proofMethod === 'pin' && tracking?.delivery_pin && (
                  <div className="liv-pin-display">PIN : {tracking.delivery_pin}</div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ─── ÉCRAN FINAL : awaiting / delivered ─── */}
        {isCompleted && (
          <section className="liv-glass liv-card-stagger liv-final-card" style={{ '--i': 0 }}>
            <div className="liv-final-icon">{isDeliveredFinal ? '🎉' : '⏳'}</div>
            <h2>{isDeliveredFinal ? 'Mission accomplie !' : 'En attente confirmation cliente'}</h2>
            <p>
              {isDeliveredFinal
                ? 'Merci pour ton service. La cliente a confirmé la réception.'
                : 'Tu as bien terminé ta mission ! La cliente a reçu un WhatsApp pour confirmer la réception.'}
            </p>
            {isDeliveredFinal && (
              <div className="liv-final-badge">
                ✅ Livraison confirmée par la cliente
              </div>
            )}
          </section>
        )}
      </main>

      {/* ─── STICKY CTA BOTTOM (premium DoorDash-style) ─── */}
      {primaryCta && (
        <div className="liv-cta-sticky">
          <button
            className="liv-btn-final liv-btn-final-pro"
            onClick={primaryCta.action}
            disabled={primaryCta.disabled}
          >
            <span className="liv-cta-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span className="liv-cta-text">
              <span className="liv-cta-subtitle">Action suivante</span>
              <span className="liv-cta-label">{primaryCta.label}</span>
            </span>
            <span className="liv-cta-chev" aria-hidden="true">›</span>
          </button>
        </div>
      )}

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

      {/* ─── MODALS SOURCING ─── */}
      {showSourcingScanner && sourcingItemIndex !== null && (
        <SourcingScannerModal
          token={token}
          itemIndex={sourcingItemIndex}
          item={order?.items?.[sourcingItemIndex]}
          onFound={async (product, scanInfo) => {
            const patch = {
              sourcing_status: 'found',
              unit_price_fcfa: String(product?.price ?? scanInfo?.unit_price_fcfa ?? ''),
            };
            // Si on a aussi la pharma (geo), on l'inclut
            if (scanInfo?.pharmacy_id) patch.sourced_from_pharmacy_id = scanInfo.pharmacy_id;
            if (scanInfo?.pharmacy_name) patch.pharmacy_name_freetype = scanInfo.pharmacy_name;
            if (scanInfo?.pharmacy_lat) patch.pharmacy_lat = String(scanInfo.pharmacy_lat);
            if (scanInfo?.pharmacy_lng) patch.pharmacy_lng = String(scanInfo.pharmacy_lng);
            await upsertSourcing(sourcingItemIndex, patch, 'Trouvé');
            await logScan(sourcingItemIndex, {
              product_id: product?.id || '',
              barcode: scanInfo?.barcode || '',
              scan_result: 'match',
              pharmacy_id: scanInfo?.pharmacy_id || '',
              pharmacy_name: scanInfo?.pharmacy_name || '',
              pharmacy_lat: scanInfo?.pharmacy_lat ? String(scanInfo.pharmacy_lat) : '',
              pharmacy_lng: scanInfo?.pharmacy_lng ? String(scanInfo.pharmacy_lng) : '',
            });
            setShowSourcingScanner(false);
            setSourcingItemIndex(null);
          }}
          onNoMatch={async (barcode) => {
            await logScan(sourcingItemIndex, { barcode, scan_result: 'no_match' });
            toast.error('Produit non trouvé dans le catalogue YARAM. Utilise "Marquer trouvé" ou "Substituer".');
          }}
          onCancel={() => { setShowSourcingScanner(false); setSourcingItemIndex(null); }}
        />
      )}

      {showPharmaPicker && sourcingItemIndex !== null && (
        <PharmaPickerModal
          token={token}
          onPick={async (sel) => {
            const patch = {
              sourcing_status: 'found',
              sourced_from_pharmacy_id: sel.pharmacy_id || '',
              pharmacy_name_freetype: sel.pharmacy_name_freetype || '',
              pharmacy_lat: sel.lat ? String(sel.lat) : '',
              pharmacy_lng: sel.lng ? String(sel.lng) : '',
            };
            await upsertSourcing(sourcingItemIndex, patch, 'Pharmacie');
            setShowPharmaPicker(false);
            setSourcingItemIndex(null);
          }}
          onCancel={() => { setShowPharmaPicker(false); setSourcingItemIndex(null); }}
        />
      )}

      {showSubstituteModal && sourcingItemIndex !== null && (
        <SubstituteModal
          token={token}
          item={order?.items?.[sourcingItemIndex]}
          allowSubstitution={order?.allow_substitution !== false}
          onChoose={async (alt) => {
            await upsertSourcing(sourcingItemIndex, {
              sourcing_status: 'substituted',
              substituted_with_product_id: alt?.id || '',
              substituted_with_name: alt?.name || '',
              unit_price_fcfa: alt?.price != null ? String(alt.price) : '',
            }, 'Substitution');
            setShowSubstituteModal(false);
            setSourcingItemIndex(null);
          }}
          onCancel={() => { setShowSubstituteModal(false); setSourcingItemIndex(null); }}
        />
      )}

      {showUnavailableModal && sourcingItemIndex !== null && (
        <UnavailableModal
          item={order?.items?.[sourcingItemIndex]}
          onConfirm={async (notes) => {
            await upsertSourcing(sourcingItemIndex, {
              sourcing_status: 'unavailable',
              notes: notes || '',
            }, 'Indisponible');
            setShowUnavailableModal(false);
            setSourcingItemIndex(null);
          }}
          onCancel={() => { setShowUnavailableModal(false); setSourcingItemIndex(null); }}
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

      // PERF : essaie BarcodeDetector natif (0 byte JS sur Android Chrome/Edge),
      // fallback ZXing lazy-import sur iOS Safari.
      const { startBarcodeScan } = await import('../lib/barcode');
      const handle = await startBarcodeScan(videoRef.current, async (code) => {
        if (alreadyScanned.includes(code)) {
          setVerification({ barcode: code, alreadyScanned: true, message: 'Déjà scanné' });
          setTimeout(() => setVerification(null), 1500);
          return;
        }
        if (verifying || verification) return;
        if (navigator.vibrate) navigator.vibrate(100);
        await verifyBarcode(code);
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
    try {
      if (readerRef.current) {
        // Le handle peut etre { stop } (nouveau startBarcodeScan) ou { reset } (legacy zxing)
        if (readerRef.current.stop) readerRef.current.stop();
        else if (readerRef.current.reset) readerRef.current.reset();
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
                      loading="lazy"
                      decoding="async"
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

// ════════════════════════════════════════════════════════════
// SOURCING (Instacart-style) — sous-composants
// ════════════════════════════════════════════════════════════

function SourcingSection({
  order, sourcing, forceSourcingMode, setForceSourcingMode,
  openScanner, openPharmaPicker, openSubstitute, openUnavailable,
  onUploadReceipt, uploadingReceipt, onAllSourced, isCompleted,
}) {
  const items = order?.items || [];
  const mode = order?.fulfillment_mode;
  const isSourcingOrder = mode === 'driver_sourcing' || mode === 'mixed';
  // Si fulfillment_mode est absent, on cache par défaut ; le livreur peut
  // toujours activer manuellement via le toggle ci-dessous.
  const showSection = !isCompleted && (isSourcingOrder || forceSourcingMode);

  // Index sourcing par item_index pour lookup O(1)
  const byIndex = {};
  (sourcing || []).forEach((s) => { byIndex[s.item_index] = s; });

  const total = items.length;
  const sourcedCount = items.reduce((acc, _, i) => {
    const st = byIndex[i]?.sourcing_status;
    return acc + (st && st !== 'pending' ? 1 : 0);
  }, 0);
  const allDone = total > 0 && sourcedCount === total;

  // Récupère l'URL facture si déjà uploadée
  const receiptUrl = (sourcing || []).map(s => s.receipt_photo_url).find(Boolean) || null;

  // Toggle d'activation manuelle si le mode n'est pas défini
  const showToggle = !isCompleted && !isSourcingOrder;

  return (
    <>
      {showToggle && (
        <section className="liv-glass liv-card-stagger liv-sourcing-toggle" style={{ '--i': 1.5 }}>
          <div className="liv-glass-head">
            <div className="liv-avatar liv-avatar-pharma" aria-hidden="true">🛒</div>
            <div className="liv-glass-head-text">
              <div className="liv-glass-label">Mode sourcing Instacart</div>
              <div className="liv-glass-title">Tu fais le tour des pharmacies ?</div>
              <div className="liv-glass-sub">
                Active si tu dois chercher les produits article par article
              </div>
            </div>
            <button
              className={forceSourcingMode ? 'liv-mini-btn done' : 'liv-mini-btn pri'}
              onClick={() => setForceSourcingMode(v => !v)}
            >
              {forceSourcingMode ? '✓ Activé' : 'Activer'}
            </button>
          </div>
        </section>
      )}

      {showSection && total > 0 && (
        <section className="liv-glass liv-card-stagger liv-sourcing-section" style={{ '--i': 2 }}>
          <div className="liv-glass-head">
            <div className="liv-avatar liv-avatar-pharma" aria-hidden="true">🛒</div>
            <div className="liv-glass-head-text">
              <div className="liv-glass-label">Sourcing des articles</div>
              <div className="liv-glass-title">
                {sourcedCount} / {total} sourcé{sourcedCount > 1 ? 's' : ''}
              </div>
              <div className="liv-glass-sub">
                Pour chaque article : scanne, marque trouvé, substitue ou indispo.
              </div>
            </div>
          </div>

          <div className="liv-sourcing-progress" aria-hidden="true">
            <div
              className="liv-sourcing-progress-bar"
              style={{ width: total ? `${(sourcedCount / total) * 100}%` : '0%' }}
            />
          </div>

          <div className="liv-sourcing-list">
            {items.map((it, idx) => {
              const s = byIndex[idx] || {};
              const status = s.sourcing_status || 'pending';
              const color = SOURCING_COLORS[status];
              const label = SOURCING_LABELS[status];
              const icon = SOURCING_ICONS[status];
              return (
                <div key={`src-${idx}`} className="liv-sourcing-card">
                  <div className="liv-sourcing-card-head">
                    {it?.img ? (
                      <img
                        src={it.img}
                        alt=""
                        className="liv-sourcing-img"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="liv-sourcing-img liv-sourcing-img-fallback" aria-hidden="true">
                        💊
                      </div>
                    )}
                    <div className="liv-sourcing-meta">
                      <div className="liv-sourcing-name">{it?.name || 'Article'}</div>
                      <div className="liv-sourcing-sub">
                        {it?.brand || it?.brandName || it?.brand_name || ''}
                        {(it?.brand || it?.brandName || it?.brand_name) ? ' · ' : ''}
                        Qty {it?.qty || 1}
                        {it?.price ? ` · ${Number(it.price).toLocaleString('fr-FR')} F` : ''}
                      </div>
                    </div>
                    <span
                      className="liv-sourcing-status-pill"
                      style={{ background: color, color: 'white' }}
                    >
                      <span aria-hidden="true">{icon}</span> {label}
                    </span>
                  </div>

                  {(s.sourced_from_pharmacy_id || s.pharmacy_name_freetype) && (
                    <div className="liv-sourcing-pharma">
                      🏥 {s.pharmacy_name_freetype || 'Pharmacie partenaire'}
                    </div>
                  )}

                  {status === 'substituted' && s.substituted_with_name && (
                    <div className="liv-sourcing-subst">
                      ↔ Remplacé par <strong>{s.substituted_with_name}</strong>
                    </div>
                  )}

                  {status === 'unavailable' && s.notes && (
                    <div className="liv-sourcing-notes">📝 {s.notes}</div>
                  )}

                  <div className="liv-sourcing-actions">
                    <button
                      className="liv-mini-btn"
                      onClick={() => openScanner(idx)}
                      disabled={status === 'unavailable'}
                    >
                      📊 Scanner
                    </button>
                    <button
                      className="liv-mini-btn pri"
                      onClick={() => openPharmaPicker(idx)}
                      disabled={status === 'unavailable'}
                    >
                      ✓ Trouvé
                    </button>
                    <button
                      className="liv-mini-btn"
                      onClick={() => openSubstitute(idx)}
                      disabled={order?.allow_substitution === false || status === 'unavailable'}
                      title={order?.allow_substitution === false ? 'La cliente refuse les substitutions' : ''}
                    >
                      ↔ Substituer
                    </button>
                    <button
                      className="liv-mini-btn"
                      onClick={() => openUnavailable(idx)}
                    >
                      ✗ Indispo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Upload facture pharma */}
          <div className="liv-sourcing-receipt">
            <label className="liv-mini-btn" style={{ cursor: 'pointer' }}>
              {uploadingReceipt
                ? '⏳ Upload en cours…'
                : receiptUrl
                  ? '📄 Re-uploader la facture pharma'
                  : '📄 Upload facture pharma'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploadingReceipt}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadReceipt(f);
                  e.target.value = '';
                }}
                style={{ display: 'none' }}
              />
            </label>
            {receiptUrl && (
              <a
                href={receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="liv-sourcing-receipt-link"
              >
                Voir facture →
              </a>
            )}
          </div>

          {allDone && (
            <button
              className="liv-btn-pri liv-sourcing-done"
              onClick={onAllSourced}
            >
              ✅ Tous les items sourcés — passer à la livraison
            </button>
          )}
        </section>
      )}
    </>
  );
}

// ─── Modal scanner sourcing : scan barcode, lookup en DB, retourne produit ───
function SourcingScannerModal({ token, item, onFound, onNoMatch, onCancel }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [geo, setGeo] = useState(null);
  const [pharmaName, setPharmaName] = useState('');

  // Geolocate au mount pour pouvoir associer la pharma au scan
  useEffect(() => {
    getCurrentPositionAsync().then(setGeo).catch(() => {});
  }, []);

  const cleanup = () => {
    try {
      if (readerRef.current?.stop) readerRef.current.stop();
      else if (readerRef.current?.reset) readerRef.current.reset();
      readerRef.current = null;
    } catch {}
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    } catch {}
  };

  useEffect(() => () => cleanup(), []);

  const requestPermission = async () => {
    setStatus('requesting');
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus('scanning');

      const { startBarcodeScan } = await import('../lib/barcode');
      const handle = await startBarcodeScan(videoRef.current, async (code) => {
        if (busy || lookup) return;
        setBusy(true);
        if (navigator.vibrate) navigator.vibrate(100);
        const { data, error } = await supabase.rpc('livreur_product_by_barcode', {
          p_token: token, p_barcode: code,
        });
        if (error || !data?.success) {
          setLookup({ barcode: code, product: null, error: error?.message });
        } else {
          setLookup({ barcode: code, product: data.product });
        }
        setBusy(false);
      });
      readerRef.current = handle;
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setErrorMsg('Permission caméra refusée. Va dans Réglages > Safari > Caméra.');
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

  const handleConfirm = () => {
    cleanup();
    if (!lookup) return;
    if (!lookup.product) {
      onNoMatch?.(lookup.barcode);
      return;
    }
    onFound?.(lookup.product, {
      barcode: lookup.barcode,
      pharmacy_lat: geo?.lat,
      pharmacy_lng: geo?.lng,
      pharmacy_name: pharmaName || null,
    });
  };

  const handleReject = () => setLookup(null);

  const handleCancel = () => { cleanup(); onCancel?.(); };

  return (
    <div className="liv-modal-overlay" onClick={handleCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500, padding: 16 }}>
        <h3 style={{ marginBottom: 8 }}>📊 Scanner produit sourcing</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
          {item?.name ? `Sourcing : ${item.name}` : 'Scanne le code-barres du produit trouvé'}
        </p>

        {status === 'idle' && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
            <button className="liv-btn-pri" onClick={requestPermission} style={{ width: '100%', marginBottom: 8 }}>
              📷 Activer la caméra
            </button>
            <button className="liv-btn-stop" onClick={handleCancel} style={{ width: '100%' }}>Annuler</button>
          </div>
        )}

        {(status === 'requesting' || status === 'scanning') && (
          <>
            <div style={{
              position: 'relative', background: '#000', borderRadius: 12,
              overflow: 'hidden', aspectRatio: '4/3', marginBottom: 14,
            }}>
              <video
                ref={videoRef}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                playsInline muted autoPlay
              />
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}>
                <div style={{
                  width: '80%', height: '40%',
                  border: '3px solid rgba(31,139,76,0.8)', borderRadius: 8,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
                }} />
              </div>
              {busy && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', background: 'rgba(0,0,0,0.7)', fontSize: 14, fontWeight: 700,
                }}>
                  🔍 Recherche en base…
                </div>
              )}
              {lookup && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: 'white',
                  background: lookup.product ? 'rgba(31,139,76,0.95)' : 'rgba(244,181,58,0.95)',
                  padding: 16, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>
                    {lookup.product ? '✅' : '⚠️'}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {lookup.product ? lookup.product.name : 'Produit non catalogué'}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 6, opacity: 0.8 }}>
                    {lookup.barcode}
                  </div>
                </div>
              )}
            </div>

            <input
              type="text"
              value={pharmaName}
              onChange={(e) => setPharmaName(e.target.value)}
              placeholder="Nom de la pharmacie (optionnel)"
              style={{
                width: '100%', padding: '10px 12px',
                border: '1.5px solid #EEE', borderRadius: 10, fontSize: 14, marginBottom: 10,
              }}
            />

            {lookup && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button className="liv-btn-stop" onClick={handleReject} style={{ flex: 1 }}>
                  🔄 Re-scanner
                </button>
                <button
                  className="liv-btn-pri"
                  onClick={handleConfirm}
                  style={{ flex: 2, background: lookup.product ? '#1F8B4C' : '#F4B53A' }}
                >
                  {lookup.product ? '✓ Confirmer trouvé' : 'Ajouter comme substitut'}
                </button>
              </div>
            )}

            {!lookup && (
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

// ─── Modal "où es-tu ?" — pharma picker avec geo + freetype ───
function PharmaPickerModal({ token, onPick, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [geo, setGeo] = useState(null);
  const [freetype, setFreetype] = useState('');
  const [askedGeo, setAskedGeo] = useState(false);

  const detect = async () => {
    setLoading(true);
    try {
      const pos = await getCurrentPositionAsync({ enableHighAccuracy: true, timeout: 15000 });
      setGeo(pos);
      setAskedGeo(true);
      const { data, error } = await supabase.rpc('livreur_nearby_pharmacies', {
        p_token: token,
        p_lat: pos.lat,
        p_lng: pos.lng,
        p_radius_m: 500,
      });
      if (error) {
        console.warn('nearby pharma error', error);
        toast.error('GPS OK mais lookup pharma KO');
      } else if (data?.success && Array.isArray(data.rows)) {
        setNearby(data.rows);
      }
    } catch {
      toast.error('Géolocalisation refusée. Saisis le nom de la pharmacie ci-dessous.');
      setAskedGeo(true);
    } finally {
      setLoading(false);
    }
  };

  // Lance le detect au mount. Une seule fois, intentionnellement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { detect(); }, []);

  const pickPartner = (ph) => {
    onPick({
      pharmacy_id: ph.id,
      pharmacy_name_freetype: ph.name,
      lat: ph.lat,
      lng: ph.lng,
    });
  };

  const pickFreetype = () => {
    if (!freetype.trim()) { toast.error('Saisis un nom de pharmacie'); return; }
    onPick({
      pharmacy_id: null,
      pharmacy_name_freetype: freetype.trim(),
      lat: geo?.lat || null,
      lng: geo?.lng || null,
    });
  };

  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3>📍 Où es-tu ?</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
          On match les pharmacies dans un rayon de 500 m.
        </p>

        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: '#6B6B6B' }}>
            🔍 Localisation en cours…
          </div>
        )}

        {!loading && nearby.length > 0 && (
          <div className="liv-pharma-picker-list">
            {nearby.map((ph) => (
              <button
                key={ph.id}
                className="liv-pharma-picker-row"
                onClick={() => pickPartner(ph)}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>🏥 {ph.name}</div>
                  <div style={{ fontSize: 12, color: '#6B6B6B' }}>
                    {[ph.address, ph.neighborhood, ph.city].filter(Boolean).join(', ')}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#1F8B4C', fontWeight: 700 }}>
                  {ph.distance_m != null ? `${Math.round(ph.distance_m)} m` : ''}
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && askedGeo && nearby.length === 0 && (
          <p style={{ fontSize: 13, color: '#A07700', marginBottom: 10 }}>
            Aucune pharma partenaire à proximité — saisis le nom manuellement :
          </p>
        )}

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, color: '#6B6B6B', fontWeight: 600 }}>
            Autre pharmacie (non partenaire)
          </label>
          <input
            type="text"
            value={freetype}
            onChange={(e) => setFreetype(e.target.value)}
            placeholder="Ex : Pharmacie de Mermoz"
            style={{
              width: '100%', padding: '10px 12px', marginTop: 6,
              border: '1.5px solid #EEE', borderRadius: 10, fontSize: 14,
            }}
          />
          <button
            className="liv-btn-pri"
            onClick={pickFreetype}
            style={{ width: '100%', marginTop: 10 }}
          >
            ✓ Valider cette pharma
          </button>
        </div>

        <button className="liv-btn-stop" onClick={onCancel} style={{ marginTop: 12, width: '100%' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Modal substitution : appelle livreur_get_alternatives à la demande ───
function SubstituteModal({ token, item, allowSubstitution, onChoose, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [alts, setAlts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // product_id du source : peut être dans item.id ou item.product_id
  const productId = item?.id || item?.product_id || null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!productId) { setLoaded(true); return; }
      setLoading(true);
      const { data, error } = await supabase.rpc('livreur_get_alternatives', {
        p_token: token, p_product_id: productId,
      });
      if (!cancelled) {
        if (error) toast.error('Lookup alternatives : ' + error.message);
        const rows = (data?.success && Array.isArray(data.rows)) ? data.rows : [];
        setAlts(rows);
        setLoading(false);
        setLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token, productId]);

  if (!allowSubstitution) {
    return (
      <div className="liv-modal-overlay" onClick={onCancel}>
        <div className="liv-modal" onClick={e => e.stopPropagation()}>
          <h3>↔ Substitution refusée</h3>
          <p style={{ fontSize: 14, color: '#6B6B6B', marginBottom: 16 }}>
            La cliente a refusé toute substitution pour cette commande. Marque l'article
            comme indisponible si tu ne le trouves pas.
          </p>
          <button className="liv-btn-stop" onClick={onCancel}>OK</button>
        </div>
      </div>
    );
  }

  const itemPrice = item?.price ? Number(item.price) : null;

  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>↔ Substituer {item?.name || 'cet article'}</h3>
        <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
          Choisis un produit de remplacement parmi les alternatives validées.
        </p>

        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: '#6B6B6B' }}>
            🔍 Recherche d'alternatives…
          </div>
        )}

        {loaded && !loading && alts.length === 0 && (
          <p style={{ fontSize: 14, color: '#A07700', padding: 12, background: '#FEF6E5', borderRadius: 10 }}>
            Aucune alternative configurée pour ce produit.
          </p>
        )}

        <div className="liv-alt-list">
          {alts.map((a) => {
            const diff = itemPrice != null && a.price != null ? a.price - itemPrice : null;
            return (
              <button
                key={a.id}
                className="liv-alt-row"
                onClick={() => onChoose(a)}
              >
                {a.image_url ? (
                  <img src={a.image_url} alt="" className="liv-alt-img" loading="lazy" decoding="async" />
                ) : (
                  <div className="liv-alt-img liv-alt-img-fallback" aria-hidden="true">💊</div>
                )}
                <div className="liv-alt-meta">
                  <div className="liv-alt-name">{a.name}</div>
                  <div className="liv-alt-sub">
                    {a.brand_name || ''}{a.brand_name && a.reason ? ' · ' : ''}{a.reason || ''}
                  </div>
                </div>
                <div className="liv-alt-price">
                  <div style={{ fontWeight: 800 }}>
                    {Number(a.price || 0).toLocaleString('fr-FR')} F
                  </div>
                  {diff != null && (
                    <div style={{
                      fontSize: 11, fontWeight: 700,
                      color: diff > 0 ? '#EF4444' : diff < 0 ? '#1F8B4C' : '#94A3B8',
                    }}>
                      {diff > 0 ? '+' : ''}{diff.toLocaleString('fr-FR')} F
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <button className="liv-btn-stop" onClick={onCancel} style={{ marginTop: 12, width: '100%' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Modal Indisponible : confirm + note optionnelle ───
function UnavailableModal({ item, onConfirm, onCancel }) {
  const [notes, setNotes] = useState('');
  return (
    <div className="liv-modal-overlay" onClick={onCancel}>
      <div className="liv-modal" onClick={e => e.stopPropagation()}>
        <h3>✗ Marquer indisponible</h3>
        <p style={{ fontSize: 14, color: '#6B6B6B', marginBottom: 12 }}>
          <strong>{item?.name || 'Cet article'}</strong> est introuvable dans les pharmacies visitées ?
        </p>
        <label style={{ fontSize: 12, color: '#6B6B6B', fontWeight: 600 }}>
          Note pour la cliente (optionnel)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Ex : Rupture de stock dans 3 pharmacies"
          style={{
            width: '100%', marginTop: 6, padding: '10px 12px',
            border: '1.5px solid #EEE', borderRadius: 10, fontSize: 14,
            fontFamily: 'inherit', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="liv-btn-stop" onClick={onCancel} style={{ flex: 1 }}>Annuler</button>
          <button
            className="liv-btn-pri"
            onClick={() => onConfirm(notes)}
            style={{ flex: 2, background: '#EF4444' }}
          >
            ✗ Confirmer indispo
          </button>
        </div>
      </div>
    </div>
  );
}
