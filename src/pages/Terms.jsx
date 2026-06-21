import { useNav } from '../App';
import { useDocumentTitle, useMetaDescription, useCanonical } from '../lib/seo';
import { getWhatsAppNumber, getWhatsAppDisplay } from '../lib/utils';
import './Legal.css';

/*
  YARAM — Conditions Générales de Vente et d'Utilisation (CGV / CGU)
  Marketplace beauté & pharmacie au Sénégal.
  Régies par le droit sénégalais (OHADA, loi e-commerce, code de la
  consommation) et par le RGPD pour les utilisateurs résidant dans l'UE.
  ---------------------------------------------------------------
  TEXTE RÉDIGÉ AVEC L'ASSISTANCE D'UNE IA — À VALIDER PAR UN JURISTE
  SÉNÉGALAIS AVANT LANCEMENT OFFICIEL.
*/

export default function Terms() {
  const { navigate } = useNav();
  useDocumentTitle('Conditions générales · YARAM');
  useMetaDescription('CGV/CGU YARAM : marketplace beauté et pharmacie au Sénégal. Livraison, paiement, rétractation, garanties.');
  useCanonical('https://yaram.app/terms');

  return (
    <div className="legal-screen page-anim">
      <header className="legal-header">
        <button className="legal-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Conditions générales (CGV / CGU)</h1>
      </header>

      <article className="legal-content">
        <p className="legal-meta">Dernière mise à jour : 21 juin 2026</p>

        <h2>1. Objet</h2>
        <p>
          Les présentes Conditions Générales de Vente et d'Utilisation (« CGV/CGU »)
          régissent l'utilisation de la plateforme <strong>YARAM</strong>, marketplace
          accessible sur le web (<a href="https://yaram.app">yaram.app</a>) et via
          l'application mobile iOS et Android, éditée par{' '}
          <strong>[RAISON_SOCIALE]</strong>. YARAM met en relation des utilisateurs
          (« Clients ») avec des pharmacies, parapharmacies et marques partenaires
          (« Vendeurs ») pour la commande de produits cosmétiques, de soins, d'hygiène
          et de parapharmacie.
        </p>

        <h2>2. Description du service</h2>
        <ul>
          <li>Commande et achat de produits cosmétiques, soins, hygiène, parapharmacie auprès de Vendeurs partenaires.</li>
          <li>Livraison à domicile à Dakar, sa banlieue et dans les régions du Sénégal.</li>
          <li>Service d'analyse de peau assistée par intelligence artificielle (« Scan IA ») à titre purement informatif.</li>
          <li>Programme de fidélité et système de parrainage.</li>
          <li>Suivi des commandes et notifications via WhatsApp, email et notifications push.</li>
        </ul>

        <h2>3. Conditions d'accès</h2>
        <ul>
          <li>L'utilisateur déclare être <strong>majeur</strong> (18 ans) ou utiliser le service sous la responsabilité d'un parent ou représentant légal.</li>
          <li>L'utilisateur doit disposer de la <strong>capacité juridique</strong> pour contracter au regard du droit sénégalais.</li>
          <li>L'accès au service implique l'acceptation pleine et entière des présentes CGV/CGU.</li>
        </ul>

        <h2>4. Compte utilisateur</h2>
        <ul>
          <li>La création d'un compte nécessite la fourniture d'informations exactes (email, téléphone, prénom, adresse).</li>
          <li>L'utilisateur est seul responsable de la confidentialité de ses identifiants. YARAM ne demandera jamais votre mot de passe par téléphone, email ou WhatsApp.</li>
          <li>YARAM se réserve le droit de suspendre ou supprimer un compte en cas de fraude, d'usurpation, de comportement abusif ou de violation des présentes CGV/CGU.</li>
          <li>Vous pouvez supprimer votre compte à tout moment depuis Profil → Supprimer mon compte.</li>
        </ul>

        <h2>5. Produits proposés — restriction importante</h2>
        <p>
          YARAM commercialise des produits cosmétiques, de soins, d'hygiène et de
          parapharmacie. Concernant les médicaments :
        </p>
        <ul>
          <li>
            YARAM ne propose <strong>pas</strong> de médicaments soumis à prescription
            médicale obligatoire (ordonnance).
          </li>
          <li>
            Certains produits de parapharmacie ou médicaments « de conseil » (OTC) peuvent
            être proposés, dans le strict respect de la réglementation pharmaceutique
            sénégalaise et sous la responsabilité du pharmacien partenaire.
          </li>
          <li>
            YARAM n'exerce <strong>aucune activité médicale ou de conseil
            pharmaceutique</strong>. Pour toute pathologie, consultez un professionnel
            de santé.
          </li>
          <li>
            Le service de <strong>scan IA peau</strong> est purement informatif et ne
            constitue ni un diagnostic médical ni un avis dermatologique.
          </li>
        </ul>

        <h2>6. Prix</h2>
        <ul>
          <li>Les prix sont affichés en <strong>Francs CFA (FCFA)</strong>, toutes taxes comprises (TTC).</li>
          <li>Les frais de livraison sont indiqués au moment du panier et au checkout.</li>
          <li>YARAM se réserve le droit de modifier les prix à tout moment, sans préavis. Le prix applicable est celui affiché au moment de la validation de la commande.</li>
        </ul>

        <h2>7. Commande</h2>
        <ul>
          <li>Toute commande est soumise à la confirmation du Vendeur partenaire et à la validation du paiement.</li>
          <li>Une confirmation est envoyée par email et/ou WhatsApp.</li>
          <li>Le contrat de vente est formé à la validation effective du paiement (ou, pour le paiement à la livraison, à l'acceptation explicite de la commande par le Vendeur).</li>
          <li>YARAM se réserve le droit de refuser ou d'annuler toute commande suspecte (fraude, stock indisponible, adresse invalide).</li>
        </ul>

        <h2>8. Paiement</h2>
        <ul>
          <li>Moyens de paiement acceptés : <strong>Wave</strong>, <strong>Orange Money</strong>, <strong>cash à la livraison</strong>, <strong>carte bancaire</strong> (via PayTech).</li>
          <li>Les paiements par carte sont traités par PayTech, prestataire certifié. YARAM ne stocke aucune donnée bancaire.</li>
          <li>
            <strong>Vérification anti-fraude</strong> : certaines commandes peuvent être
            placées temporairement en statut « en attente de vérification » (
            <em>awaiting_verification</em>) afin de prévenir les paiements frauduleux.
            Un agent YARAM peut vous contacter par WhatsApp ou email pour confirmation.
            Le délai de traitement peut alors être allongé de 24 à 48h.
          </li>
          <li>En cas d'échec de paiement, la commande est automatiquement annulée.</li>
        </ul>

        <h2>9. Livraison</h2>
        <ul>
          <li><strong>Dakar et banlieue</strong> : 24 à 72 heures ouvrées, frais 1 500 FCFA, <strong>gratuit dès 30 000 FCFA</strong> d'achat.</li>
          <li><strong>Régions du Sénégal</strong> : 48 à 96 heures ouvrées, frais selon zone.</li>
          <li>
            <strong>International</strong> : sur devis, délai indicatif de 15 jours.
            Un acompte de <strong>50 %</strong> est demandé à la commande.
          </li>
          <li>Le Client doit être joignable au numéro fourni le jour de la livraison.</li>
          <li>En cas d'absence après deux tentatives, la commande peut être annulée. Les frais de livraison restent dus.</li>
          <li>Les délais sont donnés à titre indicatif. Un retard n'ouvre pas droit à indemnité, sauf cas de manquement caractérisé.</li>
        </ul>

        <h2>10. Droit de rétractation</h2>
        <p>
          Conformément à la réglementation applicable, le Client dispose d'un délai de
          <strong> 14 jours</strong> à compter de la réception du produit pour exercer
          son droit de rétractation, sans avoir à justifier de motif ni à payer de
          pénalités (hors frais de retour).
        </p>
        <p>
          <strong>Exclusions légales</strong> : conformément aux usages applicables aux
          produits d'hygiène et de cosmétique, le droit de rétractation ne peut être
          exercé pour les produits <strong>descellés après livraison</strong> et qui ne
          peuvent être renvoyés pour des raisons d'hygiène ou de protection de la santé.
        </p>
        <p>
          Pour exercer ce droit : contactez <a href="mailto:contact@yaram.sn">contact@yaram.sn</a>
          ou WhatsApp <a href={`https://wa.me/${getWhatsAppNumber()}`}>{getWhatsAppDisplay()}</a>{' '}
          avec votre numéro de commande.
        </p>

        <h2>11. Garanties</h2>
        <ul>
          <li><strong>Garantie de conformité</strong> : les produits doivent correspondre à la description et à l'usage attendu.</li>
          <li><strong>Garantie des vices cachés</strong> : conformément au droit commun.</li>
          <li>Aucune garantie n'est due pour un produit ouvert, utilisé hors recommandations, ou endommagé par le Client.</li>
          <li>Tout problème doit être signalé sous <strong>48 heures</strong> à la réception, avec photo, via WhatsApp ou email.</li>
        </ul>

        <h2>12. Responsabilité</h2>
        <ul>
          <li>
            YARAM agit en qualité d'<strong>intermédiaire technique</strong> entre le
            Client et le Vendeur partenaire. Le Vendeur (pharmacie ou marque) est
            responsable de la qualité, de la conservation et de la conformité des
            produits qu'il vend.
          </li>
          <li>
            La responsabilité de YARAM, à quelque titre que ce soit, est expressément
            limitée au <strong>montant TTC de la commande concernée</strong>.
          </li>
          <li>
            YARAM ne saurait être tenu responsable des dommages indirects, perte de
            chance, perte de bénéfice ou préjudice commercial.
          </li>
          <li>
            YARAM met en œuvre les meilleurs efforts pour assurer la disponibilité du
            service mais ne garantit pas une disponibilité ininterrompue (maintenance,
            force majeure, défaillance d'un sous-traitant).
          </li>
        </ul>

        <h2>13. Programme fidélité</h2>
        <ul>
          <li>1 FCFA dépensé = 1 point fidélité.</li>
          <li>500 points = 2 500 FCFA de réduction utilisable au panier.</li>
          <li>Les points expirent après 12 mois consécutifs sans activité sur le compte.</li>
          <li>Les points ne sont ni cessibles ni convertibles en espèces.</li>
          <li>YARAM se réserve le droit de modifier les conditions du programme avec un préavis raisonnable.</li>
        </ul>

        <h2>14. Programme de parrainage</h2>
        <ul>
          <li>Chaque utilisateur dispose d'un code de parrainage unique.</li>
          <li>
            Le filleul bénéficie de <strong>3 000 FCFA</strong> de réduction sur sa
            première commande validée et le parrain reçoit <strong>3 000 FCFA</strong>{' '}
            de crédit après validation de cette commande.
          </li>
          <li>Un seul code de parrainage utilisable par compte. Pas de cumul possible avec un compte préexistant.</li>
          <li>YARAM se réserve le droit d'annuler tout avantage en cas de fraude ou d'abus.</li>
        </ul>

        <h2>15. Propriété intellectuelle</h2>
        <p>
          La marque YARAM, les logos, le design de l'interface, les textes, les
          illustrations, les bases de données et le code source sont la propriété
          exclusive de <strong>[RAISON_SOCIALE]</strong>. Toute reproduction,
          représentation ou exploitation, totale ou partielle, sans autorisation écrite
          préalable est strictement interdite et constitue une contrefaçon.
        </p>

        <h2>16. Données personnelles</h2>
        <p>
          Le traitement de vos données est décrit en détail dans notre{' '}
          <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate({ name: 'privacy', params: {} }); }}>Politique de confidentialité</a>,
          conforme au RGPD et à la loi sénégalaise 2008-12 sur la protection des
          données personnelles.
        </p>

        <h2>17. Comportements interdits</h2>
        <p>L'utilisateur s'engage à ne pas :</p>
        <ul>
          <li>Créer de faux comptes ou usurper une identité.</li>
          <li>Poster des avis frauduleux, diffamatoires ou trompeurs.</li>
          <li>Tenter d'accéder de manière non autorisée à la plateforme ou aux comptes d'autres utilisateurs.</li>
          <li>Détourner les programmes fidélité ou parrainage.</li>
          <li>Spammer, harceler ou abuser du service client.</li>
        </ul>

        <h2>18. Modifications des CGV/CGU</h2>
        <p>
          YARAM peut modifier les présentes conditions à tout moment. La version
          applicable est celle en vigueur au moment de la commande. Les évolutions
          substantielles vous seront notifiées par email ou notification in-app.
        </p>

        <h2>19. Litiges et médiation</h2>
        <p>
          En cas de litige, les parties s'efforceront de trouver une solution amiable.
          Vous pouvez contacter le service client à{' '}
          <a href="mailto:contact@yaram.sn">contact@yaram.sn</a>. À défaut de résolution
          amiable dans un délai de 30 jours, le litige sera porté devant les{' '}
          <strong>tribunaux compétents de Dakar</strong>.
        </p>

        <h2>20. Loi applicable</h2>
        <p>
          Les présentes CGV/CGU sont régies par le <strong>droit sénégalais</strong>.
          Pour les utilisateurs résidant dans l'Union européenne, les dispositions
          impératives de protection des consommateurs et de protection des données
          (RGPD) demeurent applicables.
        </p>

        <h2>21. Voir aussi</h2>
        <ul>
          <li><a href="/privacy" onClick={(e) => { e.preventDefault(); navigate({ name: 'privacy', params: {} }); }}>Politique de confidentialité</a></li>
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
