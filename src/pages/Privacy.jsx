import { useNav } from '../App';
import { useDocumentTitle, useMetaDescription, useCanonical } from '../lib/seo';
import { YARAM_WHATSAPP_DISPLAY } from '../lib/utils';
import './Legal.css';

export default function Privacy() {
  const { navigate } = useNav();
  useDocumentTitle('Politique de confidentialité · YARAM');
  useMetaDescription('Comment YARAM collecte, utilise et protège tes données personnelles.');
  useCanonical('https://yaram.app/privacy');

  return (
    <div className="legal-screen page-anim">
      <header className="legal-header">
        <button className="legal-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Politique de confidentialité</h1>
      </header>

      <article className="legal-content">
        <p className="legal-meta">Dernière mise à jour : 19 mai 2026</p>

        <p>
          Chez YARAM, on respecte ta vie privée. Cette page explique
          en français clair quelles données on collecte, pourquoi, comment on les protège,
          et quels sont tes droits.
        </p>

        <h2>1. Qui sommes-nous</h2>
        <p>
          <strong>YARAM</strong> est une marketplace beauté pour la peau africaine basée
          à Dakar, Sénégal. Le site est accessible sur <a href="https://yaram.app">yaram.app</a>.
        </p>
        <p>
          Pour toute question : <a href={`https://wa.me/221774388766`}>WhatsApp {YARAM_WHATSAPP_DISPLAY}</a>{' '}
          ou <a href="mailto:contact@yaram.app">contact@yaram.app</a>.
        </p>

        <h2>2. Données qu'on collecte</h2>
        <ul>
          <li><strong>Compte</strong> : prénom, email, téléphone WhatsApp (optionnel mais recommandé pour les notifs commande).</li>
          <li><strong>Adresse(s) de livraison</strong> : nom, téléphone, ville, quartier, adresse précise.</li>
          <li><strong>Commandes</strong> : produits achetés, montants, statut, méthode de paiement.</li>
          <li><strong>Scan IA peau</strong> (optionnel) : photos de visage uploadées par toi pour analyse, résultats du diagnostic (type de peau, préoccupations).</li>
          <li><strong>Avis & favoris</strong> : produits que tu as commentés ou ajoutés en favoris.</li>
          <li><strong>Tech</strong> : adresse IP, type d'appareil, navigateur, pour la sécurité et l'amélioration du service.</li>
        </ul>

        <h2>3. Pourquoi on collecte ces données</h2>
        <ul>
          <li><strong>Traiter tes commandes</strong> : préparation pharma, livraison, paiement, SAV.</li>
          <li><strong>Notifications</strong> : WhatsApp + email à chaque étape (confirmation, en route, livrée).</li>
          <li><strong>Personnalisation</strong> : recommandations produits basées sur ton type de peau.</li>
          <li><strong>Programme fidélité</strong> : suivi de tes points et avantages.</li>
          <li><strong>Sécurité</strong> : prévention de la fraude, debug.</li>
        </ul>

        <h2>4. Avec qui on partage</h2>
        <ul>
          <li><strong>Pharmacies partenaires</strong> : reçoivent ton nom + téléphone + adresse pour préparer + livrer ta commande. Rien d'autre.</li>
          <li><strong>Livreurs</strong> : reçoivent un lien temporaire avec ton adresse + téléphone pour le jour de la livraison uniquement.</li>
          <li><strong>Prestataires techniques</strong> : Supabase (DB), Cloudflare (hébergement), Resend (emails), Twilio (WhatsApp). Tous certifiés et soumis à des accords de confidentialité.</li>
          <li><strong>Personne d'autre</strong> : on ne vend jamais tes données. Pas de pub, pas de revente.</li>
        </ul>

        <h2>5. Combien de temps on les garde</h2>
        <ul>
          <li><strong>Compte actif</strong> : tant que tu utilises YARAM.</li>
          <li><strong>Commandes</strong> : 10 ans (obligation comptable sénégalaise).</li>
          <li><strong>Photos scan IA</strong> : tant que ton compte existe. Tu peux les supprimer depuis ton profil à tout moment.</li>
          <li><strong>Logs techniques</strong> : 90 jours max.</li>
        </ul>

        <h2>6. Sécurité</h2>
        <p>
          Tes données sont stockées chiffrées sur des serveurs sécurisés (Supabase / AWS).
          Les photos de scan IA et preuves de livraison sont sur un stockage privé,
          accessibles uniquement via des liens temporaires signés (7 jours).
        </p>
        <p>
          Les communications avec yaram.app sont en HTTPS. Tes mots de passe sont hashés
          (bcrypt). On ne voit jamais ton mot de passe en clair.
        </p>

        <h2>7. Tes droits (conformes au RGPD)</h2>
        <ul>
          <li><strong>Accès</strong> : tu peux télécharger toutes tes données depuis Profil → Mes données.</li>
          <li><strong>Rectification</strong> : modifie ton prénom, email, téléphone, adresse depuis ton profil.</li>
          <li><strong>Suppression</strong> : "Supprimer mon compte" supprime toutes tes données personnelles. Les commandes sont anonymisées (gardées sans nom/téléphone pour l'audit comptable).</li>
          <li><strong>Opposition</strong> : tu peux désactiver les notifs marketing depuis Profil → Notifications.</li>
          <li><strong>Plainte</strong> : tu peux contacter la <strong>Commission des Données Personnelles du Sénégal (CDP)</strong> si tu estimes que tes droits ne sont pas respectés.</li>
        </ul>

        <h2>8. Cookies</h2>
        <p>
          YARAM n'utilise pas de cookies publicitaires. Uniquement :
        </p>
        <ul>
          <li><strong>Cookies essentiels</strong> : pour ta session, panier, préférences (thème clair/sombre).</li>
          <li><strong>Cache local</strong> : pour accélérer le chargement (data temporaire, vidée si tu effaces les données du site).</li>
        </ul>

        <h2>9. Mineurs</h2>
        <p>
          YARAM est réservé aux personnes de 16 ans et plus. Si tu as moins de 16 ans, demande
          à un parent de créer le compte.
        </p>

        <h2>10. Modifications</h2>
        <p>
          Cette politique peut évoluer. La date en haut de page indique la dernière mise à jour.
          Tout changement important te sera notifié par email.
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
