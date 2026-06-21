import { useNav } from '../App';
import { useDocumentTitle, useMetaDescription, useCanonical } from '../lib/seo';
import { getWhatsAppNumber, getWhatsAppDisplay } from '../lib/utils';
import './Legal.css';

/*
  YARAM — Politique de confidentialité
  Conforme RGPD (UE) + Loi sénégalaise n°2008-12 du 25 janvier 2008
  portant sur la protection des données à caractère personnel.
  ---------------------------------------------------------------
  TEXTE RÉDIGÉ AVEC L'ASSISTANCE D'UNE IA — À VALIDER PAR UN JURISTE
  SÉNÉGALAIS (CDP) AVANT LANCEMENT OFFICIEL.
*/

export default function Privacy() {
  const { navigate } = useNav();
  useDocumentTitle('Politique de confidentialité · YARAM');
  useMetaDescription('Politique de confidentialité YARAM : données collectées, finalités, droits RGPD et loi sénégalaise 2008-12.');
  useCanonical('https://yaram.app/privacy');

  return (
    <div className="legal-screen page-anim">
      <header className="legal-header">
        <button className="legal-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Politique de confidentialité</h1>
      </header>

      <article className="legal-content">
        <p className="legal-meta">Dernière mise à jour : 21 juin 2026</p>

        <p>
          La présente politique décrit comment <strong>[RAISON_SOCIALE]</strong> (ci-après
          « YARAM ») collecte, utilise, conserve et protège les données à caractère personnel
          de ses utilisateurs, conformément au Règlement (UE) 2016/679 (« RGPD ») et à la
          Loi sénégalaise n°2008-12 du 25 janvier 2008 portant sur la protection des données
          à caractère personnel.
        </p>

        <h2>1. Responsable de traitement</h2>
        <p>
          Le responsable de traitement est <strong>[RAISON_SOCIALE]</strong>, société
          immatriculée au RCCM de Dakar sous le numéro <strong>[RCCM]</strong>, NINEA
          <strong> [NINEA]</strong>, dont le siège social est situé <strong>[SIEGE]</strong>,
          Dakar, Sénégal, représentée par <strong>[REPRÉSENTANT_LÉGAL]</strong> en qualité
          de représentant légal.
        </p>
        <p>
          Contact général : <a href="mailto:contact@yaram.sn">contact@yaram.sn</a> ·
          WhatsApp <a href={`https://wa.me/${getWhatsAppNumber()}`}>{getWhatsAppDisplay()}</a>.
        </p>

        <h2>2. Délégué à la protection des données (DPO)</h2>
        <p>
          Pour toute question relative aux données personnelles ou à l'exercice de vos
          droits, vous pouvez contacter notre point de contact dédié :
          <a href="mailto:dpo@yaram.sn"> dpo@yaram.sn</a> (ou [DPO_NOM_COORDONNÉES] si un
          DPO formel est désigné).
        </p>

        <h2>3. Données collectées</h2>
        <p>YARAM collecte les catégories de données suivantes :</p>
        <ul>
          <li>
            <strong>Données de compte</strong> : prénom, nom (optionnel), email, numéro de
            téléphone WhatsApp, mot de passe (haché).
          </li>
          <li>
            <strong>Données de commande</strong> : produits commandés, montants, historique,
            mode de paiement utilisé, statut de livraison.
          </li>
          <li>
            <strong>Données de livraison</strong> : adresses postales, quartier, ville,
            coordonnées GPS (optionnelles, uniquement si vous autorisez la géolocalisation).
          </li>
          <li>
            <strong>Données de paiement</strong> : aucun numéro de carte n'est stocké par
            YARAM. Les paiements par carte sont traités via <strong>PayTech</strong> qui
            renvoie un jeton (token) anonymisé. Les transactions Wave / Orange Money se
            font via redirection sécurisée.
          </li>
          <li>
            <strong>Scan IA peau (optionnel)</strong> : photographies du visage que vous
            choisissez de téléverser et résultats d'analyse (type de peau, préoccupations).
          </li>
          <li>
            <strong>Données de navigation</strong> : adresse IP, type d'appareil, système
            d'exploitation, pages consultées, évènements de session (via PostHog).
          </li>
          <li>
            <strong>Communications</strong> : contenu des échanges avec le support
            (WhatsApp, email).
          </li>
        </ul>

        <h2>4. Finalités et bases légales</h2>
        <p>Chaque traitement est fondé sur une base légale du RGPD :</p>
        <ul>
          <li>
            <strong>Exécution du contrat</strong> (art. 6.1.b RGPD) : gestion du compte,
            traitement des commandes, livraison, facturation, service après-vente.
          </li>
          <li>
            <strong>Obligation légale</strong> (art. 6.1.c RGPD) : conservation comptable
            et fiscale (OHADA, droit fiscal sénégalais).
          </li>
          <li>
            <strong>Intérêt légitime</strong> (art. 6.1.f RGPD) : prévention de la fraude,
            sécurisation de la plateforme, statistiques agrégées d'usage, amélioration du
            service.
          </li>
          <li>
            <strong>Consentement</strong> (art. 6.1.a RGPD) : notifications marketing
            (email, push, WhatsApp), géolocalisation précise, dépôt de cookies non
            essentiels, scan IA peau (téléversement de photos).
          </li>
        </ul>

        <h2>5. Durées de conservation</h2>
        <ul>
          <li>
            <strong>Compte utilisateur</strong> : pendant toute la durée d'utilisation,
            puis archivage intermédiaire pendant 3 ans après la dernière activité.
          </li>
          <li>
            <strong>Données de commande et facturation</strong> : 10 ans à compter de la
            clôture de l'exercice comptable (obligation légale OHADA).
          </li>
          <li>
            <strong>Photos scan IA</strong> : conservées tant que votre compte est actif.
            Suppression possible à tout moment depuis Profil → Mes données.
          </li>
          <li>
            <strong>Logs techniques et de sécurité</strong> : 12 mois maximum.
          </li>
          <li>
            <strong>Données marketing (consentement)</strong> : jusqu'au retrait du
            consentement ou 3 ans d'inactivité.
          </li>
        </ul>

        <h2>6. Destinataires et sous-traitants</h2>
        <p>
          Vos données sont accessibles uniquement aux personnes dûment habilitées de
          YARAM, et aux sous-traitants suivants, encadrés par un contrat conforme à
          l'article 28 du RGPD :
        </p>
        <ul>
          <li><strong>Supabase Inc.</strong> (USA / UE) — hébergement base de données et fichiers.</li>
          <li><strong>Cloudflare Inc.</strong> (USA) — hébergement web (Cloudflare Pages), CDN, anti-DDoS.</li>
          <li><strong>Resend</strong> (USA) — envoi d'emails transactionnels et notifications.</li>
          <li><strong>PayTech</strong> (Sénégal) — traitement des paiements par carte bancaire.</li>
          <li><strong>Wave</strong> et <strong>Orange Money</strong> (Sénégal) — paiements mobiles.</li>
          <li><strong>PostHog</strong> (UE) — mesure d'audience et analyse comportementale.</li>
          <li><strong>OneSignal / Firebase Cloud Messaging</strong> (USA) — notifications push.</li>
          <li><strong>Pharmacies et marques partenaires</strong> — prénom, téléphone, adresse de livraison strictement nécessaires à l'exécution de la commande.</li>
          <li><strong>Livreurs</strong> — nom, téléphone, adresse, le jour de la livraison uniquement.</li>
        </ul>
        <p>
          YARAM ne vend, ne loue et ne cède jamais vos données à des tiers à des fins
          commerciales.
        </p>

        <h2>7. Transferts hors Union européenne et hors Sénégal</h2>
        <p>
          Certains sous-traitants (Supabase, Resend, Cloudflare, OneSignal, Firebase) sont
          situés aux États-Unis. Ces transferts sont encadrés par les{' '}
          <strong>Clauses Contractuelles Types</strong> de la Commission européenne
          (décision 2021/914) et, le cas échéant, par l'adhésion au cadre{' '}
          <em>EU-U.S. Data Privacy Framework</em>. Une demande spécifique d'autorisation
          de transfert auprès de la CDP du Sénégal a été (ou sera) effectuée conformément
          à la loi 2008-12.
        </p>

        <h2>8. Vos droits</h2>
        <p>
          Conformément au RGPD et à la loi sénégalaise 2008-12, vous disposez des droits
          suivants :
        </p>
        <ul>
          <li><strong>Droit d'accès</strong> : obtenir une copie de vos données.</li>
          <li><strong>Droit de rectification</strong> : corriger des données inexactes.</li>
          <li><strong>Droit à l'effacement</strong> (« droit à l'oubli ») : sous réserve des obligations légales de conservation.</li>
          <li><strong>Droit à la limitation</strong> du traitement.</li>
          <li><strong>Droit à la portabilité</strong> : récupérer vos données dans un format structuré (JSON).</li>
          <li><strong>Droit d'opposition</strong> au traitement fondé sur l'intérêt légitime.</li>
          <li><strong>Droit de retirer votre consentement</strong> à tout moment, sans effet rétroactif.</li>
          <li><strong>Droit de définir des directives</strong> relatives au sort de vos données après votre décès.</li>
        </ul>

        <h2>9. Comment exercer vos droits</h2>
        <p>
          Vous pouvez exercer ces droits par email à{' '}
          <a href="mailto:contact@yaram.sn">contact@yaram.sn</a> ou{' '}
          <a href="mailto:dpo@yaram.sn">dpo@yaram.sn</a>, en précisant votre demande et en
          joignant une pièce justificative d'identité si nécessaire. Une réponse vous sera
          apportée dans un délai maximum de <strong>30 jours</strong> à compter de la
          réception de votre demande (prolongeable de 2 mois en cas de complexité, avec
          information préalable).
        </p>
        <p>
          Vous pouvez également télécharger une copie de vos données depuis Profil →
          « Télécharger mes données ».
        </p>

        <h2>10. Cookies et traceurs</h2>
        <p>
          YARAM utilise un nombre limité de cookies et de traceurs :
        </p>
        <ul>
          <li>
            <strong>Cookies strictement nécessaires</strong> : session, panier, préférences
            d'affichage. Pas de consentement requis.
          </li>
          <li>
            <strong>Mesure d'audience (PostHog)</strong> : analyse anonymisée du parcours
            utilisateur. Soumis à votre consentement.
          </li>
          <li>
            <strong>Notifications push (OneSignal / FCM)</strong> : nécessitent une
            autorisation explicite de votre navigateur ou de votre système d'exploitation.
          </li>
        </ul>
        <p>
          Vous pouvez gérer vos préférences depuis Profil → Notifications et depuis les
          paramètres de votre navigateur.
        </p>

        <h2>11. Sécurité</h2>
        <p>
          YARAM met en œuvre des mesures techniques et organisationnelles appropriées :
        </p>
        <ul>
          <li>Chiffrement des communications via <strong>HTTPS/TLS 1.2+</strong>.</li>
          <li>Authentification par <strong>JWT</strong> sécurisés.</li>
          <li>Mots de passe hachés avec <strong>bcrypt</strong> (jamais stockés en clair).</li>
          <li>Politiques d'accès au niveau ligne (<strong>RLS Postgres</strong>) sur la base de données.</li>
          <li>Liens temporaires signés (7 jours) pour les fichiers privés (photos scan, preuves de livraison).</li>
          <li>Sauvegardes chiffrées quotidiennes.</li>
          <li>Journalisation des accès administrateurs.</li>
        </ul>

        <h2>12. Mineurs</h2>
        <p>
          Le service est destiné aux personnes majeures (18 ans). Les personnes de 16 à
          17 ans peuvent utiliser le service avec l'accord d'un parent ou représentant
          légal. Aucun traitement n'est effectué sciemment sur des mineurs de moins de
          16 ans sans autorisation parentale.
        </p>

        <h2>13. Réclamations et autorités de contrôle</h2>
        <p>
          Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une
          réclamation auprès de :
        </p>
        <ul>
          <li>
            <strong>Commission de Protection des Données Personnelles du Sénégal (CDP)</strong> —{' '}
            <a href="https://www.cdp.sn" target="_blank" rel="noopener noreferrer">www.cdp.sn</a>
          </li>
          <li>
            <strong>CNIL (France)</strong> ou autorité de contrôle de votre lieu de
            résidence dans l'UE —{' '}
            <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer">www.cnil.fr</a>
          </li>
        </ul>

        <h2>14. Modifications</h2>
        <p>
          La présente politique peut être modifiée pour tenir compte d'évolutions légales,
          techniques ou organisationnelles. La date de mise à jour figure en haut de
          page. Tout changement substantiel vous sera notifié par email ou notification
          in-app.
        </p>

        <h2>15. Voir aussi</h2>
        <ul>
          <li><a href="/terms" onClick={(e) => { e.preventDefault(); navigate({ name: 'terms', params: {} }); }}>Conditions générales de vente et d'utilisation</a></li>
          <li><a href="/mentions" onClick={(e) => { e.preventDefault(); navigate({ name: 'mentions', params: {} }); }}>Mentions légales</a></li>
        </ul>

        <p className="legal-disclaimer">
          <em>
            Texte rédigé avec l'assistance d'une intelligence artificielle. Il doit être
            relu et validé par un juriste sénégalais avant tout lancement officiel.
          </em>
        </p>

        <div className="legal-cta">
          <button className="legal-btn-pri" onClick={() => navigate({ name: 'profile', params: {} })}>
            Retour à mon profil
          </button>
        </div>
      </article>
    </div>
  );
}
