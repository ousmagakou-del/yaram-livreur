import { useState, useEffect } from 'react';
import { useNav, useUser } from '../App';
import { supabase, signOut, updateProfile } from '../lib/supabase';
import { toggleTheme, getTheme } from '../lib/theme';
import { getWhatsAppNumber, getWhatsAppDisplay, safeFormatDate, safeNumber } from '../lib/utils';
import { isIOSApp } from '../lib/platform';
import { getMyAddresses } from '../lib/supabase';
import { toast, confirmDialog, promptDialog } from '../lib/toast';
import TabBar from '../components/TabBar';
import PullToRefresh from '../components/PullToRefresh';
import './Profile.css';

export default function Profile() {
  const { navigate } = useNav();
  const { user, refreshUser } = useUser();

  // Stats dynamiques chargées depuis Supabase
  const [stats, setStats] = useState({
    skinScore: null,
    concernsCount: null,
    favoritesCount: null,
    ordersCount: null,
    savings: null,
    lastScan: null,
    loading: true,
  });

  // Adresse par défaut (pour afficher la vraie ville de l'user, pas "Dakar" hardcodé)
  const [defaultAddr, setDefaultAddr] = useState(null);
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const list = await getMyAddresses();
        const def = (list || []).find(a => a.is_default) || list?.[0] || null;
        setDefaultAddr(def);
      } catch { /* silent */ }
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      console.log('[Profile] skip loadStats: user not ready');
      return;
    }
    let cancelled = false;

    const loadStats = async () => {
      console.log('[Profile] loadStats start, user.id=', user.id);

      // FIX juin 2026 : purge brute force tout cache 'my_orders_*' (toutes versions LS)
      // Même topic que Orders.jsx : un cache stale persisté pouvait poisoner
      // les compteurs.
      try {
        const toDel = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && /^yaram_cache_v\d+_my_orders_/.test(k)) toDel.push(k);
        }
        toDel.forEach(k => localStorage.removeItem(k));
        if (toDel.length) console.log('[Profile] purged stale orders cache keys:', toDel.length);
      } catch {}

      // FIX : on récupère explicitement la session pour utiliser
      // session.user.id (= auth.uid() côté RLS). user.id du contexte vient
      // de users_profile, normalement identique mais on évite tout drift.
      let authUserId = user.id;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) authUserId = session.user.id;
      } catch { /* silent */ }

      // 1. Dernier scan IA
      const { data: scans } = await supabase
        .from('skin_scans')
        .select('id, skin_type, skin_score, diagnosis, created_at')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(1);

      const lastScan = scans && scans[0] ? scans[0] : null;
      const diag = lastScan?.diagnosis || {};
      const skinScore = lastScan?.skin_score ?? diag.skin_score ?? null;
      const concernsCount = Array.isArray(diag.concerns) ? diag.concerns.length : null;

      // 2. Count favoris
      const { count: favCount } = await supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', authUserId);

      // 3. Count commandes — FIX juin 2026 :
      //  - on log les erreurs RLS/network au lieu de les avaler en silence
      //  - on a un fallback: si count=null (HEAD intercepté par proxy), on
      //    refait un SELECT id pour recompter via le tableau retourné.
      let ordersCount = 0;
      try {
        const { count, error } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', authUserId);
        if (error) {
          console.warn('[Profile] orders count error:', error.message);
        }
        if (typeof count === 'number') {
          ordersCount = count;
        } else {
          // Fallback : un proxy / SW peut bouffer le header Content-Range
          // → count=null. On retombe sur un SELECT id classique.
          console.warn('[Profile] orders count=null, fallback SELECT id');
          const { data: rows, error: e2 } = await supabase
            .from('orders')
            .select('id')
            .eq('user_id', authUserId);
          if (e2) console.warn('[Profile] orders fallback error:', e2.message);
          ordersCount = (rows || []).length;
        }
      } catch (e) {
        console.warn('[Profile] orders count threw:', e?.message);
      }
      console.log('[Profile] ordersCount=', ordersCount, 'favCount=', favCount);

      if (cancelled) return;
      setStats({
        skinScore,
        concernsCount,
        favoritesCount: favCount ?? 0,
        ordersCount,
        savings: null,
        lastScan,
        loading: false,
      });
    };
    loadStats();

    // Auto-refresh sur retour navigation (popstate iOS + nav programmatique)
    const handleRouteBack = (e) => {
      const target = e?.detail?.to?.name;
      if (target && target !== 'profile') return;
      loadStats();
    };
    window.addEventListener('yaram-route-back', handleRouteBack);

    // FIX v7 : refresh aussi au resume app (Capacitor / PWA)
    const handleAppResumed = () => loadStats();
    window.addEventListener('yaram-app-resumed', handleAppResumed);

    return () => {
      cancelled = true;
      window.removeEventListener('yaram-route-back', handleRouteBack);
      window.removeEventListener('yaram-app-resumed', handleAppResumed);
    };
  }, [user?.id]);

  const handleLogout = async () => {
    if (await confirmDialog('Te déconnecter ?', { confirmLabel: 'Déconnexion', danger: true })) {
      await signOut();
      await refreshUser(null);
      navigate({ name: 'home', params: {} });
    }
  };

  const handleShare = () => {
    const code = 'AICHA-YARAM';
    const msg = `Salut ! J'utilise YARAM, l'app beauté validée pour notre peau africaine. Avec mon code ${code} tu as 3000 FCFA offerts sur ta 1ère commande 💚 https://yaram.app`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleEditPhone = async () => {
    const current = user?.phone || '';
    const value = await promptDialog(
      'Numéro WhatsApp pour recevoir tes notifications de commande',
      {
        placeholder: '+221 77 123 45 67',
        initialValue: current,
        confirmLabel: 'Enregistrer',
        validate: (v) => {
          const t = (v || '').trim();
          if (!t) return false;
          const cleaned = t.replace(/[\s.-]/g, '');
          return /^(\+?221)?7\d{8}$/.test(cleaned);
        },
      }
    );
    if (value == null) return;
    const cleaned = value.replace(/[\s.-]/g, '');
    const intl = cleaned.startsWith('+221')
      ? cleaned
      : cleaned.startsWith('221') ? `+${cleaned}` : `+221${cleaned}`;
    try {
      const { error } = await updateProfile({ phone: intl });
      if (error) {
        toast.error('Erreur : ' + (error.message || 'sauvegarde impossible'));
        return;
      }
      toast.success('Numéro enregistré ✓');
      await refreshUser();
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || 'sauvegarde impossible'));
    }
  };

  const handleExportData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast.error('Reconnecte-toi'); return; }
      toast.info('Préparation de ton export…');
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co'}/functions/v1/export-my-data`,
        { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!resp.ok) { toast.error('Erreur export'); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yaram-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Téléchargement lancé ✓');
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || ''));
    }
  };

  const handleEditFirstName = async () => {
    const current = user?.first_name || '';
    const value = await promptDialog(
      'Ton prénom',
      { initialValue: current, confirmLabel: 'Enregistrer' }
    );
    if (value == null) return;
    const t = value.trim();
    if (!t) return;
    try {
      const { error } = await updateProfile({ first_name: t });
      if (error) {
        toast.error('Erreur : ' + (error.message || 'sauvegarde impossible'));
        return;
      }
      toast.success('Prénom enregistré ✓');
      await refreshUser();
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || 'sauvegarde impossible'));
    }
  };

  const firstName = user?.first_name || 'Toi';
  const initial = (firstName.trim().charAt(0) || 'Y').toUpperCase();
  const hasPhoto = !!user?.avatar;
  const avatar = user?.avatar;
  const city = defaultAddr?.city || user?.city || null;
  const neighborhood = defaultAddr?.neighborhood || user?.neighborhood || null;

  const loyaltyPoints = user?.loyalty_points || 0;
  const hasScan = !!stats.lastScan;

  // "Membre depuis" — depuis user.created_at si dispo
  const memberSince = (() => {
    const raw = user?.created_at || user?.createdAt;
    if (!raw) return null;
    try {
      const d = new Date(raw);
      const m = d.toLocaleDateString('fr-FR', { month: 'long' });
      const y = d.getFullYear();
      return `${m.charAt(0).toUpperCase() + m.slice(1)} ${y}`;
    } catch { return null; }
  })();

  // Pull-to-refresh : refetch stats user + adresse + scan
  const handlePullRefresh = async () => {
    try {
      if (user?.id) {
        await refreshUser();
        const { invalidateCache } = await import('../lib/supabase');
        invalidateCache(`my_addresses_${user.id}`);
        const list = await getMyAddresses();
        const def = (list || []).find(a => a.is_default) || list?.[0] || null;
        setDefaultAddr(def);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn('[Profile] pull refresh failed:', e?.message);
    }
  };

  // Helper render — item de menu premium
  const MenuItem = ({ icon, tint, label, sub, onClick, href, danger, trailing }) => {
    const inner = (
      <>
        <div className="prof2-row-icon" style={{ background: tint || 'rgba(31,139,76,0.10)' }}>
          <span aria-hidden>{icon}</span>
        </div>
        <div className="prof2-row-text">
          <strong style={danger ? { color: '#D9342B' } : undefined}>{label}</strong>
          {sub ? <span>{sub}</span> : null}
        </div>
        <div className="prof2-row-trailing">
          {trailing || <span className="prof2-row-arrow" aria-hidden>›</span>}
        </div>
      </>
    );
    if (href) {
      return (
        <a className="prof2-row" href={href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      );
    }
    return (
      <button className="prof2-row" onClick={onClick} type="button">
        {inner}
      </button>
    );
  };

  return (
    <div className="prof2-screen page-anim">
      <div className="prof2-scroll">
        <PullToRefresh onRefresh={handlePullRefresh}>

          {/* HERO — Apple Wallet style, blanc clean */}
          <section className="prof2-hero prof2-anim" style={{ animationDelay: '0ms' }}>
            <div className="prof2-avatar-wrap">
              {hasPhoto ? (
                <img src={avatar} alt={firstName} className="prof2-avatar" />
              ) : (
                <div className="prof2-avatar prof2-avatar-fallback">{initial}</div>
              )}
            </div>
            <h1 className="prof2-name">{firstName}</h1>
            <p className="prof2-sub">
              {user?.phone || user?.email || (city ? city : 'Bienvenue sur YARAM')}
            </p>
            {memberSince && (
              <div className="prof2-badge">
                <span className="prof2-badge-dot" />
                Membre depuis {memberSince}
              </div>
            )}
            {!memberSince && (
              <div className="prof2-badge">
                <span className="prof2-badge-dot" />
                Membre YARAM
              </div>
            )}
          </section>

          {/* STATS — 3 cards scrollables */}
          <section className="prof2-stats-wrap prof2-anim" style={{ animationDelay: '50ms' }}>
            <div className="prof2-stats">
              <div className="prof2-stat-card">
                <div className="prof2-stat-icon prof2-stat-icon-green">📦</div>
                <div className="prof2-stat-num">
                  {stats.loading ? '—' : (stats.ordersCount ?? 0)}
                </div>
                <div className="prof2-stat-lbl">Commandes</div>
              </div>
              <div className="prof2-stat-card">
                <div className="prof2-stat-icon prof2-stat-icon-amber">⭐</div>
                <div className="prof2-stat-num">
                  {loyaltyPoints.toLocaleString('fr-FR')}
                </div>
                <div className="prof2-stat-lbl">Points</div>
              </div>
              <div className="prof2-stat-card">
                <div className="prof2-stat-icon prof2-stat-icon-pink">💰</div>
                <div className="prof2-stat-num">
                  {stats.loading
                    ? '—'
                    : `${((stats.savings ?? loyaltyPoints * 10)).toLocaleString('fr-FR')}`}
                </div>
                <div className="prof2-stat-lbl">FCFA éco.</div>
              </div>
            </div>
          </section>

          {/* CTA Diagnostic — preservé */}
          <section className="prof2-section prof2-anim" style={{ animationDelay: '100ms' }}>
            <button
              className="prof2-cta prof2-cta-primary"
              onClick={() => navigate({ name: 'scan', params: {} })}
              type="button"
            >
              <span className="prof2-cta-icon" aria-hidden>📷</span>
              <div className="prof2-cta-text">
                <strong>{hasScan ? 'Mettre à jour mon diagnostic' : 'Faire mon 1er scan peau'}</strong>
                <span>Photo + quiz · 2 min</span>
              </div>
              <span className="prof2-cta-arrow" aria-hidden>›</span>
            </button>
          </section>


          {/* SECTION : COMPTE */}
          <section className="prof2-section prof2-anim" style={{ animationDelay: '150ms' }}>
            <h2 className="prof2-section-title">Compte</h2>
            <div className="prof2-card">
              <MenuItem
                icon="📍"
                tint="rgba(31,139,76,0.10)"
                label="Mes adresses"
                sub={city ? `${neighborhood ? neighborhood + ', ' : ''}${city}` : 'Ajouter une adresse'}
                onClick={() => navigate({ name: 'addresses', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="📦"
                tint="rgba(31,139,76,0.10)"
                label="Mes commandes"
                sub={stats.ordersCount > 0 ? `${stats.ordersCount} commande${stats.ordersCount > 1 ? 's' : ''}` : "Voir l'historique"}
                onClick={() => navigate('/orders')}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="💳"
                tint="rgba(31,139,76,0.10)"
                label="Moyens de paiement"
                sub="Wave · OM · Cash · Carte"
                onClick={() => navigate({ name: 'payments', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="❤️"
                tint="rgba(232,56,92,0.10)"
                label="Favoris"
                sub={stats.favoritesCount > 0 ? `${stats.favoritesCount} produit${stats.favoritesCount > 1 ? 's' : ''}` : 'Tes coups de cœur'}
                onClick={() => navigate({ name: 'favorites', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="⭐"
                tint="rgba(244,181,58,0.14)"
                label="Programme fidélité"
                sub={`${loyaltyPoints.toLocaleString('fr-FR')} points · Voir mes récompenses`}
                onClick={() => navigate({ name: 'loyalty', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="🎁"
                tint="rgba(244,181,58,0.14)"
                label="Parrainage"
                sub="+3 000 FCFA offerts"
                onClick={() => navigate({ name: 'referral', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="🏷️"
                tint="rgba(232,56,92,0.10)"
                label="Bons plans"
                sub="Promos & codes actifs"
                onClick={() => navigate({ name: 'promos', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="📬"
                tint="rgba(244,181,58,0.14)"
                label="Newsletter"
                sub="Promos exclusives & conseils beauté"
                onClick={() => navigate({ name: 'newsletter', params: {} })}
              />
            </div>
          </section>

          {/* SECTION : DIAGNOSTIC & DONNÉES */}
          <section className="prof2-section prof2-anim" style={{ animationDelay: '200ms' }}>
            <h2 className="prof2-section-title">Mon profil peau</h2>
            <div className="prof2-card">
              <MenuItem
                icon="✨"
                tint="rgba(31,139,76,0.10)"
                label="Mon diagnostic peau"
                sub={hasScan ? `Dernier scan : ${safeFormatDate(stats.lastScan?.created_at)}` : 'Faire le scan'}
                onClick={() => navigate({ name: 'scan', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="📈"
                tint="rgba(31,139,76,0.10)"
                label="Mon évolution"
                sub="Avant/Après mensuel"
                onClick={() => navigate({ name: 'evolution', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="👤"
                tint="rgba(31,139,76,0.10)"
                label="Mon prénom"
                sub={user?.first_name || 'À renseigner'}
                onClick={handleEditFirstName}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="📱"
                tint="rgba(31,139,76,0.10)"
                label="Mon WhatsApp"
                sub={user?.phone || 'Requis pour les notifs commande'}
                onClick={handleEditPhone}
              />
            </div>
          </section>

          {/* SECTION : PRÉFÉRENCES */}
          <section className="prof2-section prof2-anim" style={{ animationDelay: '250ms' }}>
            <h2 className="prof2-section-title">Préférences</h2>
            <div className="prof2-card">
              {!isIOSApp() && (
                <>
                  <MenuItem
                    icon="🔔"
                    tint="rgba(244,181,58,0.14)"
                    label="Notifications"
                    sub="Push · Rappels · Commandes"
                    onClick={() => navigate({ name: 'notif_settings', params: {} })}
                  />
                  <div className="prof2-sep" />
                </>
              )}
              <MenuItem
                icon="🌍"
                tint="rgba(31,139,76,0.10)"
                label="Langue"
                sub="Français"
                onClick={() => toast.info('Bientôt : Wolof + Anglais')}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon={getTheme() === 'dark' ? '🌙' : '☀️'}
                tint="rgba(0,0,0,0.06)"
                label="Apparence"
                sub={`Mode ${getTheme() === 'dark' ? 'sombre' : 'clair'}`}
                onClick={() => toggleTheme()}
                trailing={
                  <span className={`prof2-toggle ${getTheme() === 'dark' ? 'is-on' : ''}`} aria-hidden>
                    <span className="prof2-toggle-knob" />
                  </span>
                }
              />
            </div>
          </section>

          {/* SECTION : SUPPORT */}
          <section className="prof2-section prof2-anim" style={{ animationDelay: '300ms' }}>
            <h2 className="prof2-section-title">Support</h2>
            <div className="prof2-card">
              <MenuItem
                icon="💬"
                tint="rgba(37,211,102,0.12)"
                label="WhatsApp YARAM"
                sub={getWhatsAppDisplay()}
                href={`https://wa.me/${getWhatsAppNumber()}`}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="❓"
                tint="rgba(31,139,76,0.10)"
                label="Aide & FAQ"
                sub="Réponses aux questions courantes"
                onClick={() => navigate({ name: 'help', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="📥"
                tint="rgba(0,0,0,0.06)"
                label="Télécharger mes données"
                sub="Export RGPD (JSON)"
                onClick={handleExportData}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="🏛️"
                tint="rgba(0,0,0,0.06)"
                label="Mentions légales"
                sub="Éditeur, hébergeur, contact"
                onClick={() => navigate({ name: 'mentions', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="🔒"
                tint="rgba(0,0,0,0.06)"
                label="Politique de confidentialité"
                sub="Comment on protège tes données"
                onClick={() => navigate({ name: 'privacy', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="📄"
                tint="rgba(0,0,0,0.06)"
                label="Conditions générales"
                sub="CGV / CGU YARAM"
                onClick={() => navigate({ name: 'terms', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="🗑️"
                tint="rgba(217,52,43,0.10)"
                label="Supprimer mon compte"
                sub="Action irréversible"
                danger
                onClick={() => navigate({ name: 'delete_account', params: {} })}
              />
              <div className="prof2-sep" />
              <MenuItem
                icon="↩️"
                tint="rgba(217,52,43,0.10)"
                label="Déconnexion"
                sub="À bientôt"
                danger
                onClick={handleLogout}
              />
            </div>
          </section>

          {/* FOOTER */}
          <div className="prof2-footer prof2-anim" style={{ animationDelay: '350ms' }}>
            <div className="prof2-footer-logo">YARAM</div>
            <div className="prof2-footer-meta">v0.1 · Beauté Sénégal</div>
          </div>

          <div style={{ height: 30 }} />
        </PullToRefresh>
      </div>
      <TabBar active="profile" />
    </div>
  );
}
