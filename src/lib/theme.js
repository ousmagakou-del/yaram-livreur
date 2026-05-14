const THEME_KEY = 'yaram_theme';

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
}

export function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  } catch {}
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

if (typeof window !== 'undefined') applyTheme(getTheme());