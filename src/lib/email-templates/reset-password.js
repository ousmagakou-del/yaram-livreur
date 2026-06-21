// src/lib/email-templates/reset-password.js
// YARAM — Email de réinitialisation de mot de passe

import { layout, btn, escapeHtml, APP_URL, BRAND_GREEN, SUPPORT_EMAIL } from './_shared';

export function resetPasswordEmail({
  firstName,
  resetLink,
  expiresInMinutes,
} = {}) {
  const name = escapeHtml((firstName || 'toi').trim() || 'toi');
  const expires = Number(expiresInMinutes) > 0 ? Number(expiresInMinutes) : 60;
  const safeLink = resetLink || `${APP_URL}/auth/reset`;

  return {
    subject: `Réinitialise ton mot de passe · YARAM`,
    html: layout({
      title: 'Réinitialisation du mot de passe',
      preheader: `Choisis un nouveau mot de passe — le lien expire dans ${expires} min.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:${BRAND_GREEN};">Réinitialise ton mot de passe</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;">
          Bonjour ${name}, nous avons reçu une demande de réinitialisation du mot de passe associé à ton compte YARAM.
          Clique sur le bouton ci-dessous pour en choisir un nouveau.
        </p>

        <div style="margin:24px 0;">${btn('Choisir un nouveau mot de passe', safeLink)}</div>

        <p style="margin:18px 0 8px;font-size:13px;color:#666;line-height:1.6;">
          Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :<br>
          <a href="${safeLink}" style="color:${BRAND_GREEN};word-break:break-all;">${escapeHtml(safeLink)}</a>
        </p>

        <div style="background:#FFF5E6;border-left:4px solid #E94E1B;border-radius:10px;padding:14px 16px;margin:24px 0;font-size:13px;color:#5A3D0E;line-height:1.6;">
          <strong>⚠️ Tu n'as pas demandé ça ?</strong><br>
          Ignore cet email — ton mot de passe ne change pas. Si tu vois plusieurs demandes, écris-nous à
          <a href="mailto:${SUPPORT_EMAIL}" style="color:#5A3D0E;font-weight:700;">${SUPPORT_EMAIL}</a>.
        </div>

        <p style="margin:18px 0 0;font-size:12px;color:#999;line-height:1.6;">
          Pour ta sécurité, ce lien expire dans <strong>${expires} minutes</strong>.
        </p>
      `,
    }),
  };
}

export default resetPasswordEmail;
