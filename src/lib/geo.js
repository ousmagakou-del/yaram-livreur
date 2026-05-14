// ════════════════════════════════════════════════
// YARAM — Helpers géolocalisation
// ════════════════════════════════════════════════

// Calcul distance Haversine (en km) entre 2 points GPS
export function haversineDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return Infinity;
  
  const R = 6371; // Rayon Terre en km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// Format distance pour affichage
export function formatDistance(km) {
  if (km === Infinity || km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// Demander la position GPS de l'utilisateur
// Retourne {lat, lng} ou null si refusé/erreur
export function getUserPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      console.log('[Geo] Geolocation not supported');
      resolve(null);
      return;
    }
    
    const timeoutId = setTimeout(() => {
      console.log('[Geo] Position request timeout');
      resolve(null);
    }, timeout);
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeoutId);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => {
        clearTimeout(timeoutId);
        console.log('[Geo] Position error:', err.message);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout, maximumAge: 600000 }
    );
  });
}

// Trier pharmacies par distance depuis user
export function sortByDistance(pharmacies, userLat, userLng) {
  if (!userLat || !userLng) return pharmacies;
  
  return pharmacies
    .map(p => ({
      ...p,
      distance: haversineDistance(userLat, userLng, p.lat, p.lng),
    }))
    .sort((a, b) => a.distance - b.distance);
}

// Vérifier l'état de la permission (sans la demander)
export async function getPermissionState() {
  if (!('permissions' in navigator)) return 'unknown';
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state; // 'granted', 'denied', 'prompt'
  } catch (e) {
    return 'unknown';
  }
}
