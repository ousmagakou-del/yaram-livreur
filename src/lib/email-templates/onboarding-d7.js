// src/lib/email-templates/onboarding-d7.js
// YARAM — Drip onboarding J+7 : "Le top 3 du moment"
// Déclenché 7 jours après inscription si pas encore commandé.

import { layout, btn, APP_URL, BRAND_GREEN, BRAND_ACCENT, escapeHtml, fcfa } from './_shared';

function productCard(p) {
  const name = escapeHtml(p?.name || '');
  const brand = escapeHtml(p?.brand || '');
  const price = fcfa(p?.price || 0);
  const img = p?.img ? escapeHtml(p.img) : '';
  const url = `${APP_URL}/product/${escapeHtml(p?.id || '')}`;
  const imgCell = img
    ? `<img src="${img}" alt="${name}" width="80" height="80" style="display:block;width:80px;height:80px;border-radius:10px;object-fit:cover;background:#F0F2F5;">`
    : `<div style="width:80px;height:80px;border-radius:10px;background:#F0F2F5;"></div>`;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:10px 0;border:1px solid #EFEFEF;border-radius:12px;">
      <tr>
        <td style="padding:14px;width:96px;vertical-align:top;">${imgCell}</td>
        <td style="padding:14px 14px 14px 0;vertical-align:top;">
          <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">${brand}</div>
          <div style="font-size:15px;color:#1A1A1A;font-weight:700;margin:4px 0 6px;line-height:1.3;">${name}</div>
          <div style="font-size:15px;color:${BRAND_GREEN};font-weight:800;">${price}</div>
          <div style="margin-top:8px;">
            <a href="${url}" style="display:inline-block;font-size:13px;color:${BRAND_GREEN};text-decoration:none;font-weight:700;">Voir le produit →</a>
          </div>
        </td>
      </tr>
    </table>`;
}

export function onboardingD7Email({ firstName, topProducts = [] } = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');
  const products = (topProducts || []).slice(0, 3);
  const cards = products.length
    ? products.map(productCard).join('')
    : `<p style="margin:8px 0;font-size:14px;color:#666;">Découvre notre top 3 directement sur l'app.</p>`;

  return {
    subject: "Voici ce que les Sénégalaises adorent en ce moment",
    html: layout({
      title: 'Le top 3 YARAM de la semaine',
      preheader: '3 best-sellers validés par nos clientes — à découvrir.',
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};line-height:1.25;">
          ${name}, voici les chouchous du moment ✨
        </h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">
          Tu hésites par où commencer&nbsp;? Voici les <strong>3 produits préférés
          des Sénégalaises cette semaine</strong> — testés, approuvés, livrés en 24h à Dakar.
        </p>

        ${cards}

        <div style="background:#FFF8E7;border-left:4px solid ${BRAND_ACCENT};padding:14px 16px;border-radius:10px;margin:24px 0;font-size:13px;color:#6B6B6B;line-height:1.5;">
          Petit rappel&nbsp;: ton code <strong style="color:#1A1A1A;font-family:Menlo,Consolas,monospace;letter-spacing:1px;">BIENVENUE10</strong>
          te donne -10% sur ta 1ère commande dès 25 000 FCFA.
        </div>

        <div style="margin:28px 0 16px;">${btn('Voir le top 3', `${APP_URL}/?utm_source=email&utm_medium=drip&utm_campaign=onboarding_d7`)}</div>

        <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.6;">
          Tu cherches un produit précis&nbsp;? Réponds à cet email avec ton type
          de peau ou tes besoins — on te fait une reco perso.
        </p>
      `,
    }),
  };
}

export default onboardingD7Email;
