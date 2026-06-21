import { useState, useEffect, useMemo, useRef } from 'react';
import { useNav, useUser } from '../App';
import { getWhatsAppNumber, getWhatsAppDisplay } from '../lib/utils';
import { toast, promptDialog } from '../lib/toast';
import './Help.css';

/* =========================================================
   YARAM — Help & Support (Stripe / Intercom / Apple Support)
   ========================================================= */

const FAQ_CATEGORIES = [
  {
    id: 'orders',
    icon: '📦',
    tint: 'rgba(31,139,76,0.10)',
    name: 'Commandes',
    desc: 'Passer, suivre, modifier',
    items: [
      {
        q: 'Comment passer une commande ?',
        a: "Ajoute tes produits au panier, puis touche **Commander**. Choisis ton adresse de livraison, ton mode de paiement (Wave, Orange Money, cash, carte), et valide. Tu reçois une confirmation immédiate sur WhatsApp.",
      },
      {
        q: 'Comment suivre ma commande ?',
        a: "Va dans **Mes commandes** depuis ton profil. Tu y verras le statut en temps réel : confirmée, en préparation, en route, livrée. Tu reçois aussi des notifications à chaque étape.",
      },
      {
        q: 'Modifier ou annuler une commande',
        a: "Tu peux modifier ou annuler une commande tant qu'elle est au statut **Confirmée** ou **En préparation**. Va sur la commande puis touche **Annuler**. Une fois **En route**, contacte-nous par WhatsApp.",
      },
      {
        q: 'Délais de livraison',
        a: "À Dakar : **2 à 6h** en express, **24h** en standard. En région : **24 à 72h**. Les produits import ont un délai annoncé sur la fiche produit (généralement 2 à 4 semaines).",
      },
    ],
  },
  {
    id: 'payment',
    icon: '💳',
    tint: 'rgba(244,181,58,0.14)',
    name: 'Paiement',
    desc: 'Wave, OM, cash, carte',
    items: [
      {
        q: 'Quels modes de paiement sont acceptés ?',
        a: "**Wave**, **Orange Money**, **cash à la livraison** (Dakar uniquement), et **carte bancaire** (Visa / Mastercard via lien sécurisé).",
      },
      {
        q: 'Wave ne marche pas, que faire ?',
        a: "Vérifie que tu as bien le solde nécessaire et que ton compte Wave est actif. Si le bug persiste, essaie Orange Money ou contacte-nous : on t'envoie un lien Wave direct.",
      },
      {
        q: 'Comment payer en cash à la livraison ?',
        a: "Choisis **Cash à la livraison** au checkout. Notre livreur prendra l'argent en main propre. Prépare l'appoint si possible — disponible uniquement à Dakar pour les commandes < 100 000 FCFA.",
      },
      {
        q: 'Comment obtenir un remboursement ?',
        a: "Contacte-nous dans les **48h** après réception. On rembourse sur le même moyen de paiement sous 3 à 5 jours ouvrés. Produit défectueux ou non conforme : remboursement total + reprise gratuite.",
      },
    ],
  },
  {
    id: 'account',
    icon: '👤',
    tint: 'rgba(31,139,76,0.10)',
    name: 'Compte',
    desc: 'Profil, sécurité, données',
    items: [
      {
        q: 'Comment créer un compte ?',
        a: "Ouvre l'app, touche **S'inscrire**, entre ton email ou ton numéro WhatsApp, et choisis un mot de passe. Tu reçois un code de vérification, et c'est fini en 30 secondes.",
      },
      {
        q: "J'ai oublié mon mot de passe",
        a: "Sur l'écran de connexion, touche **Mot de passe oublié**. Tu reçois un lien de réinitialisation par email ou par WhatsApp selon ta méthode d'inscription.",
      },
      {
        q: 'Comment modifier mon profil ?',
        a: "Va dans **Profil** > touche ton prénom ou ton numéro WhatsApp pour les modifier directement. Les changements sont enregistrés instantanément.",
      },
      {
        q: 'Comment supprimer mon compte ?',
        a: "Profil > Support > **Supprimer mon compte**. Action irréversible : toutes tes données (commandes, scans, favoris) seront effacées sous 30 jours conformément au RGPD.",
      },
    ],
  },
  {
    id: 'delivery',
    icon: '🚚',
    tint: 'rgba(31,139,76,0.10)',
    name: 'Livraison',
    desc: 'Zones, frais, suivi',
    items: [
      {
        q: 'Quelles zones sont desservies ?',
        a: "**Dakar et banlieue** : livraison express et standard. **Régions du Sénégal** : livraison sous 24-72h. **International** : sur demande, contacte-nous via WhatsApp.",
      },
      {
        q: 'Quels sont les frais de livraison ?',
        a: "Dakar : **1 000 - 2 000 FCFA** selon la zone. Régions : **2 500 - 5 000 FCFA**. Les frais exacts s'affichent au checkout en fonction de ton adresse.",
      },
      {
        q: 'Livraison gratuite, à partir de combien ?',
        a: "Livraison **gratuite à Dakar** pour toute commande supérieure à **25 000 FCFA**. En régions : à partir de **40 000 FCFA**.",
      },
      {
        q: 'Mon livreur tarde, que faire ?',
        a: "Si ta commande dépasse l'heure annoncée de plus de 30 min, contacte-nous sur WhatsApp avec ton numéro de commande. On te met en contact direct avec le livreur.",
      },
    ],
  },
  {
    id: 'scan',
    icon: '📷',
    tint: 'rgba(232,56,92,0.10)',
    name: 'Scan IA peau',
    desc: 'Diagnostic, confidentialité',
    items: [
      {
        q: 'Comment faire un scan peau ?',
        a: "Profil > **Faire mon scan peau**. Prends 3 photos (visage de face, profil gauche, profil droit) en lumière naturelle, et réponds à un quiz rapide. Tu obtiens ton diagnostic en 30 secondes.",
      },
      {
        q: 'Mes photos sont-elles privées ?',
        a: "**Oui, 100%.** Tes photos sont chiffrées, stockées dans nos serveurs sécurisés, et **jamais partagées**. Tu peux les supprimer à tout moment depuis Profil > Évolution.",
      },
      {
        q: 'Le diagnostic est-il fiable ?',
        a: "Notre IA est entraînée spécifiquement sur les **peaux africaines et métissées** avec plus de 50 000 scans validés par des dermatologues. Elle reste un **outil d'orientation**, pas un diagnostic médical.",
      },
    ],
  },
  {
    id: 'loyalty',
    icon: '⭐',
    tint: 'rgba(244,181,58,0.14)',
    name: 'Fidélité & promos',
    desc: 'Points, codes, parrainage',
    items: [
      {
        q: 'Comment fonctionnent les points ?',
        a: "Tu gagnes **1 point pour 100 FCFA dépensés**. Chaque point = 10 FCFA de réduction. Bonus : +500 points sur ta première commande, +1000 points pour chaque parrainage validé.",
      },
      {
        q: 'Mon code promo est refusé',
        a: "Vérifie : (1) le code est bien actif, (2) tu remplis les conditions (montant min, première commande, etc.), (3) tu n'as pas déjà utilisé un autre code. Si le bug persiste, contacte-nous.",
      },
      {
        q: 'Comment marche le parrainage ?',
        a: "Profil > **Parrainage** > partage ton code. Ton filleul gagne **3 000 FCFA** sur sa 1ère commande, et toi tu gagnes **3 000 FCFA** dès qu'il commande (sous 30 jours).",
      },
    ],
  },
  {
    id: 'import',
    icon: '✈️',
    tint: 'rgba(0,0,0,0.06)',
    name: 'Import / Preorder',
    desc: 'Produits internationaux',
    items: [
      {
        q: "C'est quoi un produit import ?",
        a: "C'est un produit que nous commandons spécialement pour toi à l'étranger (USA, France, Corée...). Délai de 2 à 4 semaines, mais **prix plus bas** car on regroupe les commandes.",
      },
      {
        q: "Comment fonctionne l'acompte 50/50 ?",
        a: "Tu paies **50% à la commande** (réservation), puis **50% à l'arrivée** avant la livraison finale. Tu es notifié dès que le produit arrive à Dakar.",
      },
      {
        q: 'Délais et suivi des produits import',
        a: "Délai estimé sur la fiche produit (souvent 14-28 jours). Tu reçois une notif à chaque étape : commande passée, en transit international, arrivé à Dakar, prêt à livrer.",
      },
    ],
  },
];

