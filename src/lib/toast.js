// src/lib/toast.js
// ─────────────────────────────────────────────────────────────────────────────
// Mini systeme de toast + confirm dialog pour remplacer les alert()/confirm() natifs.
//
// USAGE
//   import { toast, confirmDialog } from './lib/toast';
//   toast.success('Sauvegardé');
//   toast.error('Échec : ' + e.message);
//   toast.info('Code copié dans le presse-papier');
//   if (await confirmDialog('Supprimer cet article ?')) { ... }
//
// L'UI est rendue par <Toaster /> qu'on monte UNE seule fois a la racine de l'app
// (App.jsx). Aucun provider/context : c'est un pub/sub leger.
// ─────────────────────────────────────────────────────────────────────────────

let id = 0;
const listeners = new Set();
let state = { toasts: [], confirm: null, prompt: null };

function publish() {
  for (const l of listeners) l(state);
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(state); // sync initial
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

// ─── TOASTS ────────────────────────────────────────────────────────────────
function pushToast(kind, message, opts = {}) {
  const t = {
    id: ++id,
    kind,                                 // 'success' | 'error' | 'info'
    message: String(message ?? ''),
    duration: opts.duration ?? (kind === 'error' ? 5000 : 3000),
  };
  state = { ...state, toasts: [...state.toasts, t] };
  publish();
  if (t.duration > 0) {
    setTimeout(() => dismissToast(t.id), t.duration);
  }
  return t.id;
}

export function dismissToast(tid) {
  state = { ...state, toasts: state.toasts.filter(t => t.id !== tid) };
  publish();
}

export const toast = {
  success: (m, opts) => pushToast('success', m, opts),
  error:   (m, opts) => pushToast('error', m, opts),
  info:    (m, opts) => pushToast('info', m, opts),
};

// ─── CONFIRM DIALOG (Promise-based) ────────────────────────────────────────
export function confirmDialog(message, opts = {}) {
  // Si un autre confirm est en cours, on resout le precedent a false
  if (state.confirm) {
    state.confirm.resolve(false);
  }
  return new Promise((resolve) => {
    state = {
      ...state,
      confirm: {
        message: String(message ?? ''),
        confirmLabel: opts.confirmLabel || 'Confirmer',
        cancelLabel: opts.cancelLabel || 'Annuler',
        danger: !!opts.danger,
        resolve,
      },
    };
    publish();
  });
}

export function resolveConfirm(value) {
  if (!state.confirm) return;
  const r = state.confirm.resolve;
  state = { ...state, confirm: null };
  publish();
  r(value);
}

// ─── PROMPT DIALOG (Promise<string|null>) ──────────────────────────────────
// usage: const r = await promptDialog('Motif du rejet ?', { multiline: true });
//        if (r === null) { /* cancelled */ } else { /* r est la string */ }
export function promptDialog(message, opts = {}) {
  if (state.prompt) state.prompt.resolve(null);
  return new Promise((resolve) => {
    state = {
      ...state,
      prompt: {
        message: String(message ?? ''),
        placeholder: opts.placeholder || '',
        initialValue: opts.initialValue || '',
        multiline: !!opts.multiline,
        confirmLabel: opts.confirmLabel || 'Valider',
        cancelLabel: opts.cancelLabel || 'Annuler',
        // Validation : si fournie, doit retourner true pour pouvoir valider
        validate: opts.validate || null,
        // requiredText : si non-null, l'utilisateur doit taper exactement ce texte
        requiredText: opts.requiredText || null,
        danger: !!opts.danger,
        resolve,
      },
    };
    publish();
  });
}

export function resolvePrompt(value) {
  if (!state.prompt) return;
  const r = state.prompt.resolve;
  state = { ...state, prompt: null };
  publish();
  r(value);
}
