#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// YARAM — Génère le JWT Apple Sign-In pour Supabase OAuth
// ════════════════════════════════════════════════════════════════
//
// Usage :
//   node scripts/gen-apple-jwt.mjs
//
// Avant de lancer, édite les 4 constantes ci-dessous :
//   - TEAM_ID    : ton Team ID Apple (10 chars, ex "6779DNV7Y5")
//   - KEY_ID     : le Key ID de la clé Apple Sign-In (10 chars)
//   - SERVICE_ID : "app.yaram.web" (le Service ID créé chez Apple)
//   - P8_PATH    : chemin vers le fichier AuthKey_XXXXXXXXXX.p8
//
// Génère un JWT valide 6 mois (limite Apple).
// Copie le JWT généré dans le champ "Secret Key (for OAuth)" sur Supabase.
//
// À régénérer tous les 6 mois (sinon le Sign In with Apple casse).
// ════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { createSign } from 'crypto';

// ─── ÉDITE CES 4 LIGNES ─────────────────────────────────────────
const TEAM_ID    = '6779DNV7Y5';            // ← ton Team ID Apple
const KEY_ID     = 'YL76ZF9SGZ';   // ← Key ID de la clé Apple Sign-In créée
const SERVICE_ID = 'app.yaram.web';         // ← Service ID web (cf étape 1)
const P8_PATH    = './AuthKey_MF3L4H89DX.p8'; // ← chemin du .p8 téléchargé
// ──────────────────────────────────────────────────────────────

// ─── Validation ───
if (KEY_ID.includes('REMPLACE') || P8_PATH.includes('XXXXXXXXXX')) {
  console.error('❌ Édite TEAM_ID, KEY_ID, SERVICE_ID et P8_PATH dans ce fichier avant de lancer.');
  process.exit(1);
}

let p8Content;
try {
  p8Content = readFileSync(P8_PATH, 'utf-8');
} catch (e) {
  console.error(`❌ Impossible de lire le fichier .p8 : ${P8_PATH}`);
  console.error(e.message);
  process.exit(1);
}

// ─── Construction du JWT ES256 ────────────────────────────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

const now = Math.floor(Date.now() / 1000);
const expiry = now + (180 * 24 * 60 * 60); // 180 jours (max Apple = 6 mois)

const header = {
  alg: 'ES256',
  kid: KEY_ID,
  typ: 'JWT',
};

const claims = {
  iss: TEAM_ID,
  iat: now,
  exp: expiry,
  aud: 'https://appleid.apple.com',
  sub: SERVICE_ID,
};

const headerB64  = base64url(JSON.stringify(header));
const claimsB64  = base64url(JSON.stringify(claims));
const signingInput = `${headerB64}.${claimsB64}`;

// Signature ES256 avec la clé .p8
const signer = createSign('SHA256');
signer.update(signingInput);
signer.end();
const derSig = signer.sign({ key: p8Content, format: 'pem' });

// ES256 = signature en concatenation r||s (32 bytes chacun = 64 bytes)
// Le crypto Node retourne du DER, faut convertir.
function derToJoseSignature(derSig) {
  // DER : 0x30 [len] 0x02 [rLen] r 0x02 [sLen] s
  let offset = 2;
  if (derSig[1] & 0x80) offset += derSig[1] & 0x7f;
  const rLen = derSig[offset + 1];
  let r = derSig.subarray(offset + 2, offset + 2 + rLen);
  const sLen = derSig[offset + 2 + rLen + 1];
  let s = derSig.subarray(offset + 2 + rLen + 2, offset + 2 + rLen + 2 + sLen);
  // Padding éventuel (DER peut avoir 33 bytes avec 0x00 leading)
  if (r.length > 32) r = r.subarray(r.length - 32);
  if (s.length > 32) s = s.subarray(s.length - 32);
  // Pad to 32 bytes si plus court
  const rPad = Buffer.alloc(32);
  const sPad = Buffer.alloc(32);
  r.copy(rPad, 32 - r.length);
  s.copy(sPad, 32 - s.length);
  return Buffer.concat([rPad, sPad]);
}
const joseSig = derToJoseSignature(derSig);
const sigB64 = base64url(joseSig);

const jwt = `${signingInput}.${sigB64}`;

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  ✅ JWT Apple Sign-In généré pour YARAM');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');
console.log('Team ID    :', TEAM_ID);
console.log('Key ID     :', KEY_ID);
console.log('Service ID :', SERVICE_ID);
console.log('Valide jusqu\'au :', new Date(expiry * 1000).toLocaleDateString('fr-FR'));
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  COPIE LE JWT CI-DESSOUS dans Supabase → Auth → Apple → Secret Key');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');
console.log(jwt);
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('  ⚠️  À régénérer dans 6 mois (avant', new Date(expiry * 1000).toLocaleDateString('fr-FR'), ')');
console.log('═══════════════════════════════════════════════════════════════════');
