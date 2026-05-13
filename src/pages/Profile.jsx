import { useNav, useUser } from '../App';
import { signOut } from '../lib/supabase';
import { toggleTheme, getTheme } from '../lib/theme';
import TabBar from '../components/TabBar';
import './Profile.css';

export default function Profile() {
  const { navigate } = useNav();
  const { user, refreshUser } = useUser();

  const handleLogout = async () => {
    if (confirm('Te déconnecter ?')) {
      await signOut();
      await refreshUser();
    }
  };

  const handleShare = () => {
    const code = 'AICHA-DIAARA';
    const msg = `Salut ! J'utilise Diaara, l'app beauté validée pour notre peau africaine. Avec mon code ${code} tu as 3000 FCFA offerts sur ta 1ère commande 💚 https://diaara.pages.dev`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const firstName = user?.first_name || 'Toi';
  const avatar = user?.avatar || ('https://ui-avatars.com/api/?background=fff&color=1F8B4C&bold=true&size=200&name=' + encodeURIComponent(firstName));
  const city = user?.city || 'Dakar';
  const neighborhood = user?.neighborhood;
  const skinType = user?.skin_type || 'Mixte';
  const phototype = user?.skin_phototype || 'VI';
  const loyaltyPoints = user?.loyalty_points || 0;

  return (
    <div className="prof-screen page-anim">
      <div className="prof-scroll">
        {/* Cover verte avec photo en blend */}
        <div className="prof-cover">
          <div className="prof-cover-overlay" />
          <div className="prof-cover-inner">
            <img src={avatar} alt={firstName} className="prof-avatar" />
            <h1 className="prof-name">{firstName}</h1>
            <p className="prof-loc">{neighborhood ? `${neighborhood}, ` : ''}{city} 🇸🇳</p>
            <div className="prof-skin-badge">✨ {skinType} · Phototype {phototype}</div>
          </div>
        </div>

        {/* Stats */}
        <div className="prof-stats">
          <div className="prof-stat">
            <div className="prof-stat-num" style={{color: 'var(--excellent)'}}>87</div>
            <div className="prof-stat-lbl">Compatibles</div>
          </div>
          <div className="prof-stat-sep" />
          <div className="prof-stat">
            <div className="prof-stat-num" style={{color: 'var(--bad)'}}>12</div>
            <div className="prof-stat-lbl">À éviter</div>
          </div>
          <div className="prof-stat-sep" />
          <div className="prof-stat">
            <div className="prof-stat-num" style={{color: 'var(--medium)'}}>6</div>
            <div className="prof-stat-lbl">Favoris</div>
          </div>
        </div>

        {/* CTA Mettre à jour diagnostic */}
        <button className="prof-update-cta" onClick={() => navigate({ name: 'scan', params: {} })}>
          <span className="prof-update-icon">📷</span>
          <div className="prof-update-text">
            <strong>Mettre à jour mon diagnostic</strong>
            <span>Photo + quiz · 2 min · plus précis dans le temps</span>
          </div>
          <span className="prof-update-arrow">→</span>
        </button>

        {/* CTA Mes points fidélité */}
        <button
          className="prof-update-cta"
          onClick={() => navigate({ name: 'loyalty', params: {} })}
          style={{
            background: 'linear-gradient(135deg, #F4B53A 0%, #E8385C 100%)',
            marginTop: 12,
          }}
        >
          <span className="prof-update-icon">💎</span>
          <div className="prof-update-text">
            <strong>Mes points fidélité</strong>
            <span>{loyaltyPoints.toLocaleString('fr-FR')} points · Voir mes récompenses</span>
          </div>
          <span className="prof-update-arrow">→</span>
        </button>

        {/* Menu sections */}
        <div className="prof-menu">
          <button className="prof-menu-row" onClick={() => navigate({ name: 'evolution', params: {} })}>
            <div className="prof-menu-icon">📈</div>
            <div className="prof-menu-text">
              <strong>Mon évolution peau</strong>
              <span>Avant/Après mensuel</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate('/orders')}>
            <div className="prof-menu-icon">📦</div>
            <div className="prof-menu-text">
              <strong>Mes commandes</strong>
              <span>Voir l'historique</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate({ name: 'favorites', params: {} })}>
            <div className="prof-menu-icon">❤️</div>
            <div className="prof-menu-text">
              <strong>Mes favoris</strong>
              <span>Tes coups de cœur</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate({ name: 'scan', params: {} })}>
            <div className="prof-menu-icon">✨</div>
            <div className="prof-menu-text">
              <strong>Mon diagnostic peau</strong>
              <span>Refaire le scan</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate({ name: 'addresses', params: {} })}>
            <div className="prof-menu-icon">📍</div>
            <div className="prof-menu-text">
              <strong>Mes adresses</strong>
              <span>{city}</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate({ name: 'payments', params: {} })}>
            <div className="prof-menu-icon">💳</div>
            <div className="prof-menu-text">
              <strong>Moyens de paiement</strong>
              <span>Wave · OM · Cash · Carte</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => toggleTheme()}>
            <div className="prof-menu-icon">{getTheme() === 'dark' ? '🌙' : '☀️'}</div>
            <div className="prof-menu-text">
              <strong>Apparence</strong>
              <span>Mode {getTheme() === 'dark' ? 'sombre' : 'clair'}</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => alert('Bientôt : Wolof + Anglais')}>
            <div className="prof-menu-icon">🌍</div>
            <div className="prof-menu-text">
              <strong>Langue</strong>
              <span>Français</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate({ name: 'referral', params: {} })}>
            <div className="prof-menu-icon">🎁</div>
            <div className="prof-menu-text">
              <strong>Parrainer une amie</strong>
              <span>+3 000 FCFA offerts</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <a className="prof-menu-row" href="https://wa.me/221785211234" target="_blank" rel="noopener noreferrer" style={{textDecoration: 'none', color: 'inherit'}}>
            <div className="prof-menu-icon">💬</div>
            <div className="prof-menu-text">
              <strong>Aide & contact</strong>
              <span>WhatsApp 78 521 12 34</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </a>
        </div>

        <button className="prof-logout" onClick={handleLogout}>
          Se déconnecter
        </button>

        <div className="prof-footer">
          Diaara v0.1 · Beauté Sénégal 🇸🇳
        </div>

        <div style={{ height: 30 }} />
      </div>
      <TabBar active="profile" />
    </div>
  );
}