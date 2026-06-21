// src/lib/email-templates/welcome.js
// YARAM — Email de bienvenue (code promo BIENVENUE10)

import { layout, btn, APP_URL, BRAND_GREEN, BRAND_ACCENT, escapeHtml } from './_shared';

export function welcomeEmail({ firstName } = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');

  return {
    subject: `Bienvenue chez YARAM 💚 ${name}`,
    html: layout({
      title: 'Bienvenue sur YARAM',
      preheader: 'Profite de -10% sur ta 1ère commande avec BIENVENUE10',
      body: `
        <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${BRAND_GREEN};line-height:1.2;">
          Bienvenue, ${name} 💚
        </h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Merci de t'être inscrit·e chez YARAM, la marketplace beauté pensée pour ta peau et tes cheveux.
          On a hâte que tu découvres nos pépites validées par dermato et nos partenaires de confiance à Dakar.
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

        <ul style="padding-left:18px;margin:18px 0;color:#444;line-height:1.8;font-size:14px;">
          <li>800+ produits beauté validés pour peau africaine</li>
          <li>Livraison express à Dakar (24h ouvrées)</li>
          <li>Scan IA peau gratuit et personnalisé</li>
          <li>Paiement Wave, Orange Money ou à la livraison</li>
        </ul>

        <div style="margin:28px 0 16px;">${btn('Découvrir l\'app', APP_URL)}</div>

        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">
          Rendez-vous sur <a href="${APP_URL}" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">yaram.app</a>
          — et n'hésite pas à nous écrire si tu as la moindre question.
        </p>
      `,
    }),
  };
}

export default welcomeEmail;