const ARTICLES = [
  {
    id: 'routine-peau-noire',
    icon: '🌿',
    title: 'Routine peau noire : le guide complet',
    excerpt: 'Les 5 étapes essentielles pour une peau éclatante adaptée aux peaux africaines.',
    body: `Une routine peau noire efficace s'articule autour de 5 étapes clés.\n\n**1. Nettoyage doux** — Utilise un gel sans sulfates matin et soir.\n\n**2. Hydratation** — La peau noire perd plus d'eau que les autres types. Privilégie les sérums à l'acide hyaluronique.\n\n**3. Protection solaire** — OUI, même avec une peau foncée. La mélanine ne protège qu'à hauteur d'un SPF 13.\n\n**4. Exfoliation hebdomadaire** — Une fois par semaine maximum, avec un acide doux (PHA, lactique).\n\n**5. Traitement ciblé** — Pour les taches, les boutons, la sécheresse. Sérums spécifiques le soir.`,
  },
  {
    id: 'creme-solaire',
    icon: '☀️',
    title: 'Choisir sa crème solaire (peau noire)',
    excerpt: "Pourquoi le SPF est crucial, même au Sénégal, et comment éviter l'effet blanc.",
    body: `**Pourquoi la protection solaire est essentielle ?**\n\nLe soleil cause 80% du vieillissement cutané et déclenche l'hyperpigmentation chez les peaux foncées (taches, masque de grossesse, cicatrices qui foncent).\n\n**Quel SPF choisir ?**\n\nMinimum **SPF 30**, idéalement **SPF 50**. À renouveler toutes les 2h en extérieur.\n\n**Comment éviter l'effet blanc ?**\n\nÉvite les filtres minéraux purs (oxyde de zinc en concentration élevée). Privilégie les **chimiques modernes** ou les **hybrides** spécialement formulés pour peaux foncées.`,
  },
  {
    id: 'hyperpigmentation',
    icon: '✨',
    title: 'Hyperpigmentation : que faire ?',
    excerpt: 'Taches brunes, cicatrices, masque de grossesse — les solutions qui marchent vraiment.',
    body: `**Les causes principales**\n\n- Exposition solaire sans protection\n- Inflammation post-acné\n- Grossesse / pilule (mélasma)\n- Frottements répétés\n\n**Les actifs qui fonctionnent**\n\n- **Vitamine C** (matin) — éclaircit en douceur\n- **Niacinamide 10%** — réduit la production de mélanine\n- **Acide azélaïque** — anti-inflammatoire + dépigmentant\n- **Rétinol** (soir, progressif) — accélère le renouvellement\n\n**Important :** la protection solaire est **non-négociable**. Sans SPF, aucun soin éclaircissant ne fonctionnera.`,
  },
  {
    id: 'acne-adulte',
    icon: '💚',
    title: 'Acné adulte : que faire ?',
    excerpt: 'Boutons hormonaux, kystes — comprendre et traiter sans agresser sa peau.',
    body: `**L'acné adulte n'est pas un échec personnel.** 30% des femmes de 25-40 ans en souffrent au Sénégal.\n\n**Les bons réflexes**\n\n- Ne pas surcharger en produits — l'acné s'aggrave avec l'agressivité\n- Nettoyer 2x par jour maximum\n- Acide salicylique 2% ciblé sur les zones à problème\n- Hydratation légère sans huile comédogène\n\n**Quand consulter ?**\n\nSi l'acné est kystique, douloureuse, ou laisse des cicatrices — direction le dermatologue. Notre IA peut t'orienter mais ne remplace pas un avis médical.`,
  },
];

