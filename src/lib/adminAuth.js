// src/lib/adminAuth.js
// Auth admin v4 — defensif : marche peu importe le nommage retourne par la RPC

import { supabase } from './supabase';

const SESSION_KEY = 'yaram-admin-session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

// Extrait une valeur quel que soit le prefixe utilise par la RPC
function pickField(row, ...names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null) return row[n];
  }
  return null;
}

export async function adminLogin(email, pin) {
  if (!email || !pin) {
    return { success: false, error: 'Email et PIN requis' };
  }

  // Phase 2 RLS : on appelle admin_start_session qui (a) verifie le PIN
  // via verify_admin_pin et (b) emet un token de session signe cote serveur.
  // Le token est ce qui authentifiera ensuite chaque RPC admin_xxx.
  const { data, error } = await supabase.rpc('admin_start_session', {
    p_email: email.trim().toLowerCase(),
    p_pin: pin,
    p_user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
  });

  if (error) {
    if (String(error.message).includes('invalid_credentials')) {
      return { success: false, error: 'Email ou PIN incorrect' };
    }
    return { success: false, error: 'Erreur : ' + error.message };
  }

  if (!data || !data.token) {
    return { success: false, error: 'Reponse serveur invalide' };
  }

  const session = {
    token: data.token,
    id: data.admin_id,
    email: data.admin_email || email,
    name: data.admin_name || email,
    role: data.admin_role,
    permissions: Array.isArray(data.permissions) ? data.permissions : (data.permissions || []),
    expires_at: Date.parse(data.expires_at) || (Date.now() + SESSION_TTL_MS),
  };

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) { /* ignore */ }

  // Log connexion (non bloquant) — gardera sa policy "Anyone insert audit_log"
  // jusqu'a la migration audit_log vers RPC
  try {
    await supabase.from('admin_logs').insert({
      admin_id: session.id,
      admin_email: session.email,
      action: 'login',
      user_agent: navigator.userAgent,
    });
  } catch (e) { /* ignore */ }

  return { success: true, admin: session };
}

export async function adminLogout() {
  const s = getAdminSession();
  if (s) {
    // Cote serveur : on invalide le token
    try {
      await supabase.rpc('admin_end_session', { p_token: s.token });
    } catch (e) {}
    // Log
    try {
      await supabase.from('admin_logs').insert({
        admin_id: s.id,
        admin_email: s.email,
        action: 'logout',
      });
    } catch (e) {}
  }
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// Helper expose pour que tous les wrappers RPC puissent recuperer le token courant
export function getAdminToken() {
  const s = getAdminSession();
  return s ? s.token : null;
}

export function getAdminSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.expires_at || s.expires_at < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Migration : si la session a ete creee avant le passage a admin_start_session,
    // elle n'a pas de token. On la force a se reconnecter pour obtenir un token serveur.
    if (!s.token) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch (e) {
    return null;
  }
}

export function hasPermission(session, sectionId) {
  if (!session) return false;
  const perms = session.permissions || [];
  if (perms.includes('*')) return true;
  return perms.includes(sectionId);
}

export async function changeAdminPin(oldPin, newPin) {
  const s = getAdminSession();
  if (!s) return { success: false, error: 'Pas de session active' };

  if (!newPin || newPin.length < 4) {
    return { success: false, error: 'Nouveau PIN trop court (4 chiffres min)' };
  }
  const banned = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123'];
  if (banned.includes(newPin)) {
    return { success: false, error: 'PIN trop evident' };
  }

  const { data, error } = await supabase.rpc('change_admin_pin', {
    p_admin_id: s.id,
    p_old_pin: oldPin,
    p_new_pin: newPin,
  });

  if (error) return { success: false, error: error.message };
  if (data === true) return { success: true };
  return { success: false, error: 'Ancien PIN incorrect' };
}

export async function logAdminAction(action, targetType, targetId, details) {
  const s = getAdminSession();
  if (!s) return;
  try {
    await supabase.from('admin_logs').insert({
      admin_id: s.id,
      admin_email: s.email,
      action,
      target_type: targetType || null,
      target_id: targetId ? String(targetId) : null,
      details: details || null,
    });
  } catch (e) {}
}
