// src/lib/email-templates/onboarding-d30.js
// YARAM — Drip onboarding J+30 : "Bonus fidélité"
// Déclenché 30 jours après inscription si pas encore commandé.
// Cadeau : 500 points fidélité (équivalent ~5 000 FCFA selon le barème pointsToFcfa).

import { layout, btn, APP_URL, BRAND_GREEN, BRAND_ACCENT, BRAND_ORANGE, escapeHtml } from './_shared';

export function onboardingD30Email({ firstName } = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');

  return {
    subject: "On t'offre 500 points fidélité pour revenir",
    html: layout({
      title: 'Cadeau YARAM : 500 points fidélité',
      preheader: '500 points crédités sur ton compte — équivalent -500 FCFA.',
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};line-height:1.2;">
          ${name}, on te connaît pas encore 🎁
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Ça fait un mois que tu as rejoint YARAM mais on n'a pas encore eu le
          plaisir de te livrer un colis. On veut absolument te faire découvrir,
          alors voici un petit cadeau pour t'aider à franchir le pas.
        </p>

        <div style="background:linear-gradient(135deg,${BRAND_GREEN} 0%,#166635 100%);padding:24px 22px;border-radius:14px;margin:24px 0;color:white;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;opacity:0.85;margin-bottom:8px;">
            Bonus offert
          </div>
          <div style="font-size:32px;font-weight:900;letter-spacing:-0.5px;">
            500 points fidélité
          </div>
          <div style="font-size:13px;opacity:0.9;margin-top:6px;line-height:1.5;">
            Crédités directement sur ton compte YARAM —
            <strong>équivalent à -500 FCFA</strong> sur ta 1ère commande.
          </div>
        </div>

        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#444;">
          Comment les utiliser&nbsp;?
        </p>
        <ol style="padding-left:20px;margin:0 0 18px;color:#444;line-height:1.8;font-size:14px;">
          <li>Connecte-toi à l'app YARAM</li>
          <li>Choisis tes produits préférés</li>
          <li>Au checkout, applique tes points fidélité</li>
        </ol>

        <div style="background:#FFF8E7;border-left:4px solid ${BRAND_ACCENT};padding:14px 16px;border-radius:10px;margin:20px 0;font-size:13px;color:#6B6B6B;line-height:1.5;">
          Bonus&nbsp;: cumule-les avec ton code <strong style="color:#1A1A1A;font-family:Menlo,Consolas,monospace;letter-spacing:1px;">BIENVENUE10</strong>
          pour économiser encore plus sur ta 1ère commande.
        </div>

        <div style="margin:28px 0 16px;">${btn('Commencer maintenant', APP_URL, BRAND_ORANGE)}</div>

        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">
          Une question, un blocage&nbsp;? On est là, réponds simplement à cet email.
        </p>
      `,
    }),
  };
}

export default onboardingD30Email;