export default function Help() {
  const { navigate, goBack } = useNav();
  const { user } = useUser();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [expandedCats, setExpandedCats] = useState({});
  const [expandedQuestions, setExpandedQuestions] = useState({});
  const [activeArticle, setActiveArticle] = useState(null);

  // Debounce search 200ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Auto-expand toutes les cats quand on cherche
  useEffect(() => {
    if (debouncedQuery) {
      const all = {};
      FAQ_CATEGORIES.forEach(c => { all[c.id] = true; });
      setExpandedCats(all);
    }
  }, [debouncedQuery]);

  // Filtre FAQ en temps réel
  const filteredCategories = useMemo(() => {
    if (!debouncedQuery) return FAQ_CATEGORIES;
    return FAQ_CATEGORIES
      .map(cat => {
        const items = cat.items.filter(it =>
          it.q.toLowerCase().includes(debouncedQuery) ||
          it.a.toLowerCase().includes(debouncedQuery)
        );
        return { ...cat, items };
      })
      .filter(cat => cat.items.length > 0);
  }, [debouncedQuery]);

  // Status support (8h-18h Sénégal = GMT+0)
  const isOnline = useMemo(() => {
    const h = new Date().getHours();
    return h >= 8 && h < 18;
  }, []);

  // Haptic léger
  const tapHaptic = () => {
    try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* noop */ }
  };

  // Highlight matches dans un texte
  const highlight = (text) => {
    if (!debouncedQuery) return text;
    const parts = String(text).split(new RegExp(`(${escapeRegex(debouncedQuery)})`, 'gi'));
    return parts.map((p, i) =>
      p.toLowerCase() === debouncedQuery
        ? <mark key={i} className="help-mark">{p}</mark>
        : <span key={i}>{p}</span>
    );
  };

  const renderMarkdown = (text) => {
    // Rendu très léger : **bold** + sauts de ligne
    const lines = String(text).split('\n');
    return lines.map((line, idx) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{debouncedQuery ? highlight(p) : p}</span>
      );
      return <p key={idx} className="help-faq-line">{rendered}</p>;
    });
  };

  // Actions
  const handleWhatsApp = () => {
    tapHaptic();
    const userInfo = user?.id ? ` (ID: ${user.id.slice(0, 8)}, ${user.first_name || user.email || 'client'})` : '';
    const msg = `Bonjour YARAM 👋\n\nJ'ai besoin d'aide${userInfo}.\n\n[Décris ta question ici]`;
    window.open(`https://wa.me/${getWhatsAppNumber()}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleEmail = () => {
    tapHaptic();
    const subject = encodeURIComponent('Demande d\'aide YARAM');
    const body = encodeURIComponent(
      `Bonjour,\n\nJe rencontre un souci avec :\n\n[Décris ici]\n\n---\n` +
      `${user?.id ? `User ID : ${user.id}\n` : ''}` +
      `Version app : 0.1\nPlateforme : ${navigator.userAgent.includes('iPhone') ? 'iOS' : navigator.userAgent.includes('Android') ? 'Android' : 'Web'}`
    );
    window.location.href = `mailto:contact@yaram.app?subject=${subject}&body=${body}`;
  };

  const handleCall = () => {
    tapHaptic();
    window.location.href = 'tel:+221774388766';
  };

  const handleBugReport = async () => {
    tapHaptic();
    const desc = await promptDialog(
      'Décris le bug rencontré (ce qui se passe, ce que tu attendais)',
      {
        placeholder: 'Ex : Quand je touche Commander rien ne se passe…',
        confirmLabel: 'Envoyer',
        multiline: true,
      }
    );
    if (!desc) return;
    const platform = navigator.userAgent.includes('iPhone') ? 'iOS' :
                     navigator.userAgent.includes('Android') ? 'Android' : 'Web';
    const subject = encodeURIComponent('🐞 Bug report YARAM');
    const body = encodeURIComponent(
      `Description :\n${desc}\n\n---\nMETA\n` +
      `Version app : 0.1\nPlateforme : ${platform}\n` +
      `${user?.id ? `User ID : ${user.id}\n` : ''}` +
      `User Agent : ${navigator.userAgent}\n` +
      `Date : ${new Date().toISOString()}`
    );
    window.location.href = `mailto:contact@yaram.app?subject=${subject}&body=${body}`;
    toast.success('Merci ! Le bug est en route.');
  };

  const toggleCat = (id) => {
    tapHaptic();
    setExpandedCats(s => ({ ...s, [id]: !s[id] }));
  };

  const toggleQuestion = (catId, idx) => {
    tapHaptic();
    const key = `${catId}-${idx}`;
    setExpandedQuestions(s => ({ ...s, [key]: !s[key] }));
  };

  // Vue article plein écran
  if (activeArticle) {
    return (
      <div className="help-screen help-article-screen">
        <header className="help-header help-header-article">
          <button className="help-back" onClick={() => setActiveArticle(null)} aria-label="Retour">
            <span aria-hidden>‹</span>
          </button>
          <div className="help-header-title">
            <span className="help-header-logo">YARAM</span>
            <h1>{activeArticle.title}</h1>
          </div>
        </header>
        <div className="help-article-body">
          <div className="help-article-hero">
            <span className="help-article-icon">{activeArticle.icon}</span>
            <h2>{activeArticle.title}</h2>
            <p className="help-article-excerpt">{activeArticle.excerpt}</p>
          </div>
          <div className="help-article-content">
            {renderMarkdown(activeArticle.body)}
          </div>
          <div className="help-article-cta">
            <p>Cet article t'a aidé ?</p>
            <button onClick={() => { setActiveArticle(null); toast.success('Merci pour ton retour 💚'); }}>
              Oui, merci 💚
            </button>
            <button onClick={handleWhatsApp} className="help-article-cta-alt">
              J'ai encore une question
            </button>
          </div>
          <div style={{ height: 60 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="help-screen page-anim">
      {/* Header sticky glass */}
      <header className="help-header">
        <button className="help-back" onClick={goBack} aria-label="Retour">
          <span aria-hidden>‹</span>
        </button>
        <div className="help-header-title">
          <span className="help-header-logo">YARAM</span>
          <h1>Aide & Support</h1>
        </div>
      </header>

      <div className="help-scroll">
        {/* HERO — Recherche */}
        <section className="help-hero help-anim" style={{ animationDelay: '0ms' }}>
          <h2 className="help-hero-title">Comment pouvons-nous t'aider ?</h2>
          <p className="help-hero-sub">Cherche dans notre base ou contacte-nous directement</p>
          <div className="help-search-wrap">
            <span className="help-search-icon" aria-hidden>🔍</span>
            <input
              type="text"
              className="help-search-input"
              placeholder="Ex : suivre ma commande, paiement Wave…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button className="help-search-clear" onClick={() => setQuery('')} aria-label="Effacer">
                ×
              </button>
            )}
          </div>
        </section>

        {/* Quick actions */}
        <section className="help-section help-anim" style={{ animationDelay: '60ms' }}>
          <div className="help-quick-grid">
            <button className="help-quick-card help-quick-whatsapp" onClick={handleWhatsApp} type="button">
              <span className="help-quick-icon">💬</span>
              <strong>WhatsApp YARAM</strong>
              <span className="help-quick-meta">Réponse &lt; 1h en heures ouvrables</span>
            </button>
            <button className="help-quick-card" onClick={handleEmail} type="button">
              <span className="help-quick-icon">📧</span>
              <strong>Email</strong>
              <span className="help-quick-meta">contact@yaram.app</span>
            </button>
            <button className="help-quick-card" onClick={handleCall} type="button">
              <span className="help-quick-icon">📞</span>
              <strong>Appeler</strong>
              <span className="help-quick-meta">+221 77 438 87 66</span>
            </button>
            <button className="help-quick-card" onClick={handleBugReport} type="button">
              <span className="help-quick-icon">🛠</span>
              <strong>Signaler un bug</strong>
              <span className="help-quick-meta">Avec ta version & plateforme</span>
            </button>
          </div>
        </section>

        {/* FAQ catégories */}
        <section className="help-section help-anim" style={{ animationDelay: '120ms' }}>
          <h3 className="help-section-title">
            {debouncedQuery
              ? `${filteredCategories.reduce((n, c) => n + c.items.length, 0)} résultat${filteredCategories.reduce((n, c) => n + c.items.length, 0) > 1 ? 's' : ''}`
              : 'Questions fréquentes'}
          </h3>

          {filteredCategories.length === 0 && (
            <div className="help-empty">
              <span aria-hidden>🤔</span>
              <p>Pas de résultat pour <strong>« {debouncedQuery} »</strong></p>
              <button onClick={handleWhatsApp}>Demander sur WhatsApp</button>
            </div>
          )}

          <div className="help-faq-list">
            {filteredCategories.map((cat, ci) => {
              const open = !!expandedCats[cat.id];
              return (
                <div
                  key={cat.id}
                  className={`help-cat-card ${open ? 'is-open' : ''}`}
                  style={{ animationDelay: `${ci * 40}ms` }}
                >
                  <button
                    className="help-cat-head"
                    onClick={() => toggleCat(cat.id)}
                    type="button"
                    aria-expanded={open}
                  >
                    <span className="help-cat-icon" style={{ background: cat.tint }}>{cat.icon}</span>
                    <span className="help-cat-text">
                      <strong>{highlight(cat.name)}</strong>
                      <span>{cat.desc} · {cat.items.length} article{cat.items.length > 1 ? 's' : ''}</span>
                    </span>
                    <span className={`help-cat-arrow ${open ? 'is-open' : ''}`} aria-hidden>›</span>
                  </button>
                  <div className={`help-cat-body ${open ? 'is-open' : ''}`}>
                    <div className="help-cat-body-inner">
                      {cat.items.map((it, idx) => {
                        const key = `${cat.id}-${idx}`;
                        const qOpen = !!expandedQuestions[key];
                        return (
                          <div key={idx} className={`help-q ${qOpen ? 'is-open' : ''}`}>
                            <button
                              className="help-q-head"
                              onClick={() => toggleQuestion(cat.id, idx)}
                              type="button"
                              aria-expanded={qOpen}
                            >
                              <span className="help-q-text">{highlight(it.q)}</span>
                              <span className={`help-q-plus ${qOpen ? 'is-open' : ''}`} aria-hidden>+</span>
                            </button>
                            <div className={`help-q-body ${qOpen ? 'is-open' : ''}`}>
                              <div className="help-q-body-inner">
                                {renderMarkdown(it.a)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Articles utiles */}
        {!debouncedQuery && (
          <section className="help-section help-anim" style={{ animationDelay: '180ms' }}>
            <h3 className="help-section-title">Articles utiles</h3>
            <div className="help-articles">
              {ARTICLES.map((a, i) => (
                <button
                  key={a.id}
                  className="help-article-card"
                  onClick={() => { tapHaptic(); setActiveArticle(a); window.scrollTo(0, 0); }}
                  type="button"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span className="help-article-card-icon">{a.icon}</span>
                  <div className="help-article-card-text">
                    <strong>{a.title}</strong>
                    <span>{a.excerpt}</span>
                  </div>
                  <span className="help-article-card-arrow" aria-hidden>›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Footer status */}
        <footer className="help-footer help-anim" style={{ animationDelay: '240ms' }}>
          <div className={`help-status ${isOnline ? 'is-online' : 'is-offline'}`}>
            <span className="help-status-dot" />
            <strong>{isOnline ? 'Support en ligne' : 'On répond demain'}</strong>
            <span>Lun-Sam · 8h-18h (heure de Dakar)</span>
          </div>
          <p className="help-footer-meta">YARAM Support · v0.1</p>
        </footer>

        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

// utils
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
