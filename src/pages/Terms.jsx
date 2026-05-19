import { useNav } from '../App';
import { useDocumentTitle, useMetaDescription, useCanonical } from '../lib/seo';
import { YARAM_WHATSAPP_DISPLAY } from '../lib/utils';
import './Legal.css';

export default function Terms() {
  const { navigate } = useNav();
  useDocumentTitle('Conditions générales · YARAM');
  useMetaDescription('Conditions d\'utilisation de la marketplace YARAM.');
  useCanonical('https://yaram.app/terms');

  return (
    <div className="legal-screen page-anim">
      <header className="legal-header">
        <button className="legal-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Conditions générales</h1>
      </header>

      <article className="legal-content">
        <p className="legal-meta">Dernière mise à jour : 19 mai 2026</p>

        <p>
          Bienvenue sur YARAM. En utilisant notre plateforme, tu acceptes ces conditions.
          On les a rendues aussi courtes et claires que possible.
        </p>

        <h2>1. Qui on est</h2>
        <p>
          YARAM est une marketplace beauté basée à Dakar, Sénégal. On met en relation des
          clientes avec des pharmacies + parapharmacies partenaires pour acheter des produits
          adaptés à la peau africaine. Contact : <a href="mailto:contact@yaram.app">contact@yaram.app</a>{' '}
          ou WhatsApp <a href="https://wa.me/221774388766">{YARAM_WHATSAPP_DISPLAY}</a>.
        </p>

        <h2>2. Création de compte</h2>
        <ul>
          <li>Tu dois avoir au moins 16 ans.</li>
          <li>Les infos que tu renseignes (email, téléphone, adresse) doivent être exactes — sinon on ne peut pas te livrer.</li>
          <li>Tu es responsable de la confidentialité de ton mot de passe. On ne te le demandera jamais par email/WhatsApp.</li>
        </ul>

        <h2>3. Commandes & paiement</h2>
        <ul>
          <li>Les prix affichés sont en FCFA, TTC.</li>
          <li>Paiements acceptés : Wave, Orange Money, cash à la livraison, carte bancaire.</li>
          <li>Une commande devient ferme dès qu'une pharmacie l'accepte (statut "préparation").</li>
          <li>YARAM prélève une commission de 8% sur chaque vente pour ses frais de service. Le reste va à la pharmacie.</li>
        </ul>

        <h2>4. Livraison</h2>
        <ul>
          <li>Délai indicatif : 24h à Dakar, 48h Thiès / Mbour, plus pour le reste du Sénégal.</li>
          <li>Frais de livraison affichés au checkout, gratuits à partir de 25 000 FCFA.</li>
          <li>Tu dois être joignable au numéro fourni le jour de la livraison.</li>
          <li>Si tu n'es pas disponible, le livreur retentera. Au bout de 2 tentatives, la commande est annulée et tu es remboursée.</li>
        </ul>

        <h2>5. Retours & remboursements</h2>
        <ul>
          <li>Produits cosmétiques : pas de retour si l'emballage est ouvert (hygiène).</li>
          <li>Produit défectueux / erreur de livraison : signale-le sous 48h sur WhatsApp avec photo. Remboursement ou échange immédiat.</li>
          <li>Litige sur le scan IA peau : on ne garantit aucun résultat médical — c'est une aide à la décision, pas un diagnostic dermato.</li>
        </ul>

        <h2>6. Programme fidélité</h2>
        <ul>
          <li>1 FCFA dépensé = 1 point.</li>
          <li>500 points = 2 500 FCFA de réduction (échangeable au panier).</li>
          <li>Les points expirent après 12 mois sans activité.</li>
        </ul>

        <h2>7. Parrainage</h2>
        <ul>
          <li>Code unique par utilisatrice (visible dans Profil → Parrainer).</li>
          <li>La marraine et la filleule reçoivent 500 points chacune dès la 1ère commande validée de la filleule.</li>
          <li>Pas de cumul si la filleule a déjà un compte.</li>
        </ul>

        <h2>8. Scan IA peau</h2>
        <ul>
          <li>Service à but informatif uniquement. Ne remplace pas un avis dermatologique.</li>
          <li>Tes photos sont stockées de manière sécurisée et accessibles uniquement à toi.</li>
          <li>Tu peux les supprimer à tout moment depuis ton profil.</li>
        </ul>

        <h2>9. Comportement attendu</h2>
        <p>Sur YARAM, tu t'engages à ne pas :</p>
        <ul>
          <li>Créer de faux comptes ou usurper une identité</li>
          <li>Poster des avis frauduleux ou diffamatoires</li>
          <li>Spammer le service client</li>
          <li>Tenter de hacker la plateforme</li>
        </ul>
        <p>En cas de non-respect, on peut suspendre ou supprimer ton compte sans préavis.</p>

        <h2>10. Pharmacies partenaires</h2>
        <p>
          Les pharmacies sont des entités indépendantes. YARAM vérifie leur licence et la qualité
          de service, mais elles restent responsables des produits qu'elles vendent (origine, conservation,
          conformité). En cas de litige direct avec une pharmacie, YARAM peut intervenir en médiation.
        </p>

        <h2>11. Modification des CGU</h2>
        <p>
          On peut faire évoluer ces conditions. La date en haut indique la dernière mise à jour.
          Les changements importants te seront notifiés par email.
        </p>

        <h2>12. Loi applicable</h2>
        <p>
          Ces conditions sont régies par le droit sénégalais. Tout litige sera soumis aux tribunaux
          compétents de Dakar.
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
