import { useNav } from '../App';
import { useDocumentTitle, useMetaDescription, useCanonical } from '../lib/seo';
import { getWhatsAppNumber, getWhatsAppDisplay } from '../lib/utils';
import './Legal.css';

/*
  YARAM — Mentions légales
  Conformes aux exigences du droit sénégalais (loi sur le commerce
  électronique, OHADA) et aux pratiques RGPD pour l'identification de
  l'éditeur d'un service en ligne.
  ---------------------------------------------------------------
  TEXTE RÉDIGÉ AVEC L'ASSISTANCE D'UNE IA — À VALIDER PAR UN JURISTE
  SÉNÉGALAIS AVANT LANCEMENT OFFICIEL.
*/

export default function MentionsLegales() {
  const { navigate } = useNav();
  useDocumentTitle('Mentions légales · YARAM');
  useMetaDescription('Mentions légales YARAM : éditeur, hébergeur, propriété intellectuelle, contact.');
  useCanonical('https://yaram.app/mentions');

  return (
    <div className="legal-screen page-anim">
      <header className="legal-header">
        <button className="legal-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Mentions légales</h1>
      </header>

      <article className="legal-content">
        <p className="legal-meta">Dernière mise à jour : 21 juin 2026</p>

        <h2>1. Éditeur du service</h2>
        <ul>
          <li><strong>Raison sociale</strong> : [RAISON_SOCIALE]</li>
          <li><strong>Forme juridique</strong> : [FORME_JURIDIQUE] (ex. SAS, SARL, SUARL)</li>
          <li><strong>Capital social</strong> : [CAPITAL] FCFA</li>
          <li><strong>Siège social</strong> : [SIEGE], Dakar, Sénégal</li>
          <li><strong>RCCM</strong> : [RCCM]</li>
          <li><strong>NINEA</strong> : [NINEA]</li>
          <li><strong>Représentant légal</strong> : [REPRÉSENTANT_LÉGAL]</li>
          <li><strong>Directeur de la publication</strong> : [DIRECTEUR_PUBLICATION]</li>
        </ul>

        <h2>2. Contact</h2>
        <ul>
          <li>Email : <a href="mailto:contact@yaram.sn">contact@yaram.sn</a></li>
          <li>Téléphone / WhatsApp : <a href={`https://wa.me/${getWhatsAppNumber()}`}>{getWhatsAppDisplay()}</a></li>
          <li>Site web : <a href="https://yaram.app">https://yaram.app</a></li>
          <li>Application : YARAM (iOS, Android)</li>
        </ul>

        <h2>3. Hébergement</h2>
        <p>
          Le site et l'application YARAM sont hébergés par les prestataires suivants :
        </p>
        <ul>
          <li>
            <strong>Front-end web (Cloudflare Pages)</strong> :{' '}
            Cloudflare, Inc. — 101 Townsend Street, San Francisco, CA 94107, États-Unis —{' '}
            <a href="https://www.cloudflare.com" target="_blank" rel="noopener noreferrer">www.cloudflare.com</a>
          </li>
          <li>
            <strong>Backend, base de données et stockage de fichiers</strong> :{' '}
            Supabase, Inc. — 970 Toa Payoh North, #07-04, Singapour 318992 (entité
            opérante mondiale), régions UE et USA —{' '}
            <a href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a>
          </li>
          <li>
            <strong>Emails transactionnels</strong> : Resend (USA) —{' '}
            <a href="https://resend.com" target="_blank" rel="noopener noreferrer">resend.com</a>
          </li>
          <li>
            <strong>Notifications push</strong> : OneSignal (USA) / Firebase Cloud
            Messaging — Google LLC (USA).
          </li>
          <li>
            <strong>Paiements en ligne</strong> : PayTech (Sénégal), Wave (Sénégal),
            Orange Money (Sénégal).
          </li>
          <li>
            <strong>Mesure d'audience</strong> : PostHog (UE).
          </li>
        </ul>

        <h2>4. Propriété intellectuelle</h2>
        <p>
          La marque <strong>YARAM</strong>, son logo, sa charte graphique, les
          illustrations, photographies, textes, bases de données et le code source du
          site et de l'application sont la propriété exclusive de{' '}
          <strong>[RAISON_SOCIALE]</strong> ou de ses partenaires et sont protégés par
          le droit de la propriété intellectuelle (OAPI, conventions internationales).
        </p>
        <p>
          Toute reproduction, représentation, modification, publication, transmission,
          dénaturation, totale ou partielle, sans autorisation écrite préalable est
          interdite et constitue un acte de contrefaçon susceptible d'engager la
          responsabilité civile et pénale de son auteur.
        </p>

        <h2>5. Marques et logos partenaires</h2>
        <p>
          Les marques, noms, logos et signes distinctifs des pharmacies, parapharmacies
          et marques partenaires affichés sur la plateforme demeurent la propriété de
          leurs détenteurs respectifs et sont affichés avec leur autorisation, dans le
          cadre du référencement contractuel.
        </p>

        <h2>6. Crédits</h2>
        <ul>
          <li>Conception et développement : équipe YARAM.</li>
          <li>Crédits photos : [CRÉDITS_PHOTOS] — banques d'images libres de droits et photographies fournies par les marques partenaires.</li>
          <li>Icônes et illustrations : [CRÉDITS_ICONES] (ex. système d'émoji natif, illustrations propres).</li>
        </ul>

        <h2>7. Données personnelles</h2>
        <p>
          Le traitement des données à caractère personnel est encadré par notre{' '}
          <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate({ name: 'privacy', params: {} }); }}>Politique de confidentialité</a>,
          conforme au RGPD et à la loi sénégalaise n°2008-12 du 25 janvier 2008.
        </p>
        <p>
          Autorité de contrôle au Sénégal :{' '}
          <a href="https://www.cdp.sn" target="_blank" rel="noopener noreferrer">Commission de Protection des Données Personnelles (CDP)</a>.
        </p>

        <h2>8. Conditions d'utilisation</h2>
        <p>
          L'usage du service est soumis aux{' '}
          <a href="/terms" onClick={(e) => { e.preventDefault(); navigate({ name: 'terms', params: {} }); }}>Conditions Générales de Vente et d'Utilisation</a>.
        </p>

        <h2>9. Loi applicable</h2>
        <p>
          Les présentes mentions légales sont régies par le droit sénégalais.
        </p>

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
