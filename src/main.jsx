import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/theme'
import './index.css'
import App from './App.jsx'
import { loadSiteSettings, subscribeSettings } from './lib/supabase'

// Load les site_settings en BG des le boot (commission, deliveryFee, couleurs…)
// Le rendu n'attend PAS : on a un fallback hardcode, donc l'app demarre instantanement
// et applique les vraies valeurs des qu'elles arrivent (via getCachedSetting).
loadSiteSettings().catch(() => { /* DB unavailable, keep fallback */ });

// Inject les couleurs en CSS variables des que les settings sont chargees.
// Cible les noms reels utilises dans src/index.css (--primary, --accent).
subscribeSettings((s) => {
  if (!s) return;
  const root = document.documentElement;
  if (s.primaryColor) root.style.setProperty('--primary', s.primaryColor);
  if (s.accentColor) root.style.setProperty('--accent', s.accentColor);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)