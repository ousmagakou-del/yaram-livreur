import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { getOrCreateReferralCode, getReferralStats } from '../lib/supabase';
import './Referral.css';

export default function Referral() {
  const { navigate } = useNav();
  const { user } = useUser();
  const [code, setCode] = useState('');
  const [stats, setStats] = useState({ count: 0, bonusEarned: 0, list: [] });
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.log('Referral: user =', user);
    if (!user || !user.id) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        console.log('Referral: fetching code for', user.id);
        const [c, s] = await Promise.all([
          getOrCreateReferralCode(user.id),
          getReferralStats(user.id),
        ]);
        console.log('Referral: got code', c, 'stats', s);
        setCode(c || 'ERROR');
        setStats(s);
      } catch (e) {
        console.error('Referral error:', e);
      }
      setLoading(false);
    })();
  }, [user]);

  // Si pas connecté
  if (!user) {
    return (
      <div className="rf-screen">
        <header className="rf-header">
          <button className="rf-back" onClick={() => navigate(-1)}>←</button>
          <h1>Parraine tes amies</h1>
        </header>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <p>Tu dois être connectée pour parrainer.</p>
          <button onClick={() => navigate('/')} style={{ marginTop: 20, padding: '12px 24px', background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700 }}>
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rf-screen">
        <header className="rf-header">
          <button className="rf-back" onClick={() => navigate(-1)}>←</button>
          <h1>Parraine tes amies</h1>
        </header>
        <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>
      </div>
    );
  }

  const shareUrl = `https://diaara-brg.pages.dev/?ref=${code}`;
  const shareText = `Salut ! 💚 Je t'invite sur YARAM, la marketplace beauté pour la peau africaine. Utilise mon code ${code} et reçois 500 points (= 2500 FCFA de réduction) à ton inscription ! ${shareUrl}`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'YARAM', text: shareText, url: shareUrl });
      } catch (e) {}
    } else {
      navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rf-screen">
      <header className="rf-header">
        <button className="rf-back" onClick={() => navigate(-1)}>←</button>
        <h1>Parraine tes amies</h1>
      </header>
      <div className="rf-scroll">
        <div className="rf-hero">
          <div style={{ fontSize: 56 }}>🎁</div>
          <h2>Gagne 500 points par amie !</h2>
          <p>Toi <strong>+500 points</strong> · Elle <strong>+500 points</strong></p>
        </div>
        <div className="rf-code-card">
          <p className="rf-code-label">Ton code de parrainage</p>
          <div className="rf-code-box" onClick={handleCopy}>
            <span className="rf-code-text">{code}</span>
            <span className="rf-code-copy">{copied ? '✓ Copié' : '📋 Copier'}</span>
          </div>
        </div>
        <div className="rf-share-buttons">
          <button className="rf-btn rf-btn-wa" onClick={handleWhatsApp}>
            📱 Partager sur WhatsApp
          </button>
          <button className="rf-btn rf-btn-share" onClick={handleShare}>
            🔗 Partager le lien
          </button>
        </div>
        <div className="rf-stats-card">
          <div className="rf-stat">
            <div className="rf-stat-number">{stats.count}</div>
            <div className="rf-stat-label">Amies parrainées</div>
          </div>
          <div className="rf-stat">
            <div className="rf-stat-number">{stats.bonusEarned}</div>
            <div className="rf-stat-label">Points gagnés</div>
          </div>
        </div>
        {stats.list.length > 0 && (
          <div className="rf-list-card">
            <h3>Tes filleules</h3>
            {stats.list.map(f => (
              <div key={f.id} className="rf-list-item">
                <span>{f.first_name}</span>
                <span className="rf-list-bonus">+500 pts</span>
              </div>
            ))}
          </div>
        )}
        <div className="rf-info">
          <h3>Comment ça marche ?</h3>
          <div className="rf-step"><strong>1.</strong> Partage ton code à tes amies</div>
          <div className="rf-step"><strong>2.</strong> Elles s'inscrivent avec ton code</div>
          <div className="rf-step"><strong>3.</strong> Toi +500 pts, elles +500 pts</div>
          <div className="rf-step"><strong>4.</strong> Pas de limite !</div>
        </div>
      </div>
    </div>
  );
}