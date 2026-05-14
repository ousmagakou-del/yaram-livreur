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

  const { data, error } = await supabase.rpc('verify_admin_pin', {
    p_email: email.trim().toLowerCase(),
    p_pin: pin,
  });

  // Debug visible
  console.log('[adminLogin] RPC result:', { data, error });

  if (error) {
    return { success: false, error: 'Erreur : ' + error.message };
  }

  if (!data || data.length === 0) {
    return { success: false, error: 'Email ou PIN incorrect' };
  }

  const row = data[0];

  // Lecture defensive : essaie plusieurs noms possibles
  const id = pickField(row, 'result_id', 'out_id', 'id', 'admin_id');
  const emailOut = pickField(row, 'result_email', 'out_email', 'email', 'admin_email');
  const name = pickField(row, 'result_name', 'out_name', 'name', 'admin_name');
  const role = pickField(row, 'result_role', 'out_role', 'role', 'admin_role');
  const perms = pickField(row, 'result_permissions', 'out_permissions', 'permissions', 'admin_permissions');

  // Si on n'a pas reussi a recuperer l'essentiel, c'est cass
  if (!id || !role) {
    console.error('[adminLogin] Champs manquants dans la reponse RPC. Row:', row);
    return {
      success: false,
      error: 'Reponse serveur invalide (champs manquants). Contacte le support.'
    };
  }

  const session = {
    id,
    email: emailOut || email,
    name: name || email,
    role,
    permissions: Array.isArray(perms) ? perms : (perms || []),
    expires_at: Date.now() + SESSION_TTL_MS,
  };

  console.log('[adminLogin] Session creee:', session);

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) { /* ignore */ }

  // Log connexion (non bloquant)
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

export function getAdminSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.expires_at || s.expires_at < Date.now()) {
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
