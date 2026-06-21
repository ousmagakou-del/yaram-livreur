import { useState, useEffect, useMemo, useRef } from 'react';
import { signUp, signIn, signInWithGoogle, supabase } from '../lib/supabase';
import { signInWithApple, shouldShowAppleButton } from '../lib/auth';
import { notifyWelcome } from '../lib/notifications';
import { sendEmail } from '../lib/emails';
import { isIOSApp, isNativeApp } from '../lib/platform';
import { isBiometricAvailable, isBiometricEnabled, loginWithBiometric, enableBiometric } from '../lib/biometric';
import { toast } from '../lib/toast';
import { trackEvent } from '../lib/analytics';
import './Onboarding.css';

// ─── URLs des photos onboarding (Supabase Storage) ───
const PHOTO_WOMAN   = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/onboarding/onboarding-woman.jpg';
const PHOTO_MAN     = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/onboarding/onboarding-man.jpg';
const PHOTO_LIVREUR = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/onboarding/onboarding-livreur.jpg';

// ═══ Welcome carousel : 4 slides qui pitchent YARAM ═══
const SLIDES = [
  {
    img: PHOTO_WOMAN,
    badge: 'Livraison Dakar',
    title: 'Tes produits beauté livrés à Dakar',
    desc: 'Pharmacies partenaires, livraison 24h, Wave/OM/cash. Plus jamais besoin de courir après ton sérum.',
    icon: 'box',
  },
  {
    img: PHOTO_WOMAN,
    badge: 'IA gratuite',
    title: 'Scan IA peau gratuit en 30 secondes',
    desc: 'Photo + analyse intelligente. Type de peau, score sur 100, recommandations personnalisées.',
    icon: 'scan',
  },
  {
    img: PHOTO_MAN,
    badge: 'Meilleur prix',
    title: 'Compare les prix entre pharmacies',
    desc: 'On scanne les prix pour toi. Tu paies toujours le meilleur tarif, garanti.',
    icon: 'compare',
  },
  {
    img: PHOTO_LIVREUR,
    badge: 'Récompenses',
    title: 'Cumule des points fidélité',
    desc: 'Chaque commande te rapporte. Bonus parrainage, remises exclusives, cadeaux surprise.',
    icon: 'gift',
  },
];

// Liste des principales villes du Sénégal pour le dropdown
const SENEGAL_CITIES = [
  'Dakar', 'Pikine', 'Guédiawaye', 'Rufisque', 'Bargny',
  'Thiès', 'Mbour', 'Saly', 'Saint-Louis', 'Kaolack',
  'Ziguinchor', 'Touba', 'Diourbel', 'Tambacounda', 'Kolda',
  'Louga', 'Matam', 'Fatick', 'Kaffrine', 'Sédhiou',
  'Kédougou', 'Podor', 'Richard-Toll', 'Joal-Fadiouth', 'Autre',
];

// ─── Icônes SVG des slides (overlay sur photo) ───
function SlideIcon({ name }) {
  const props = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'box')     return <svg {...props}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
  if (name === 'scan')    return <svg {...props}><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><circle cx="12" cy="12" r="3"/></svg>;
  if (name === 'compare') return <svg {...props}><line x1="12" y1="2" x2="12" y2="22"/><polyline points="6 8 12 2 18 8"/><polyline points="6 16 12 22 18 16"/></svg>;
  if (name === 'gift')    return <svg {...props}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>;
  return null;
}

// ─── Validation email simple (regex production-grade) ───
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ─── Force du mot de passe (score 0-4) ───
function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: '' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd) || /[^A-Za-z0-9]/.test(pwd)) score++;
  const labels = ['', 'Faible', 'Moyen', 'Bon', 'Excellent'];
  return { score, label: labels[score] };
}

// ─── Haptic léger : safe no-op si pas dispo ───
function haptic(kind = 'light') {
  try {
    if (window?.navigator?.vibrate) {
      window.navigator.vibrate(kind === 'light' ? 10 : 25);
    }
  } catch (_) { /* silencieux */ }
}

