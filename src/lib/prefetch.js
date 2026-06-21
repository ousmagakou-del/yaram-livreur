// ════════════════════════════════════════════════════════════════
// YARAM — Prefetch des chunks probables après idle
// ════════════════════════════════════════════════════════════════
//
// Déclenche le download des routes les plus susceptibles d'être ouvertes
// depuis la Home (Search, Product, Cart, Profile) pendant le temps
// d'inactivité réseau du navigateur.
//
// Stratégie :
//  - Attendre 3s après le mount (laisser la Home charger ses données)
//  - Utiliser requestIdleCallback (Chrome/Edge) sinon setTimeout (Safari)
//  - Annuler si l'utilisateur navigue avant la fin (les imports déjà
//    déclenchés finiront mais on ne lance plus rien d'autre)
//  - Skip totalement si NetworkInformation.saveData=true ou effectiveType slow
// ════════════════════════════════════════════════════════════════

let prefetched = false;

export function prefetchProbableRoutes() {
  if (prefetched) return;
  prefetched = true;

  // Respect du "Data Saver" navigateur + des connexions trop lentes
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /^(slow-2g|2g)$/.test(conn.effectiveType)) return;
  } catch { /* no NetworkInformation API */ }

  const schedule = (fn, delay = 0) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => setTimeout(fn, delay), { timeout: 5000 });
    } else {
      setTimeout(fn, delay + 1000);
    }
  };

  // Note : Home/Search/Product/Cart/Profile/Categories sont importes
  // statiquement dans App.jsx → deja dans le bundle initial.
  // On prefetch ICI uniquement les routes vraiment lazy() qui valent
  // la peine d'etre preparees avant que l'user clique :
  //   - International : 20 kB, ouvert depuis Home (banner "Boutique intl")
  //   - OrderTracking : 21 kB, ouvert apres "J'ai paye" en checkout

  // T+3s : International (banner Home le promeut systematiquement)
  schedule(() => {
    import('../pages/International.jsx').catch(() => {});
  }, 3000);

  // T+5s : OrderTracking (probable apres checkout)
  schedule(() => {
    import('../pages/OrderTracking.jsx').catch(() => {});
  }, 5000);
}
