// src/lib/email-templates/onboarding-d2.js
// YARAM — Drip onboarding J+2 : "On t'attend"
// Déclenché 2 jours après inscription si pas encore commandé.

import { layout, btn, APP_URL, BRAND_GREEN, BRAND_ACCENT, BRAND_ORANGE, escapeHtml } from './_shared';

export function onboardingD2Email({ firstName } = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');

  return {
    subject: "Tu n'as pas encore essayé YARAM ?",
    html: layout({
      title: "On t'attend chez YARAM",
      preheader: 'Ton code BIENVENUE10 expire bientôt — profite vite de -10%.',
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};line-height:1.2;">
          ${name}, on t'attend 💚
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          On a vu que tu n'as pas encore fait ta 1ère commande chez YARAM.
          Pas de stress — ton code <strong>BIENVENUE10</strong> est toujours actif,
          mais il <strong>expire bientôt</strong>.
        </p>

        <div style="background:#FFF8E7;border-left:4px solid ${BRAND_ACCENT};padding:18px 18px;border-radius:10px;margin:24px 0;">
          <div style="font-size:11px;font-weight:700;color:#8A6A12;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:6px;">
            Code promo bienvenue
          </div>
          <div style="font-size:26px;font-weight:800;color:#1A1A1A;letter-spacing:2px;font-family:Menlo,Consolas,monospace;">
            BIENVENUE10
          </div>
          <div style="font-size:13px;color:#6B6B6B;margin-top:6px;">
            -10% sur ta 1ère commande dès <strong>25 000 FCFA</strong>.
          </div>
        </div>

        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#444;">
          Ce que tu rates en attendant&nbsp;:
        </p>
        <ul style="padding-left:18px;margin:0 0 18px;color:#444;line-height:1.8;font-size:14px;">
          <li>800+ produits beauté validés pour peau africaine</li>
          <li>Livraison express à Dakar (24h ouvrées)</li>
          <li>Scan IA peau gratuit et personnalisé</li>
          <li>Paiement Wave, Orange Money ou à la livraison</li>
        </ul>

        <div style="margin:28px 0 16px;">${btn('Explorer le catalogue', APP_URL, BRAND_ORANGE)}</div>

        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">
          On a une question, un doute ? Réponds simplement à cet email,
          on est là pour t'aider.
        </p>
      `,
    }),
  };
}

export default onboardingD2Email;
