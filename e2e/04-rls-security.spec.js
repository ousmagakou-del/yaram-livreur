import { test, expect } from '@playwright/test';

// Tests de regression RLS : valide que les fuites de donnees sont bien bloquees.
// Anti-regression : si quelqu'un re-introduit une policy "Anyone read" par
// erreur, ces tests le detectent immediatement.

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

async function fetchTable(request, table, select = '*') {
  return request.get(`${SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
}

test.describe('RLS — anti-regression', () => {
  test('anon ne peut PAS lire users_profile', async ({ request }) => {
    const resp = await fetchTable(request, 'users_profile', 'id,email,phone');
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    // Si une fuite reapparait, ce array contiendrait des lignes
    expect(data.length).toBe(0);
  });

  test('anon ne peut PAS lire orders', async ({ request }) => {
    const resp = await fetchTable(request, 'orders', 'id,total,address');
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test('anon ne peut PAS lire commission_payments', async ({ request }) => {
    const resp = await fetchTable(request, 'commission_payments');
    const data = await resp.json();
    // Soit array vide soit erreur RLS
    if (Array.isArray(data)) {
      expect(data.length).toBe(0);
    }
  });

  test('anon ne peut PAS lire audit_log', async ({ request }) => {
    const resp = await fetchTable(request, 'audit_log');
    const data = await resp.json();
    if (Array.isArray(data)) {
      expect(data.length).toBe(0);
    }
  });

  test('anon ne peut PAS lire push_subscriptions', async ({ request }) => {
    const resp = await fetchTable(request, 'push_subscriptions');
    const data = await resp.json();
    if (Array.isArray(data)) {
      expect(data.length).toBe(0);
    }
  });

  test('anon ne peut PAS lire staff', async ({ request }) => {
    const resp = await fetchTable(request, 'staff');
    const data = await resp.json();
    if (Array.isArray(data)) {
      expect(data.length).toBe(0);
    }
  });

  test('anon PEUT lire produits (catalogue public)', async ({ request }) => {
    const resp = await fetchTable(request, 'products', 'id,name', '&limit=3');
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  test('anon PEUT lire pharmacies sans le pin', async ({ request }) => {
    const resp = await fetchTable(request, 'pharmacies', 'id,name,city');
    const data = await resp.json();
    expect(Array.isArray(data)).toBe(true);

    // Tente de lire pin → doit echouer ou retourner sans le pin
    const pinResp = await fetchTable(request, 'pharmacies', 'id,pin');
    // Soit 403/permission denied, soit retourne null pour pin
    if (pinResp.ok()) {
      const pinData = await pinResp.json();
      pinData.forEach(row => {
        expect(row.pin == null || row.pin === undefined).toBe(true);
      });
    } else {
      expect([400, 401, 403, 406]).toContain(pinResp.status());
    }
  });

  test('anon ne peut PAS UPDATE pharmacies.pin', async ({ request }) => {
    const resp = await request.patch(`${SUPABASE_URL}/rest/v1/pharmacies?id=eq.00000000-0000-0000-0000-000000000000`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      data: { pin: '9999' },
    });
    // 401/403 attendu (column-level GRANT bloque)
    expect([401, 403, 404, 400]).toContain(resp.status());
  });

  test('anon ne peut PAS INSERT product', async ({ request }) => {
    const resp = await request.post(`${SUPABASE_URL}/rest/v1/products`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      data: { name: 'HACK_TEST', price: 0 },
    });
    expect([401, 403]).toContain(resp.status());
  });
});
