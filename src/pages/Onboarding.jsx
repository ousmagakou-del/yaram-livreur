import { useState } from 'react';
import { signUp, signIn, signInWithGoogle } from '../lib/supabase';
import { notifyWelcome } from '../lib/notifications';
import './Onboarding.css';

const SLIDES = [
  { icon: '✨', title: 'Beauté validée pour ta peau', desc: 'YARAM analyse chaque produit et te dit s\'il est fait pour toi. Plus de mauvaises surprises.' },
  { icon: '📱', title: 'Scanne, score, achète', desc: 'Score sur 100, INCI décodé, avis filtrés par profil similaire. Livré chez toi.' },
  { icon: '🇸🇳', title: 'Livré chez toi à Dakar', desc: 'Wave, Orange Money, cash à la livraison. 24h Dakar, 48h Thiès & Mbour.' },
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

  const handleNext = () => {
    if (slide < SLIDES.length - 1) setSlide(slide + 1);
    else setStep('auth');
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
        // ─── Envoi WhatsApp de bienvenue si le user a un phone ───
        // Note : pour que ca marche, il faut que signUp() sauve le phone dans users_profile.
        // Sinon ce sera envoye au prochain login via App.jsx.
        if (phone.trim()) {
          notifyWelcome({
            userId: data.user.id,
            phone: phone.trim(),
            firstName: firstName.trim(),
          }).catch(e => console.warn('welcome WhatsApp failed:', e.message));
        }
        setStep('done');
      }
    } catch (err) {
      setError(err.message);
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
        if (onComplete) await onComplete();
      }
    } catch (err) {
      setError(err.message);
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
      // Pas besoin de redirect manuel, Supabase fait la redirection auto
    } catch (err) {
      console.error('Google auth error:', err);
      setError('Erreur connexion Google : ' + (err.message || 'Réessaie'));
      setGoogleLoading(false);
    }
  };

  if (step === 'intro') {
    const sl = SLIDES[slide];
    return (
      <div className="ob-screen">
        <div className="ob-skip-bar">
          <button className="ob-skip" onClick={() => setStep('auth')}>Passer</button>
        </div>
        <div className="ob-content">
          <div className="ob-icon" key={slide}>{sl.icon}</div>
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

  if (step === 'auth') {
    return (
      <div className="ob-auth-screen page-anim">
        <div className="ob-auth-top">
          <div className="ob-logo-circle">D</div>
          <h2 className="ob-auth-title">
            {mode === 'signup' ? 'Bienvenue sur YARAM' : 'Re-bonjour'}
          </h2>
          <p className="ob-auth-desc">
            {mode === 'signup' ? 'Crée ton compte pour des recommandations personnalisées' : 'Connecte-toi pour continuer'}
          </p>
        </div>
        <div className="ob-auth-bottom">
          {error && <div className="ob-error">⚠️ {error}</div>}

          {/* GOOGLE EN PREMIER */}
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

          {mode === 'signup' && (
            <div className="phone-input-wrap">
              <span className="phone-input-label">Prénom</span>
              <input className="phone-input" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Aïcha" />
            </div>
          )}

          {mode === 'signup' && (
            <div className="phone-input-wrap">
              <span className="phone-input-label">📱 WhatsApp (optionnel — recevoir tes notifs)</span>
              <input className="phone-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+221 77 123 45 67" />
            </div>
          )}
          
          <div className="phone-input-wrap">
            <span className="phone-input-label">Email</span>
            <input className="phone-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ton@email.com" />
          </div>
          
          {/* MOT DE PASSE AVEC TOGGLE ŒIL */}
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

          <button
            className="btn-primary"
            onClick={mode === 'signup' ? handleSignUp : handleLogin}
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? 'En cours...' : (mode === 'signup' ? 'Créer mon compte →' : 'Se connecter →')}
          </button>

          <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: 'var(--ink-soft)' }}>
            {mode === 'signup' ? 'Déjà inscrite ?' : 'Pas de compte ?'}{' '}
            <button
              onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
              style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'underline', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {mode === 'signup' ? 'Se connecter' : 'Créer un compte'}
            </button>
          </p>
        </div>
      </div>
    );
  }

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
          style={{ marginTop: 32, padding: '16px 32px', background: 'white', color: '#166635', borderRadius: 14, fontSize: 15, fontWeight: 700, width: '100%', maxWidth: 280 }}
        >
          Se connecter maintenant →
        </button>
      </div>
    );
  }

  return null;
}
