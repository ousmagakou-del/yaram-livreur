// ════════════════════════════════════════════════════════════════
// YARAM — Render des templates MJML compilés en HTML final
// ════════════════════════════════════════════════════════════════
//
// Les .mjml de src/email-mjml/ sont compilés en HTML par
// scripts/build-emails.mjs → src/email-mjml/dist/index.js qui exporte
// chaque template comme une string template literal.
//
// Ce module :
//   1. Importe les HTML compilés
//   2. Fait le substitution {{VAR}} → valeur réelle
//   3. Optionnellement insère le Schema.org JSON-LD dans le <head>
//
// Usage :
//   import { renderEmail } from './render';
//   const html = renderEmail('welcome', { FIRST_NAME: 'Aïssatou', WA_RAW: '221777608983' });
// ════════════════════════════════════════════════════════════════

import { renderJsonLd } from './schema.js';

// PERF : import dynamique des templates MJML compilés.
// Le bundle client embarque 0 byte de HTML email jusqu'à ce qu'un email
// soit envoyé (signup, checkout, etc.). Le chunk MJML (~100 kB) ne se
// charge qu'à la demande, parallèle au reste du flow.
let _cachedTemplates = null;
async function loadTemplates() {
  if (_cachedTemplates) return _cachedTemplates;
  const mod = await import('../../email-mjml/dist/index.js');
  _cachedTemplates = {
    welcome: mod.welcomeHtml,
    'order-confirmation': mod.orderConfirmationHtml,
    'payment-received': mod.paymentReceivedHtml,
    shipping: mod.shippingHtml,
    delivered: mod.deliveredHtml,
  };
  return _cachedTemplates;
}

/**
 * Substitue les variables {{VAR}} dans le template par les valeurs fournies.
 * @param {string} name - nom du template (welcome, order-confirmation, etc.)
 * @param {object} vars - dict de remplacements
 * @param {object} [opts]
 * @param {object} [opts.schema] - JSON-LD Schema.org à injecter (cf schema.js)
 * @param {string} [opts.preview] - texte de preview affiché dans la liste Gmail
 * @returns {string} HTML final prêt pour Resend
 */
export async function renderEmail(name, vars = {}, opts = {}) {
  const templates = await loadTemplates();
  let html = templates[name];
  if (!html) {
    throw new Error(`[renderEmail] Template inconnu: ${name}. Disponibles : ${Object.keys(templates).join(', ')}`);
  }

  // Defaults globaux + override par vars
  const allVars = {
    WA_RAW: '221777608983',
    PREVIEW_TEXT: opts.preview || '',
    ...vars,
  };

  // Substitue {{VAR}} → value (échappe pas — on assume que les vars sont safe)
  for (const [k, v] of Object.entries(allVars)) {
    const pattern = new RegExp(`{{${k}}}`, 'g');
    html = html.replace(pattern, v == null ? '' : String(v));
  }

  // Nettoie les variables non remplacées (pour ne pas afficher {{XXX}} en clair)
  html = html.replace(/{{[A-Z_]+}}/g, '');

  // Schema.org JSON-LD : injecte dans le <head> juste avant </head>
  if (opts.schema) {
    const jsonLd = renderJsonLd(opts.schema);
    html = html.replace('</head>', `${jsonLd}</head>`);
  }

  return html;
}

/**
 * Liste des noms de templates disponibles (pour debug / admin).
 */
export async function listTemplates() {
  const templates = await loadTemplates();
  return Object.keys(templates);
}
