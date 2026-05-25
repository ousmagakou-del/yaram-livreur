import { useState, useEffect } from 'react';
import { signUp, signIn, signInWithGoogle, supabase } from '../lib/supabase';
import { notifyWelcome } from '../lib/notifications';
import { sendEmail } from '../lib/emails';
import { isIOSApp } from '../lib/platform';
import { isBiometricAvailable, isBiometricEnabled, loginWithBiometric, enableBiometric } from '../lib/biometric';
import { toast } from '../lib/toast';
import './Onboarding.css';

// ─── URLs des photos onboarding (Supabase Storage) ───
const PHOTO_WOMAN   = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/onboarding/onboarding-woman.jpg';
const PHOTO_MAN     = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/onboarding/onboarding-man.jpg';
const PHOTO_LIVREUR = 'https://qxhhnrnworwrnwmqekmb.supabase.co/storage/v1/object/public/banner-images/onboarding/onboarding-livreur.jpg';

const SLIDES = [
  {
    img: PHOTO_WOMAN,
    badge: 'Beauté validée',
    title: 'Une peau qui te ressemble',
    desc: 'YARAM analyse chaque produit pour ta peau africaine. Plus de mauvaises surprises, que des routines qui marchent.',
  },
  {
    img: PHOTO_MAN,
    badge: 'Pour elles & pour eux',
    title: 'Scanne, score, achète',
    desc: 'Score sur 100, INCI décodé, avis filtrés par profil similaire. Tout pour choisir avec confiance.',
  },
  {
    img: PHOTO_LIVREUR,
    badge: 'Livré chez toi',
    title: 'À Dakar en 24h',
    desc: 'Wave, Orange Money, cash à la livraison. 24h Dakar, 48h Thiès & Mbour. Toujours simple.',
  },
];