// ─── Champ avec floating label + validation live ───
// state: 'idle' | 'valid' | 'invalid'
function FloatingField({ id, label, type = 'text', value, onChange, state = 'idle', autoFocus, suffix, hint, autoComplete, inputMode, onKeyDown }) {
  const [focus, setFocus] = useState(false);
  const lifted = focus || !!value;
  return (
    <div className={`ff-wrap ${state}`} data-focus={focus ? '1' : '0'}>
      <input
        id={id}
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className="ff-input"
      />
      <label htmlFor={id} className={`ff-label ${lifted ? 'lifted' : ''}`}>{label}</label>
      {suffix && <div className="ff-suffix">{suffix}</div>}
      {state === 'valid' && !suffix && (
        <div className="ff-state-icon ff-ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      )}
      {state === 'invalid' && !suffix && (
        <div className="ff-state-icon ff-warn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
      )}
      {hint && <div className="ff-hint">{hint}</div>}
    </div>
  );
}

export default function Onboarding({ onComplete }) {
  const [slide, setSlide] = useState(0);
  // 'intro' | 'auth' | 'profile' | 'done'
  const [step, setStep] = useState('intro');
  // 'choice' | 'signup' | 'login' — sous-état auth
  const [authView, setAuthView] = useState('choice');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptCgu, setAcceptCgu] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState(null);
  const [signupUserId, setSignupUserId] = useState(null);
  const [successPulse, setSuccessPulse] = useState(false);

  // ─── Carousel swipe state ───
  const carouselRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const swipeLockRef = useRef(false);

  // ─── Modal mot de passe oublie ───
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState({ text: '', kind: '' });

  // ─── Face ID / Touch ID (Option B : reconnexion rapide) ───
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioType, setBioType] = useState(null);
  const [bioEnabledEmail, setBioEnabledEmail] = useState(null);
  const [bioLoading, setBioLoading] = useState(false);
  const [askEnableBio, setAskEnableBio] = useState(false);
  const [enabledUserEmail, setEnabledUserEmail] = useState(null);

  // Check Face ID dispo au mount (sur iOS uniquement)
  useEffect(() => {
    (async () => {
      const { available, type } = await isBiometricAvailable();
      if (available) {
        setBioAvailable(true);
        setBioType(type);
        const { enabled, email: storedEmail } = await isBiometricEnabled();
        if (enabled) setBioEnabledEmail(storedEmail || 'utilisateur');
      }
    })();
  }, []);

  // ─── Validation live ───
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordStrong = useMemo(() => passwordStrength(password), [password]);
  const passwordValid = password.length >= 8;
  const firstNameValid = firstName.trim().length >= 2;

  const signupCanSubmit = emailValid && passwordValid && acceptCgu && !loading;
  const loginCanSubmit  = emailValid && password.length >= 6 && !loading;

  // ─── Handler Face ID ───
  const handleFaceIdLogin = async () => {
    haptic('light');
    setBioLoading(true);
    setError(null);
    try {
      const result = await loginWithBiometric();
      if (!result.ok) {
        if (result.error === 'cancelled') {
          setBioLoading(false);
          return;
        }
        if (result.error === 'session_expired_relogin_required') {
          setError('Ta session Face ID a expiré. Reconnecte-toi avec ton mot de passe.');
          setBioEnabledEmail(null);
        } else {
          setError('Connexion Face ID échouée. Utilise ton mot de passe.');
        }
        setBioLoading(false);
        return;
      }
      if (onComplete) onComplete(result.user);
    } catch (e) {
      setError(e?.message || 'Erreur Face ID');
      setBioLoading(false);
    }
  };

  const handleEnableBio = async () => {
    haptic('light');
    setBioLoading(true);
    const result = await enableBiometric(enabledUserEmail);
    setBioLoading(false);
    if (result.ok) {
      toast.success('Face ID activé !');
    } else if (result.error !== 'cancelled') {
      toast.error('Activation Face ID échouée : ' + (result.error || ''));
    }
    setAskEnableBio(false);
    // Si on a un userId fraîchement créé → on passe au profile completion
    if (signupUserId) {
      setStep('profile');
    } else if (onComplete) {
      onComplete();
    }
  };

  const handleSkipBio = () => {
    setAskEnableBio(false);
    if (signupUserId) {
      setStep('profile');
    } else if (onComplete) {
      onComplete();
    }
  };

  // ═══ Carousel swipe handlers ═══
  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeLockRef.current = false;
  };
  const onTouchMove = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) {
      swipeLockRef.current = true;
    }
  };
  const onTouchEnd = (e) => {
    if (!swipeLockRef.current || touchStartX.current == null) {
      touchStartX.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) > 50) {
      if (dx < 0 && slide < SLIDES.length - 1) {
        haptic('light');
        setSlide(slide + 1);
      } else if (dx > 0 && slide > 0) {
        haptic('light');
        setSlide(slide - 1);
      }
    }
  };

  const handleNext = () => {
    haptic('light');
    if (slide < SLIDES.length - 1) setSlide(slide + 1);
    else setStep('auth');
  };

  // ─── Friendly error mapper ───
  const friendlyAuthError = (err) => {
    const m = (err?.message || '').toLowerCase();
    if (m.includes('user already registered')) return 'Cet email a déjà un compte. Connecte-toi.';
    if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.';
    if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) return 'Trop de tentatives. Réessaie dans quelques minutes.';
    if (m.includes('email not confirmed')) return 'Vérifie ton email pour confirmer ton compte avant de te connecter.';
    if (m.includes('invalid email') || m.includes('email_address_invalid')) return 'Email invalide.';
    if (m.includes('password should be at least')) return 'Mot de passe trop court (8+ caractères).';
    if (m.includes('network') || m.includes('fetch')) return 'Pas de connexion. Vérifie ton réseau.';
    return err?.message || 'Erreur inattendue. Réessaie.';
  };

  // ═══ Sign Up (PRÉSERVÉ : logique signUp + maybeSendWelcomeEmail) ═══
  const handleSignUp = async () => {
    haptic('light');
    setError(null);
    if (!emailValid) { setError('Email invalide'); return; }
    if (!passwordValid) { setError('Mot de passe trop court (8+ caractères)'); return; }
    if (!acceptCgu) { setError('Tu dois accepter les CGU'); return; }

    // ─── ANALYTICS : signup_started ───
    try { trackEvent('signup_started', { method: 'email' }); } catch {}

    setLoading(true);
    try {
      const { data, error } = await signUp(email, password, firstName);
      if (error) throw error;
      if (data.user) {
        try {
          await supabase.from('users_profile').upsert({
            id: data.user.id,
            email: email.trim(),
            first_name: firstName.trim() || null,
            phone: phone.trim() || null,
          }, { onConflict: 'id' });
        } catch (e) {
          console.warn('[signup] users_profile upsert failed:', e.message);
        }

        if (phone.trim()) {
          notifyWelcome({
            userId: data.user.id,
            phone: phone.trim(),
            firstName: firstName.trim(),
          }).catch(e => console.warn('welcome WhatsApp failed:', e.message));
        }
        if (email.trim()) {
          sendEmail({
            to: email.trim(),
            template: 'welcome',
            params: { firstName: firstName.trim() },
          }).catch(e => console.warn('welcome email failed:', e.message));
        }

        setSignupUserId(data.user.id);
        setSuccessPulse(true);
        haptic('strong');

        // ─── ANALYTICS : signup_completed ───
        try { trackEvent('signup_completed', { method: 'email', user_id: data.user.id }); } catch {}

        // Animation checkmark 700ms puis transition
        setTimeout(() => {
          if (bioAvailable) {
            setEnabledUserEmail(email.trim());
            setAskEnableBio(true);
          } else {
            setStep('profile');
          }
        }, 800);
      }
    } catch (err) {
      // ─── ANALYTICS : signup_failed ───
      try { trackEvent('signup_failed', { method: 'email', reason: err?.message }); } catch {}
      setError(friendlyAuthError(err));
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    haptic('light');
    setError(null);
    if (!emailValid || !password.trim()) {
      setError('Email et mot de passe requis');
      return;
    }
    // ─── ANALYTICS : login_started ───
    try { trackEvent('login_started', { method: 'email' }); } catch {}
    setLoading(true);
    try {
      const { data, error } = await signIn(email, password);
      if (error) throw error;
      if (data.user) {
        // ─── ANALYTICS : login_completed ───
        try { trackEvent('login_completed', { method: 'email', user_id: data.user.id }); } catch {}
        if (bioAvailable && bioEnabledEmail !== email.trim()) {
          setEnabledUserEmail(email.trim());
          setAskEnableBio(true);
          setLoading(false);
          return;
        }
        if (onComplete) await onComplete();
      }
    } catch (err) {
      // ─── ANALYTICS : login_failed ───
      try { trackEvent('login_failed', { method: 'email', reason: err?.message }); } catch {}
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    haptic('light');
    setError(null);
    setGoogleLoading(true);
    // ─── ANALYTICS : login_started (Google OAuth) ───
    try { trackEvent('login_started', { method: 'google' }); } catch {}
    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
      // Note: Google OAuth = redirect. login_completed est trigger côté App.jsx
      // via identifyUser quand la session revient.
    } catch (err) {
      console.error('Google auth error:', err);
      try { trackEvent('login_failed', { method: 'google', reason: err?.message }); } catch {}
      setError('Erreur connexion Google : ' + (err.message || 'Réessaie'));
      setGoogleLoading(false);
    }
  };

  const handleApple = async () => {
    haptic('light');
    setError(null);
    setAppleLoading(true);
    // ─── ANALYTICS : login_started (Apple) ───
    try { trackEvent('login_started', { method: 'apple' }); } catch {}
    try {
      const result = await signInWithApple();
      if (result?.user) {
        try { trackEvent('login_completed', { method: 'apple', user_id: result.user.id }); } catch {}
        if (bioAvailable) {
          setEnabledUserEmail(result.user.email || 'apple');
          setAskEnableBio(true);
          setAppleLoading(false);
          return;
        }
        if (onComplete) await onComplete();
      }
    } catch (err) {
      console.error('Apple auth error:', err);
      const msg = err?.message || 'Réessaie';
      if (!/annul|cancel/i.test(msg)) {
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setAppleLoading(false);
    }
  };

  // ═══ Profile Completion (post-signup, optionnel) ═══
  const handleSaveProfile = async () => {
    haptic('light');
    setLoading(true);
    try {
      const payload = {
        id: signupUserId,
        email: email.trim(),
        first_name: firstName.trim() || null,
        phone: phone.trim() || null,
      };
      if (city) payload.city = city;
      await supabase.from('users_profile').upsert(payload, { onConflict: 'id' });
    } catch (e) {
      console.warn('[profile] save failed:', e.message);
    } finally {
      setLoading(false);
      setStep('done');
    }
  };

  const handleSkipProfile = () => {
    haptic('light');
    setStep('done');
  };

  // ─── Forgot password handler ───
  const handleForgotSubmit = async () => {
    setForgotMsg({ text: '', kind: '' });
    if (!forgotEmail.trim()) {
      setForgotMsg({ text: 'Entre ton email', kind: 'err' });
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: window.location.origin + '/?reset=1',
      });
      if (error) throw error;
      setForgotMsg({
        text: 'Email envoyé ! Vérifie ta boîte (et les spams). Clique sur le lien pour créer un nouveau mot de passe.',
        kind: 'ok',
      });
      setTimeout(() => {
        setForgotOpen(false);
        setForgotEmail('');
        setForgotMsg({ text: '', kind: '' });
      }, 4000);
    } catch (err) {
      setForgotMsg({ text: err.message || 'Erreur. Réessaie.', kind: 'err' });
    } finally {
      setForgotLoading(false);
    }
  };

  // ═══════════════ STEP : INTRO (carousel) ═══════════════
  if (step === 'intro') {
    return (
      <div
        className="ob-screen"
        ref={carouselRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Stack des images : fade entre les slides */}
        <div className="ob-hero-stack">
          {SLIDES.map((sl, i) => (
            <div
              key={i}
              className={`ob-hero-img ${i === slide ? 'active' : ''}`}
              style={{ backgroundImage: `url(${sl.img})` }}
            />
          ))}
        </div>

        <div className="ob-skip-bar">
          <button className="ob-skip" onClick={() => { haptic('light'); setStep('auth'); }}>Passer</button>
        </div>

        <div className="ob-content">
          <div className="ob-icon-pill" key={`icon${slide}`}>
            <SlideIcon name={SLIDES[slide].icon} />
          </div>
          <div className="ob-mini-badge" key={`b${slide}`}>
            <span className="ob-mini-badge-dot" />
            <span>{SLIDES[slide].badge}</span>
          </div>
          <h1 className="ob-title" key={`t${slide}`}>{SLIDES[slide].title}</h1>
          <p className="ob-desc" key={`d${slide}`}>{SLIDES[slide].desc}</p>
        </div>

        <div className="ob-bottom">
          <div className="ob-dots">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                aria-label={`Slide ${i + 1}`}
                className={`ob-dot ${i === slide ? 'active' : ''}`}
                onClick={() => { haptic('light'); setSlide(i); }}
              />
            ))}
          </div>
          <button className="ob-next-btn" onClick={handleNext}>
            <span>{slide < SLIDES.length - 1 ? 'Suivant' : 'Commencer'}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════ STEP : AUTH ═══════════════
  if (step === 'auth') {
    return (
      <div className="ob-auth-screen page-anim">
        {/* En-tête vert avec logo */}
        <div className="ob-auth-top">
          <div className="ob-logo-circle">Y</div>
          <h2 className="ob-auth-title">
            {authView === 'signup' ? 'Crée ton compte' : 'Connecte-toi'}
          </h2>
          <p className="ob-auth-desc">
            {authView === 'signup'
              ? 'En 30 secondes, et tu profites de YARAM 💚'
              : authView === 'login'
                ? 'Retrouve ta routine et tes commandes'
                : 'Choisis comment tu veux te connecter'}
          </p>
        </div>

        <div className="ob-auth-bottom">
          {error && (
            <div className="ob-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* ═══ VUE CHOICE : Apple/Google/Email/Login ═══ */}
          {authView === 'choice' && (
            <>
              {/* ─── Face ID si dispo ─── */}
              {bioEnabledEmail && (
                <button
                  onClick={handleFaceIdLogin}
                  disabled={bioLoading}
                  className="ob-btn-bio ripple"
                >
                  {bioLoading ? (
                    <span>Authentification…</span>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {bioType === 'touchId' ? (
                          <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                        ) : (
                          <path d="M9 11h.01M15 11h.01M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M8 17v2a2 2 0 002 2h4a2 2 0 002-2v-2M3 7h2M3 17h2M19 7h2M19 17h2M9 14s1 2 3 2 3-2 3-2" />
                        )}
                      </svg>
                      <span>Continuer avec {bioType === 'touchId' ? 'Touch ID' : 'Face ID'}</span>
                    </>
                  )}
                </button>
              )}

              {/* ═══ Apple (REQUIS App Store Guideline 4.8) ═══ */}
              {shouldShowAppleButton() && (
                <button
                  onClick={handleApple}
                  disabled={appleLoading}
                  aria-label="Continuer avec Apple"
                  className="ob-btn-apple ripple"
                >
                  {appleLoading ? (
                    <span>Connexion…</span>
                  ) : (
                    <>
                      <svg viewBox="0 0 384 512" width="18" height="20" fill="#FFFFFF" aria-hidden="true">
                        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
                      </svg>
                      <span>Continuer avec Apple</span>
                    </>
                  )}
                </button>
              )}

              {/* Google (caché sur natif iOS/Android) */}
              {!isNativeApp() && (
                <button
                  onClick={handleGoogle}
                  disabled={googleLoading}
                  className="ob-btn-google ripple"
                >
                  {googleLoading ? (
                    <span>Connexion…</span>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      <span>Continuer avec Google</span>
                    </>
                  )}
                </button>
              )}

              <div className="auth-divider"><span>ou avec email</span></div>

              {/* CTA principal : SE CONNECTER (l'utilisatrice est plus souvent une qui revient
                  qu'une nouvelle inscription, surtout après la 1ère ouverture). */}
              <button
                onClick={() => { haptic('light'); setAuthView('login'); setError(null); }}
                className="ob-btn-email-primary ripple"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                </svg>
                <span>Se connecter avec email</span>
              </button>

              <p className="ob-have-account">
                Pas encore de compte ?{' '}
                <button onClick={() => { haptic('light'); setAuthView('signup'); setError(null); }} className="ob-link-strong">
                  Créer un compte
                </button>
              </p>

              <p className="ob-cgu-footer">
                En continuant, tu acceptes nos{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer">CGU</a>
                {' '}et notre{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer">Politique de confidentialité</a>.
              </p>
            </>
          )}

          {/* ═══ VUE SIGNUP : formulaire création compte ═══ */}
          {authView === 'signup' && (
            <>
              <button onClick={() => { setAuthView('choice'); setError(null); }} className="ob-back-link">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                </svg>
                <span>Autres options</span>
              </button>

              <h3 className="ob-form-title">Crée ton compte</h3>

              <FloatingField
                id="email"
                label="Adresse email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                state={email ? (emailValid ? 'valid' : 'invalid') : 'idle'}
                autoComplete="email"
                inputMode="email"
                autoFocus
              />

              <FloatingField
                id="password"
                label="Mot de passe"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                state={password ? (passwordValid ? 'valid' : 'invalid') : 'idle'}
                autoComplete="new-password"
                suffix={
                  <button
                    type="button"
                    className="ff-eye"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Cacher' : 'Voir'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                }
              />

              {/* Password strength meter */}
              {password && (
                <div className="pwd-meter">
                  <div className="pwd-bars">
                    {[1, 2, 3, 4].map(n => (
                      <div key={n} className={`pwd-bar ${n <= passwordStrong.score ? `s${passwordStrong.score}` : ''}`} />
                    ))}
                  </div>
                  <span className={`pwd-label s${passwordStrong.score}`}>
                    {passwordStrong.label || 'Trop court'}
                  </span>
                </div>
              )}
              <p className="ob-form-hint">Minimum 8 caractères.</p>

              {/* CGU checkbox */}
              <label className="ob-cgu-check">
                <input type="checkbox" checked={acceptCgu} onChange={e => setAcceptCgu(e.target.checked)} />
                <span className="ob-cgu-box">
                  {acceptCgu && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </span>
                <span className="ob-cgu-text">
                  J'accepte les{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">CGU</a>
                  {' '}et la{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">Politique de confidentialité</a>
                </span>
              </label>

              <button
                className={`ob-btn-submit ripple ${successPulse ? 'success' : ''}`}
                onClick={handleSignUp}
                disabled={!signupCanSubmit}
              >
                {successPulse ? (
                  <span className="ob-submit-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                ) : loading ? (
                  <span className="ob-submit-loading">
                    <span className="ob-spinner" />
                    Création…
                  </span>
                ) : (
                  <>
                    <span>Créer mon compte</span>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </>
                )}
              </button>

              <p className="ob-have-account">
                Déjà un compte ?{' '}
                <button onClick={() => { haptic('light'); setAuthView('login'); setError(null); }} className="ob-link-strong">
                  Se connecter
                </button>
              </p>
            </>
          )}

          {/* ═══ VUE LOGIN ═══ */}
          {authView === 'login' && (
            <>
              <button onClick={() => { setAuthView('choice'); setError(null); }} className="ob-back-link">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                </svg>
                <span>Autres options</span>
              </button>

              <h3 className="ob-form-title">Connecte-toi</h3>

              <FloatingField
                id="login-email"
                label="Adresse email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                state={email ? (emailValid ? 'valid' : 'invalid') : 'idle'}
                autoComplete="email"
                inputMode="email"
                autoFocus
              />

              <FloatingField
                id="login-password"
                label="Mot de passe"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                state="idle"
                autoComplete="current-password"
                onKeyDown={e => e.key === 'Enter' && loginCanSubmit && handleLogin()}
                suffix={
                  <button
                    type="button"
                    className="ff-eye"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Cacher' : 'Voir'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                }
              />

              <div className="ob-forgot-row">
                <button
                  type="button"
                  onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                  className="ob-link-soft"
                >
                  Mot de passe oublié ?
                </button>
              </div>

              <button
                className="ob-btn-submit ripple"
                onClick={handleLogin}
                disabled={!loginCanSubmit}
              >
                {loading ? (
                  <span className="ob-submit-loading">
                    <span className="ob-spinner" />
                    Connexion…
                  </span>
                ) : (
                  <>
                    <span>Se connecter</span>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </>
                )}
              </button>

              <p className="ob-have-account">
                Pas encore de compte ?{' '}
                <button onClick={() => { haptic('light'); setAuthView('signup'); setError(null); }} className="ob-link-strong">
                  Créer un compte
                </button>
              </p>
            </>
          )}
        </div>

        {/* ─── Popup activation Face ID ─── */}
        {askEnableBio && (
          <div className="ob-modal-overlay">
            <div className="ob-modal ob-modal-bio">
              <div className="ob-modal-bio-icon">
                {bioType === 'touchId' ? '👆' : '🤳'}
              </div>
              <h2 className="ob-modal-title">
                Activer {bioType === 'touchId' ? 'Touch ID' : 'Face ID'} ?
              </h2>
              <p className="ob-modal-desc">
                Connecte-toi rapidement à YARAM la prochaine fois sans retaper ton mot de passe.
              </p>
              <button onClick={handleEnableBio} disabled={bioLoading} className="ob-btn-submit ripple" style={{ marginBottom: 10 }}>
                {bioLoading ? 'Activation…' : `Activer ${bioType === 'touchId' ? 'Touch ID' : 'Face ID'}`}
              </button>
              <button onClick={handleSkipBio} disabled={bioLoading} className="ob-btn-ghost">
                Plus tard
              </button>
              <p className="ob-modal-foot">Tu peux modifier ce choix à tout moment dans les paramètres.</p>
            </div>
          </div>
        )}

        {/* ─── Modal Forgot Password ─── */}
        {forgotOpen && (
          <div className="ob-modal-overlay">
            <div className="ob-modal">
              <div className="ob-modal-head">
                <span className="ob-modal-emoji">🔑</span>
                <h2 className="ob-modal-title-sm">Mot de passe oublié</h2>
              </div>
              <p className="ob-modal-desc">
                Entre ton email. Tu recevras un lien pour créer un nouveau mot de passe.
              </p>

              <FloatingField
                id="forgot-email"
                label="Adresse email"
                type="email"
                value={forgotEmail}
                onChange={e => { setForgotEmail(e.target.value); setForgotMsg({ text: '', kind: '' }); }}
                state={forgotEmail ? (EMAIL_RE.test(forgotEmail.trim()) ? 'valid' : 'invalid') : 'idle'}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleForgotSubmit()}
              />

              {forgotMsg.text && (
                <div className={`ob-modal-msg ${forgotMsg.kind === 'err' ? 'err' : 'ok'}`}>
                  {forgotMsg.text}
                </div>
              )}

              <button onClick={handleForgotSubmit} disabled={forgotLoading} className="ob-btn-submit ripple" style={{ marginBottom: 8 }}>
                {forgotLoading ? 'Envoi…' : 'Envoyer le lien'}
              </button>
              <button
                onClick={() => { setForgotOpen(false); setForgotEmail(''); setForgotMsg({ text: '', kind: '' }); }}
                className="ob-btn-ghost"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════ STEP : PROFILE COMPLETION ═══════════════
  if (step === 'profile') {
    return (
      <div className="ob-profile-screen page-anim">
        <div className="ob-profile-top">
          <div className="ob-profile-progress">
            <span className="ob-progress-pill done">1</span>
            <span className="ob-progress-line done" />
            <span className="ob-progress-pill active">2</span>
            <span className="ob-progress-line" />
            <span className="ob-progress-pill">3</span>
          </div>
          <h2 className="ob-auth-title">Quelques infos pour finir</h2>
          <p className="ob-auth-desc">Aide-nous à personnaliser ton expérience YARAM.</p>
        </div>

        <div className="ob-auth-bottom">
          <p className="ob-form-hint" style={{ marginBottom: 14 }}>
            Tu peux remplir ces infos plus tard depuis ton profil.
          </p>

          <FloatingField
            id="profile-firstname"
            label="Prénom"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            state={firstName ? (firstNameValid ? 'valid' : 'invalid') : 'idle'}
            autoComplete="given-name"
            autoFocus
          />

          {/* Téléphone avec préfixe +221 */}
          <div className={`ff-wrap ${phone ? 'valid' : 'idle'}`}>
            <div className="ff-phone-row">
              <span className="ff-phone-prefix">+221</span>
              <input
                id="profile-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/[^0-9 ]/g, ''))}
                className="ff-input ff-input-phone"
                placeholder="77 123 45 67"
              />
            </div>
            <label className="ff-label lifted">WhatsApp (optionnel)</label>
            <div className="ff-hint">Pour les notifs livraison et offres.</div>
          </div>

          {/* Ville dropdown */}
          <div className={`ff-wrap ${city ? 'valid' : 'idle'}`}>
            <select
              id="profile-city"
              value={city}
              onChange={e => setCity(e.target.value)}
              className="ff-input ff-select"
            >
              <option value="">Choisis ta ville</option>
              {SENEGAL_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="ff-label lifted">Ville</label>
            <div className="ff-state-icon ff-chev">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>

          <button onClick={handleSaveProfile} disabled={loading} className="ob-btn-submit ripple">
            {loading ? (
              <span className="ob-submit-loading"><span className="ob-spinner" />Enregistrement…</span>
            ) : (
              <>
                <span>Terminer</span>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </>
            )}
          </button>

          <button onClick={handleSkipProfile} className="ob-btn-ghost" style={{ marginTop: 10 }}>
            Plus tard
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════ STEP : DONE ═══════════════
  if (step === 'done') {
    return (
      <div className="ob-done-screen page-anim">
        <div className="done-confetti">
          {[...Array(12)].map((_, i) => (
            <span key={i} className={`done-confetti-${i % 4}`} style={{ animationDelay: `${i * 0.06}s` }} />
          ))}
        </div>
        <div className="done-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 className="done-title">Bienvenue{firstName ? ` ${firstName}` : ''} !</h2>
        <p className="done-desc">
          Vérifie ton email pour confirmer ton inscription. Tu peux ensuite te connecter.
          {phone.trim() && <><br/><br/>Tu vas aussi recevoir un WhatsApp de bienvenue.</>}
        </p>
        <button
          onClick={() => { haptic('light'); setAuthView('login'); setStep('auth'); setPassword(''); }}
          className="done-cta ripple"
        >
          <span>Se connecter maintenant</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
    );
  }

  return null;
}
