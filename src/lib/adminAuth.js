// src/lib/adminAuth.js
// Gestion de l'authentification admin via Supabase RPC + sessionStorage
//
// ⚠️ La vérification du PIN se fait CÔTÉ SERVEUR via la fonction Postgres
// `verify_admin_pin` qui compare un hash bcrypt. Le PIN n'est JAMAIS stocké
// en clair côté client.

import { supabase } from './supabase';

const SESSION_KEY = 'diaara-admin-session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

// ─── Login : appelle la RPC Postgres ───
export async function adminLogin(email, pin) {
  if (!email || !pin) {
    return { success: false, error: 'Email et PIN requis' };
  }

  const { data, error } = await supabase.rpc('verify_admin_pin', {
    p_email: email.trim().toLowerCase(),
    p_pin: pin,
  });

  if (error) {
    return { success: false, error: 'Erreur : ' + error.message };
  }

  // La fonction renvoie un tableau (0 ou 1 ligne)
  if (!data || data.length === 0) {
    return { success: false, error: 'Email ou PIN incorrect' };
  }

  const admin = data[0];
  const session = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    permissions: admin.permissions || [],
    expires_at: Date.now() + SESSION_TTL_MS,
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) { /* ignore */ }

  // Log de connexion
  try {
    await supabase.from('admin_logs').insert({
      admin_id: admin.id,
      admin_email: admin.email,
      action: 'login',
      user_agent: navigator.userAgent,
    });
  } catch (e) { /* non bloquant */ }

  return { success: true, admin: session };
}

// ─── Logout ───
export async function adminLogout() {
  const s = getAdminSession();
  if (s) {
    try {
      await supabase.from('admin_logs').insert({
        admin_id: s.id,
        admin_email: s.email,
        action: 'logout',
      });
    } catch (e) { /* ignore */ }
  }
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

// ─── Session courante (null si expirée ou absente) ───
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

// ─── Permissions ───
// Vérifie qu'un admin a accès à une section donnée
export function hasPermission(session, sectionId) {
  if (!session) return false;
  const perms = session.permissions || [];
  // Super-admin a "*" = tout
  if (perms.includes('*')) return true;
  return perms.includes(sectionId);
}

// ─── Change PIN (RPC sécurisée) ───
export async function changeAdminPin(oldPin, newPin) {
  const s = getAdminSession();
  if (!s) return { success: false, error: 'Pas de session active' };

  if (!newPin || newPin.length < 4) {
    return { success: false, error: 'Nouveau PIN trop court (4 chiffres min)' };
  }
  const banned = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123'];
  if (banned.includes(newPin)) {
    return { success: false, error: 'PIN trop évident' };
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

// ─── Logger une action admin (utile pour audit) ───
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
  } catch (e) { /* non bloquant */ }
}
