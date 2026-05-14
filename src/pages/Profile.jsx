import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { supabase, signOut } from '../lib/supabase';
import { toggleTheme, getTheme } from '../lib/theme';
import TabBar from '../components/TabBar';
import './Profile.css';

export default function Profile() {
  const { navigate } = useNav();
  const { user, refreshUser } = useUser();

  // Stats dynamiques chargées depuis Supabase
  const [stats, setStats] = useState({
    skinScore: null,        // ex: 70 (depuis skin_scans.diagnosis.skin_score)
    concernsCount: null,    // ex: 3 (depuis skin_scans.diagnosis.concerns.length)
    favoritesCount: null,   // count favoris du user
    lastScan: null,         // le dernier scan complet pour le skin_type/phototype
    loading: true,
  });

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      // 1. Dernier scan IA
      const { data: scans } = await supabase
        .from('skin_scans')
        .select('id, skin_type, skin_score, diagnosis, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const lastScan = scans && scans[0] ? scans[0] : null;
      const diag = lastScan?.diagnosis || {};
      const skinScore = lastScan?.skin_score ?? diag.skin_score ?? null;
      const concernsCount = Array.isArray(diag.concerns) ? diag.concerns.length : null;

      // 2. Count favoris (head: true → renvoie juste le count sans data)
      const { count: favCount } = await supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (cancelled) return;
      setStats({
        skinScore,
        concernsCount,
        favoritesCount: favCount ?? 0,
        lastScan,
        loading: false,
      });
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const handleLogout = async () => {
    if (confirm('Te déconnecter ?')) {
      await signOut();
      await refreshUser();
    }
  };

  const handleShare = () => {
    const code = 'AICHA-YARAM';
    const msg = `Salut ! J'utilise YARAM, l'app beauté validée pour notre peau africaine. Avec mon code ${code} tu as 3000 FCFA offerts sur ta 1ère commande 💚 https://yaram.pages.dev`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const firstName = user?.first_name || 'Toi';
  const avatar = user?.avatar || ('https://ui-avatars.com/api/?background=fff&color=1F8B4C&bold=true&size=200&name=' + encodeURIComponent(firstName));
  const city = user?.city || 'Dakar';
  const neighborhood = user?.neighborhood;

  // skin_type / phototype : priorité au dernier scan, fallback user
  const skinType = stats.lastScan?.skin_type || stats.lastScan?.diagnosis?.skin_type || user?.skin_type || null;
  const phototype = user?.skin_phototype || stats.lastScan?.diagnosis?.phototype || null;
  const loyaltyPoints = user?.loyalty_points || 0;

  const hasScan = !!stats.lastScan;

  // Couleur du score selon la valeur
  const scoreColor = (s) => {
    if (s == null) return 'var(--text-muted, #9B9B9B)';
    if (s >= 75) return 'var(--excellent, #1F8B4C)';
    if (s >= 50) return 'var(--medium, #F4B53A)';
    return 'var(--bad, #D9342B)';
  };

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
            {(skinType || phototype) && (
              <div className="prof-skin-badge">
                ✨ {skinType ? skinType.charAt(0).toUpperCase() + skinType.slice(1) : 'Peau'}
                {phototype ? ` · Phototype ${phototype}` : ''}
              </div>
            )}
            {!skinType && !phototype && !stats.loading && (
              <div className="prof-skin-badge">✨ Fais ton 1er scan</div>
            )}
          </div>
        </div>

        {/* Stats dynamiques */}
        <div className="prof-stats">
          <div className="prof-stat">
            <div className="prof-stat-num" style={{ color: scoreColor(stats.skinScore) }}>
              {stats.loading ? '…' : (stats.skinScore != null ? stats.skinScore : '—')}
            </div>
            <div className="prof-stat-lbl">Score peau</div>
          </div>
          <div className="prof-stat-sep" />
          <div className="prof-stat">
            <div className="prof-stat-num" style={{
              color: stats.concernsCount > 0 ? 'var(--bad, #D9342B)' : 'var(--excellent, #1F8B4C)'
            }}>
              {stats.loading ? '…' : (stats.concernsCount != null ? stats.concernsCount : '—')}
            </div>
            <div className="prof-stat-lbl">À surveiller</div>
          </div>
          <div className="prof-stat-sep" />
          <div className="prof-stat">
            <div className="prof-stat-num" style={{ color: 'var(--medium, #F4B53A)' }}>
              {stats.loading ? '…' : stats.favoritesCount}
            </div>
            <div className="prof-stat-lbl">Favoris</div>
          </div>
        </div>

        {/* CTA Mettre à jour diagnostic */}
        <button className="prof-update-cta" onClick={() => navigate({ name: 'scan', params: {} })}>
          <span className="prof-update-icon">📷</span>
          <div className="prof-update-text">
            <strong>{hasScan ? 'Mettre à jour mon diagnostic' : 'Faire mon 1er scan peau'}</strong>
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
              <span>{stats.favoritesCount > 0 ? `${stats.favoritesCount} produit${stats.favoritesCount > 1 ? 's' : ''}` : 'Tes coups de cœur'}</span>
            </div>
            <span className="prof-menu-arrow">→</span>
          </button>

          <div className="prof-menu-sep" />

          <button className="prof-menu-row" onClick={() => navigate({ name: 'scan', params: {} })}>
            <div className="prof-menu-icon">✨</div>
            <div className="prof-menu-text">
              <strong>Mon diagnostic peau</strong>
              <span>{hasScan ? `Dernier scan : ${new Date(stats.lastScan.created_at).toLocaleDateString('fr-FR')}` : 'Refaire le scan'}</span>
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
          
          <button className="prof-menu-row" onClick={() => navigate({ name: 'notifications', params: {} })}>
            <div className="prof-menu-icon">🔔</div>
            <div className="prof-menu-text">
              <strong>Notifications</strong>
              <span>Rappels routine peau · Commandes</span>
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
          YARAM v0.1 · Beauté Sénégal 🇸🇳
        </div>

        <div style={{ height: 30 }} />
      </div>
      <TabBar active="profile" />
    </div>
  );
}