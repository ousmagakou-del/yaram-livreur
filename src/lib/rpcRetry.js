// ════════════════════════════════════════════════════════════════
// YARAM — Wrapper RPC avec retry exponentiel + dédup en flight
// ════════════════════════════════════════════════════════════════
//
// Utilisation :
//   const { data, error } = await rpcRetry('admin_list_orders', { p_token });
//
// Stratégie :
//  - 3 tentatives maximum (T0, T0+1s, T0+3s, T0+8s)
//  - Retry uniquement sur erreurs réseau / 5xx (PAS sur 4xx auth, bad request)
//  - Dédup : si une RPC identique est déjà en vol, on attend son résultat
//    au lieu de lancer un 2e appel (évite N requêtes simultanées en cas de
//    re-render React qui spamme).
//
// Garde la même signature que supabase.rpc() → drop-in replacement.
// ════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

const inFlight = new Map(); // key = `${fn}:${JSON.stringify(params)}`

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isRetryable(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  // Erreurs réseau / DNS / TLS — toutes retryables
  if (msg.includes('failed to fetch')) return true;
  if (msg.includes('network')) return true;
  if (msg.includes('timeout')) return true;
  if (msg.includes('aborted')) return true;
  // 5xx serveur — retryable
  if (error.status >= 500 && error.status < 600) return true;
  // 429 rate limit — retryable
  if (error.status === 429) return true;
  // Tout le reste (4xx auth, bad request, 404 not found, etc.) — NON retryable
  return false;
}

/**
 * @param {string} fn Nom de la fonction RPC
 * @param {object} params Paramètres
 * @param {object} [opts] { retries?: 3, baseDelay?: 1000 }
 * @returns {Promise<{ data, error }>}
 */
export async function rpcRetry(fn, params, opts = {}) {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelay ?? 1000;
  const key = `${fn}:${JSON.stringify(params || {})}`;

  // ─── Dédup : si une requête identique est en vol, on attend son résultat ───
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const exec = (async () => {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await supabase.rpc(fn, params || {});
        if (result?.error && isRetryable(result.error) && attempt < retries) {
          lastErr = result.error;
          // Backoff exponentiel + jitter (1s, 3s, 8s avec +/- 200ms jitter)
          const delay = baseDelay * Math.pow(2.5, attempt) + Math.random() * 400 - 200;
          await sleep(Math.max(delay, 200));
          continue;
        }
        return result; // success ou erreur non-retryable
      } catch (e) {
        if (attempt >= retries || !isRetryable(e)) {
          return { data: null, error: e };
        }
        lastErr = e;
        const delay = baseDelay * Math.pow(2.5, attempt) + Math.random() * 400 - 200;
        await sleep(Math.max(delay, 200));
      }
    }
    return { data: null, error: lastErr };
  })();

  inFlight.set(key, exec);
  try {
    return await exec;
  } finally {
    inFlight.delete(key);
  }
}
