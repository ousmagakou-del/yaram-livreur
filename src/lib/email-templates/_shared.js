// src/lib/email-templates/_shared.js
// YARAM — Helpers partagés pour les templates HTML.
// Inline styles uniquement (Gmail/Outlook/Apple Mail).

export const APP_URL = 'https://yaram.app';
export const BRAND_GREEN = '#1F8B4C';
export const BRAND_ACCENT = '#F4B53A';
export const BRAND_ORANGE = '#E94E1B';
export const SUPPORT_EMAIL = 'contact@yaram.app';
export const SUPPORT_WA = '+221 77 760 89 83';

export function fcfa(n) {
  return (Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function maskPhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  if (digits.length < 4) return p;
  return digits.slice(0, -4).replace(/.(?=.{0})/g, '•') + ' ' + digits.slice(-4);
}

export function btn(label, href, color) {
  const c = color || BRAND_GREEN;
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:${c};border-radius:10px;">
  <a href="${href}" style="display:inline-block;padding:14px 28px;color:white;font-weight:700;font-size:15px;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

export function layout({ title, preheader, body }) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title || 'YARAM')}</title>
</head>
<body style="margin:0;padding:0;background:#F5F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1A1A;">
<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader || '')}</div>

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F5F6F8;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">

      <!-- HEADER -->
      <tr><td style="background:linear-gradient(135deg,${BRAND_GREEN} 0%,#166635 100%);padding:32px 24px;text-align:center;">
        <div style="display:inline-block;padding:8px 18px;background:rgba(255,255,255,0.14);border-radius:12px;color:white;font-weight:800;font-size:22px;letter-spacing:2px;">YARAM</div>
        <div style="margin-top:10px;color:rgba(255,255,255,0.9);font-size:11px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;">Beauté · Sénégal</div>
      </td></tr>

      <!-- BODY -->
      <tr><td style="padding:32px 32px 16px;">${body}</td></tr>

      <!-- FOOTER -->
      <tr><td style="padding:24px 32px 32px;border-top:1px solid #EFEFEF;font-size:12px;color:#888;text-align:center;line-height:1.7;">
        Besoin d'aide&nbsp;? Réponds à cet email ou écris-nous sur WhatsApp <a href="https://wa.me/221777608983" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${SUPPORT_WA}</a><br>
        <a href="${APP_URL}" style="color:${BRAND_GREEN};text-decoration:none;font-weight:600;">${APP_URL}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_GREEN};text-decoration:none;">${SUPPORT_EMAIL}</a>
        <div style="margin-top:14px;color:#AAA;font-size:11px;">
          Tu reçois cet email car tu as un compte chez <a href="${APP_URL}" style="color:#888;text-decoration:underline;">yaram.app</a> —
          <a href="${APP_URL}/profile/notifications" style="color:#888;text-decoration:underline;">gérer mes notifications</a>
        </div>
        <div style="margin-top:8px;color:#BBB;font-size:11px;">
          <a href="${APP_URL}/legal/privacy" style="color:#AAA;text-decoration:none;">Confidentialité</a>
          &nbsp;·&nbsp;
          <a href="${APP_URL}/legal/terms" style="color:#AAA;text-decoration:none;">CGU</a>
          &nbsp;·&nbsp;
          <a href="${APP_URL}/legal/mentions" style="color:#AAA;text-decoration:none;">Mentions légales</a>
          &nbsp;·&nbsp;
          <a href="mailto:${SUPPORT_EMAIL}" style="color:#AAA;text-decoration:none;">Support</a>
        </div>
        <div style="margin-top:10px;color:#BBB;">© ${year} YARAM · Dakar, Sénégal</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
