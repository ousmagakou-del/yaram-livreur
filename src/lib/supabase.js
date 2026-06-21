// ════════════════════════════════════════════════════════════════════
// YARAM — Point d'entrée central Supabase (backward compat)
// ════════════════════════════════════════════════════════════════════
// Ce fichier ne contient PLUS de logique : il ré-exporte tous les domaines
// depuis src/lib/supabase/*.js pour permettre le tree-shaking + un code
// plus maintenable. Tous les imports historiques restent fonctionnels :
//   import { signIn, getMyOrders, ... } from '@/lib/supabase'  → OK
//   import { signIn } from '@/lib/supabase/auth'              → OK (cible directe)
// ════════════════════════════════════════════════════════════════════

export * from './supabase/client';
export * from './supabase/auth';
export * from './supabase/products';
export * from './supabase/categories';
export * from './supabase/brands';
export * from './supabase/pharmacies';
export * from './supabase/orders';
export * from './supabase/addresses';
export * from './supabase/favorites';
export * from './supabase/whatsapp';
export * from './supabase/storage';
export * from './supabase/scans';
export * from './supabase/banners';
export * from './supabase/loyalty';
export * from './supabase/promos';
export * from './supabase/notifications';
