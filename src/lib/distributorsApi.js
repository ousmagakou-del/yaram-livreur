// ════════════════════════════════════════════════════════════════════
// YARAM — API Distributeurs
// ════════════════════════════════════════════════════════════════════
// Helpers pour le dashboard distributeur (admin + vue publique par token).
// ════════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

const compressImage = async (file, maxDim = 600, quality = 0.85) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// ─── CRUD distributors ────────────────────────────────────────────
export async function listDistributors() {
  const { data, error } = await supabase
    .from('distributors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchDistributor(id) {
  const { data, error } = await supabase
    .from('distributors')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createDistributor(payload) {
  const { data, error } = await supabase
    .from('distributors')
    .insert([payload])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDistributor(id, patch) {
  const { data, error } = await supabase
    .from('distributors')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDistributor(id) {
  const { error } = await supabase
    .from('distributors')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// Génère un token aléatoire côté client (32 chars hex)
export function generateDashboardToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Upload logo distributeur (bucket distributor-logos, fallback brand-logos) ──
export async function uploadDistributorLogo(file) {
  if (!file) throw new Error('Aucun fichier fourni');
  const compressed = await compressImage(file, 600, 0.88);
  if (!compressed) throw new Error('Image vide après compression');
  const fileName = `distributor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const buckets = ['distributor-logos', 'brand-logos', 'banner-images'];
  let lastErr = null;
  for (const bucket of buckets) {
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(fileName, compressed, { contentType: 'image/jpeg', upsert: true });
    if (!upErr) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
      if (data?.publicUrl) return data.publicUrl;
      lastErr = new Error('URL publique introuvable');
      continue;
    }
    lastErr = upErr;
    // Si le bucket n'existe pas, on tente le suivant
    if (!/bucket.*not.*found/i.test(upErr.message)) break;
  }
  throw new Error(lastErr?.message || 'Upload échoué');
}

// ─── Analytics ────────────────────────────────────────────────────
export async function getBrandAnalytics(brandIds, daysBack = 30) {
  if (!Array.isArray(brandIds) || brandIds.length === 0) return [];
  const { data, error } = await supabase.rpc('distributor_brand_analytics', {
    p_brand_ids: brandIds,
    p_days_back: daysBack,
  });
  if (error) throw error;
  return data || [];
}

// ─── Prospection (pharmas non-partenaires) ────────────────────────
// Préfère la RPC server-side (un seul round-trip + jointure côté DB).
// Fallback : agrégation côté client si la RPC échoue.
export async function getProspectionOpportunities(distributorIdOrBrands, daysBack = 30) {
  let brandIds = distributorIdOrBrands;
  if (typeof distributorIdOrBrands === 'string') {
    const distributor = await fetchDistributor(distributorIdOrBrands);
    brandIds = distributor?.brands || [];
  }
  if (!Array.isArray(brandIds) || brandIds.length === 0) return [];

  // 1) RPC server-side
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    'distributor_prospection_opportunities',
    { p_brand_ids: brandIds, p_days_back: daysBack }
  );
  if (!rpcErr && Array.isArray(rpcData)) {
    return rpcData.map(r => ({
      name: r.pharmacy_name,
      lat: r.pharmacy_lat,
      lng: r.pharmacy_lng,
      scans: Number(r.scans) || 0,
      products: r.products || [],
      lastScanAt: r.last_scan_at,
    }));
  }

  // 2) Fallback client-side (au cas où la RPC n'existe pas encore)
  const sinceIso = new Date(Date.now() - daysBack * 86400000).toISOString();
  const { data } = await supabase
    .from('driver_sourcing_scans')
    .select('pharmacy_name, pharmacy_lat, pharmacy_lng, product_id, scanned_at, products(name, brand_id)')
    .is('pharmacy_id', null)
    .gte('scanned_at', sinceIso);

  const filtered = (data || []).filter(s => brandIds.includes(s.products?.brand_id));
  const grouped = {};
  filtered.forEach(s => {
    const key = s.pharmacy_name || 'Inconnue';
    if (!grouped[key]) grouped[key] = {
      name: s.pharmacy_name || 'Inconnue',
      lat: s.pharmacy_lat,
      lng: s.pharmacy_lng,
      scans: 0,
      products: new Set(),
      lastScanAt: s.scanned_at,
    };
    grouped[key].scans++;
    if (s.products?.name) grouped[key].products.add(s.products.name);
    if (s.scanned_at > (grouped[key].lastScanAt || '')) grouped[key].lastScanAt = s.scanned_at;
  });

  return Object.values(grouped)
    .map(g => ({ ...g, products: Array.from(g.products) }))
    .sort((a, b) => b.scans - a.scans);
}

// ─── Top pharmas partenaires ──────────────────────────────────────
export async function getTopPartnerPharmacies(brandIds, daysBack = 30) {
  if (!Array.isArray(brandIds) || brandIds.length === 0) return [];
  const { data, error } = await supabase.rpc('distributor_top_partner_pharmacies', {
    p_brand_ids: brandIds,
    p_days_back: daysBack,
  });
  if (error) {
    console.warn('[getTopPartnerPharmacies] RPC failed:', error.message);
    return [];
  }
  return (data || []).map(r => ({
    id: r.pharmacy_id,
    name: r.pharmacy_name,
    neighborhood: r.neighborhood,
    partnershipTier: r.partnership_tier,
    totalOrders: Number(r.total_orders) || 0,
    totalRevenue: Number(r.total_revenue_fcfa) || 0,
  }));
}

// ─── Vue publique par token (sans login admin) ───────────────────
export async function fetchDistributorByToken(token) {
  if (!token) return null;
  const { data, error } = await supabase.rpc('get_distributor_by_token', { p_token: token });
  if (error) {
    console.error('[fetchDistributorByToken]', error.message);
    return null;
  }
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

// ─── Brands lookup util ───────────────────────────────────────────
export async function getBrandsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, img')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

// ─── Format util ──────────────────────────────────────────────────
export function formatFcfa(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('fr-FR') + ' FCFA';
}
