#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// YARAM — Compile les templates MJML en HTML
// ════════════════════════════════════════════════════════════════
//
// Lance : npm run build:emails (déclenché auto par npm run build)
//
// 1. Compile chaque .mjml de src/email-mjml/ vers src/email-mjml/dist/
// 2. Génère src/email-mjml/dist/index.js qui exporte les HTML compilés
//    sous forme de string templates JS, utilisables direct dans emails.js
//    et edge functions Deno.
// 3. Idempotent : safe à lancer plusieurs fois.
// ════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mjml2html from 'mjml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '..', 'src', 'email-mjml');
const OUT = join(SRC, 'dist');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.mjml') && !f.startsWith('_'));

console.log(`[build-emails] Compiling ${files.length} MJML template(s)…`);

const exports = [];
let totalErrors = 0;

for (const f of files) {
  const name = basename(f, '.mjml');
  const srcPath = join(SRC, f);
  const outPath = join(OUT, `${name}.html`);

  // MJML v5 : l'API renvoie une Promise (compat fetch async d'includes)
  const result = await mjml2html(readFileSync(srcPath, 'utf-8'), {
    filePath: srcPath,
    minify: false,
    keepComments: false,
    validationLevel: 'soft',
  });

  if (result.errors && result.errors.length > 0) {
    console.warn(`[build-emails] ⚠ ${name}: ${result.errors.length} warning(s)`);
    result.errors.slice(0, 3).forEach((e) => console.warn(`    ${e.formattedMessage || e.message}`));
    totalErrors += result.errors.length;
  }

  writeFileSync(outPath, result.html);
  const sizeKb = (result.html.length / 1024).toFixed(1);
  console.log(`  ✓ ${name}.html (${sizeKb} kB)`);

  // Génère un export string ES module : safe pour Vite + edge functions Deno
  // (Deno ne peut pas lire des fichiers HTML à l'exécution → on inline le HTML
  // comme template literal dans un fichier .js qu'on import normalement.)
  const escaped = result.html
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  const camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  exports.push(`export const ${camelName}Html = \`${escaped}\`;`);
}

// Index.js réexporte tous les templates avec leur nom camelCase
const indexContent = `// AUTO-GÉNÉRÉ par scripts/build-emails.mjs — NE PAS ÉDITER À LA MAIN
// Re-générer : npm run build:emails

${exports.join('\n\n')}
`;
writeFileSync(join(OUT, 'index.js'), indexContent);

console.log(`[build-emails] ✓ ${files.length} template(s) compiled, ${totalErrors} warning(s)`);
console.log(`[build-emails] → src/email-mjml/dist/index.js (exports utilisables: ${files.map(f => basename(f, '.mjml').replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Html').join(', ')})`);