export default function Onboarding({ onComplete }) {
  const [slide, setSlide] = useState(0);
  const [step, setStep] = useState('intro');
  const [mode, setMode] = useState('signup');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState(null);

  // ─── Modal mot de passe oublie ───
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState({ text: '', kind: '' });

  // ─── Face ID / Touch ID (Option B : reconnexion rapide) ───
  // - bioAvailable : Face ID/Touch ID dispo sur cet iPhone
  // - bioType : 'faceId' | 'touchId' | 'unknown'
  // - bioEnabledForUser : un user a déjà activé Face ID sur cet appareil
  //   → on affiche le gros bouton "Face ID" sur l'écran login
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioType, setBioType] = useState(null);
  const [bioEnabledEmail, setBioEnabledEmail] = useState(null);
  const [bioLoading, setBioLoading] = useState(false);
  // Popup post-login : "Tu veux activer Face ID pour la prochaine fois ?"
  const [askEnableBio, setAskEnableBio] = useState(false);
  const [enabledUserEmail, setEnabledUserEmail] = useState(null);

  // Check Face ID dispo au mount (sur iOS uniquement)
  useEffect(() => {
    (async () => {
      const { available, type } = await isBiometricAvailable();
      if (available) {
        setBioAvailable(true);
        setBioType(type);
        // Y a-t-il déjà un user qui a activé Face ID sur cet appareil ?
        const { enabled, email: storedEmail } = await isBiometricEnabled();
        if (enabled) setBioEnabledEmail(storedEmail || 'utilisateur');
      }
    })();
  }, []);

  // Handler : "Se connecter avec Face ID"
  const handleFaceIdLogin = async () => {
    setBioLoading(true);
    setError(null);
    try {
      const result = await loginWithBiometric();
      if (!result.ok) {
        if (result.error === 'cancelled') {
          // user a annulé, pas une vraie erreur
          setBioLoading(false);
          return;
        }
        if (result.error === 'session_expired_relogin_required') {
          setError('Ta session Face ID a expiré. Reconnecte-toi avec ton mot de passe.');
          setBioEnabledEmail(null); // cache le bouton Face ID
        } else {
          setError('Connexion Face ID échouée. Utilise ton mot de passe.');
        }
        setBioLoading(false);
        return;
      }
      // SUCCESS : Supabase a une session restaurée → App.jsx va detect onAuthStateChange
      // et passer au state user (fermeture auto de Onboarding)
      if (onComplete) onComplete(result.user);
    } catch (e) {
      setError(e?.message || 'Erreur Face ID');
      setBioLoading(false);
    }
  };

  // Handler : "Activer Face ID" (popup post-login)
  const handleEnableBio = async () => {
    setBioLoading(true);
    const result = await enableBiometric(enabledUserEmail);
    setBioLoading(false);
    if (result.ok) {
      toast.success('✅ Face ID activé !');
    } else if (result.error !== 'cancelled') {
      toast.error('Activation Face ID échouée : ' + (result.error || ''));
    }
    setAskEnableBio(false);
    // Continue le flow normal d'onboarding (skin quiz ou home)
    if (onComplete) onComplete();
  };

  const handleSkipBio = () => {
    setAskEnableBio(false);
    if (onComplete) onComplete();
  };

  const handleNext = () => {
    if (slide < SLIDES.length - 1) setSlide(slide + 1);
    else setStep('auth');
  };

  // Mapper les codes d'erreur Supabase Auth en messages user-friendly FR
  const friendlyAuthError = (err) => {
    const m = (err?.message || '').toLowerCase();
    if (m.includes('user already registered')) return 'Cet email a déjà un compte. Connecte-toi.';
    if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.';
    if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) return 'Trop de tentatives. Réessaie dans quelques minutes.';
    if (m.includes('email not confirmed')) return 'Vérifie ton email pour confirmer ton compte avant de te connecter.';
    if (m.includes('invalid email') || m.includes('email_address_invalid')) return 'Email invalide.';
    if (m.includes('password should be at least')) return 'Mot de passe trop court (6+ caractères).';
    if (m.includes('network') || m.includes('fetch')) return 'Pas de connexion. Vérifie ton réseau.';
    return err?.message || 'Erreur inattendue. Réessaie.';
  };

  const handleSignUp = async () => {
    setError(null);
    if (!firstName.trim() || !email.trim() || !password.trim()) {
      setError('Tous les champs sont requis');
      return;
    }
    if (password.length < 6) {
      setError('Mot de passe trop court (6+ caractères)');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await signUp(email, password, firstName);
      if (error) throw error;
      if (data.user) {
        // ─── IMPORTANT : sauvegarder phone + first_name dans users_profile ───
        // Avant : ces 2 valeurs etaient saisies par la cliente mais JAMAIS persistees.
        // Resultat : aucune notif WhatsApp ne marchait (welcome, panier abandonne,
        // livreur, etc.) car users_profile.phone restait null. Bug fatal.
        // upsert pour creer la row si le trigger DB ne l'a pas faite, ou la mettre a jour si oui.
        try {
          await supabase.from('users_profile').upsert({
            id: data.user.id,
            email: email.trim(),
            first_name: firstName.trim(),
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
        // Welcome email (non-bloquant). Si Resend n'est pas configure cote serveur,
        // l'edge function renvoie un fail silencieux.
        if (email.trim()) {
          sendEmail({
            to: email.trim(),
            template: 'welcome',
            params: { firstName: firstName.trim() },
          }).catch(e => console.warn('welcome email failed:', e.message));
        }
        // Propose Face ID si dispo sur l'appareil
        if (bioAvailable) {
          setEnabledUserEmail(email.trim());
          setAskEnableBio(true);
          // Pas de setStep('done') — le popup gérera la suite
        } else {
          setStep('done');
        }
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Email et mot de passe requis');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await signIn(email, password);
      if (error) throw error;
      if (data.user) {
        // Si Face ID dispo et pas encore activé pour cet user → propose activation
        if (bioAvailable && bioEnabledEmail !== email.trim()) {
          setEnabledUserEmail(email.trim());
          setAskEnableBio(true);
          setLoading(false);
          return; // popup gérera onComplete()
        }
        if (onComplete) await onComplete();
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
    } catch (err) {
      console.error('Google auth error:', err);
      setError('Erreur connexion Google : ' + (err.message || 'Réessaie'));
      setGoogleLoading(false);
    }
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
        text: '✓ Email envoyé ! Vérifie ta boîte (et les spams). Clique sur le lien pour créer un nouveau mot de passe.', 
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

  // ═══════════════ SLIDE INTRO ═══════════════
  if (step === 'intro') {
    const sl = SLIDES[slide];
    return (
      <div className="ob-screen">
        <div className="ob-hero-img" style={{ backgroundImage: `url(${sl.img})` }} key={slide} />
        
        <div className="ob-skip-bar">
          <button className="ob-skip" onClick={() => setStep('auth')}>Passer</button>
        </div>

        <div className="ob-content">
          <div className="ob-mini-badge" key={`b${slide}`}>
            <span className="ob-mini-badge-dot" />
            <span>{sl.badge}</span>
          </div>
          <h1 className="ob-title" key={`t${slide}`}>{sl.title}</h1>
          <p className="ob-desc" key={`d${slide}`}>{sl.desc}</p>
        </div>

        <div className="ob-bottom">
          <div className="ob-dots">
            {SLIDES.map((_, i) => <div key={i} className={`ob-dot ${i === slide ? 'active' : ''}`} />)}
          </div>
          <button className="ob-next-btn" onClick={handleNext}>
            {slide < SLIDES.length - 1 ? 'Suivant →' : 'Commencer →'}
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════ AUTH ═══════════════
  if (step === 'auth') {
    return (
      <div className="ob-auth-screen page-anim">
        <div className="ob-auth-top">
          <div className="ob-logo-circle">Y</div>
          <h2 className="ob-auth-title">
            {mode === 'signup' ? 'Bienvenue sur YARAM' : 'Re-bonjour'}
          </h2>
          <p className="ob-auth-desc">
            {mode === 'signup' ? 'Crée ton compte pour des recommandations personnalisées' : 'Connecte-toi pour continuer'}
          </p>
        </div>
        <div className="ob-auth-bottom">
          {error && <div className="ob-error">⚠️ {error}</div>}

          {/* ─── Face ID / Touch ID : seulement si un user a déjà activé sur cet appareil ─── */}
          {bioEnabledEmail && mode === 'login' && (
            <button
              onClick={handleFaceIdLogin}
              disabled={bioLoading}
              style={{
                width: '100%',
                padding: 14,
                background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
                color: 'white',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                cursor: bioLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                fontFamily: 'inherit',
                marginBottom: 12,
                boxShadow: '0 4px 14px rgba(31, 139, 76, 0.3)',
              }}
            >
              {bioLoading ? (
                <span>⏳ Authentification…</span>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {bioType === 'touchId' ? (
                      // Empreinte digitale
                      <>
                        <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                      </>
                    ) : (
                      // Face ID (carré avec yeux)
                      <>
                        <path d="M9 11h.01M15 11h.01M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M8 17v2a2 2 0 002 2h4a2 2 0 002-2v-2M3 7h2M3 17h2M19 7h2M19 17h2M9 14s1 2 3 2 3-2 3-2" />
                      </>
                    )}
                  </svg>
                  <span>Continuer avec {bioType === 'touchId' ? 'Touch ID' : 'Face ID'}</span>
                </>
              )}
            </button>
          )}

          {/* ─── Google Sign-In : masqué sur iOS ─── */}
          {/* Apple Guideline 4.8 : si on garde Google, on DOIT aussi proposer Sign in
              with Apple. Pour rester simple (et passer le review), on masque Google
              uniquement sur iOS. Sur web et Android, rien ne change.
              TODO : ajouter Sign in with Apple en v1.0.1 pour réactiver Google sur iOS. */}
          {!isIOSApp() && (
            <>
              <button
                onClick={handleGoogle}
                disabled={googleLoading}
                style={{
                  width: '100%',
                  padding: 14,
                  background: 'white',
                  color: '#1A1A1A',
                  border: '1.5px solid #DDD',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: googleLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  fontFamily: 'inherit',
                  marginBottom: 16,
                }}
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

              <div className="auth-divider"><span>ou par email</span></div>
            </>
          )}

          {mode === 'signup' && (
            <div className="phone-input-wrap">
              <span className="phone-input-label">Prénom</span>
              <input className="phone-input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Aïcha" />
            </div>
          )}

          {mode === 'signup' && (
            <div className="phone-input-wrap">
              <span className="phone-input-label">📱 WhatsApp (recevoir tes notifs)</span>
              <input className="phone-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+221 77 123 45 67" />
            </div>
          )}
          
          <div className="phone-input-wrap">
            <span className="phone-input-label">Email</span>
            <input className="phone-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ton@email.com" />
          </div>
          
          <div className="phone-input-wrap" style={{ position: 'relative' }}>
            <span className="phone-input-label">Mot de passe (6+ caractères)</span>
            <input 
              className="phone-input" 
              type={showPassword ? 'text' : 'password'} 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="••••••"
              style={{ paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 12,
                bottom: 10,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: '#9B9B9B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label={showPassword ? 'Cacher mot de passe' : 'Voir mot de passe'}
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
          </div>

          {/* ─── Lien "Mot de passe oublie ?" en mode LOGIN seulement ─── */}
          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginTop: 4, marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => { setForgotEmail(email); setForgotOpen(true); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#1F8B4C',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 4,
                  fontFamily: 'inherit',
                  textDecoration: 'underline',
                }}
              >
                Mot de passe oublié ?
              </button>
            </div>
          )}

          <button
            className="btn-primary"
            onClick={mode === 'signup' ? handleSignUp : handleLogin}
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? 'En cours...' : (mode === 'signup' ? 'Créer mon compte →' : 'Se connecter →')}
          </button>

          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: '#6B6B6B' }}>
            {mode === 'signup' ? 'Déjà inscrite ?' : 'Pas de compte ?'}{' '}
            <button
              onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
              style={{ color: '#1F8B4C', fontWeight: 600, textDecoration: 'underline', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {mode === 'signup' ? 'Se connecter' : 'Créer un compte'}
            </button>
          </p>
        </div>

        {/* ─── Popup activation Face ID (après login/signup réussi) ─── */}
        {askEnableBio && (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
            animation: 'ob-fade 0.2s ease-out',
          }}>
            <div style={{
              background: 'white',
              borderRadius: 18,
              padding: 28,
              maxWidth: 360,
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 56, marginBottom: 14 }}>
                {bioType === 'touchId' ? '👆' : '🤳'}
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 10px', color: '#1A1A1A' }}>
                Activer {bioType === 'touchId' ? 'Touch ID' : 'Face ID'} ?
              </h2>
              <p style={{ fontSize: 14, color: '#6B6B6B', marginBottom: 22, lineHeight: 1.5 }}>
                Connecte-toi rapidement à YARAM la prochaine fois sans retaper ton mot de passe.
              </p>

              <button
                onClick={handleEnableBio}
                disabled={bioLoading}
                style={{
                  width: '100%',
                  padding: 14,
                  background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: bioLoading ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: 10,
                }}
              >
                {bioLoading ? '⏳ Activation...' : `Activer ${bioType === 'touchId' ? 'Touch ID' : 'Face ID'}`}
              </button>

              <button
                onClick={handleSkipBio}
                disabled={bioLoading}
                style={{
                  width: '100%',
                  padding: 12,
                  background: 'transparent',
                  color: '#6B6B6B',
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Plus tard
              </button>

              <p style={{ fontSize: 11, color: '#999', marginTop: 14 }}>
                Tu peux modifier ce choix à tout moment dans les paramètres.
              </p>
            </div>
          </div>
        )}

        {/* ─── Modal Forgot Password ─── */}
        {forgotOpen && (
          <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
            animation: 'ob-fade 0.2s ease-out',
          }}>
            <div style={{
              background: 'white',
              borderRadius: 16,
              padding: 24,
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 24 }}>🔑</span>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Mot de passe oublié</h2>
              </div>
              <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 16 }}>
                Entre ton email. Tu recevras un lien pour créer un nouveau mot de passe.
              </p>

              <div className="phone-input-wrap" style={{ marginBottom: 12 }}>
                <span className="phone-input-label">Email</span>
                <input
                  className="phone-input"
                  type="email"
                  value={forgotEmail}
                  onChange={e => { setForgotEmail(e.target.value); setForgotMsg({ text: '', kind: '' }); }}
                  placeholder="ton@email.com"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleForgotSubmit()}
                />
              </div>

              {forgotMsg.text && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 12,
                  background: forgotMsg.kind === 'err' ? '#FCE9E7' : '#E8F5EC',
                  color: forgotMsg.kind === 'err' ? '#D9342B' : '#1F8B4C',
                  lineHeight: 1.5,
                }}>
                  {forgotMsg.text}
                </div>
              )}

              <button
                onClick={handleForgotSubmit}
                disabled={forgotLoading}
                style={{
                  width: '100%',
                  padding: 14,
                  background: forgotLoading ? '#DDD' : '#1F8B4C',
                  color: 'white',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: forgotLoading ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  marginBottom: 8,
                }}
              >
                {forgotLoading ? 'Envoi...' : 'Envoyer le lien →'}
              </button>
              <button
                onClick={() => { setForgotOpen(false); setForgotEmail(''); setForgotMsg({ text: '', kind: '' }); }}
                style={{
                  width: '100%',
                  padding: 10,
                  background: 'transparent',
                  color: '#6B6B6B',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════ DONE ═══════════════
  if (step === 'done') {
    return (
      <div className="ob-done-screen page-anim">
        <div className="done-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 className="done-title">Bienvenue {firstName} !</h2>
        <p className="done-desc">
          Vérifie ton email pour confirmer ton inscription. Tu peux ensuite te connecter.
          {phone.trim() && <><br/><br/>📱 Tu vas aussi recevoir un WhatsApp de bienvenue !</>}
        </p>
        <button
          onClick={() => { setMode('login'); setStep('auth'); setPassword(''); }}
          style={{ marginTop: 32, padding: '16px 32px', background: 'white', color: '#166635', borderRadius: 14, fontSize: 15, fontWeight: 700, width: '100%', maxWidth: 280, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Se connecter maintenant →
        </button>
      </div>
    );
  }

  return null;
}
