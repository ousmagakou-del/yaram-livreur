// ════════════════════════════════════════════════════════════════════
// YARAM — Vue publique distributeur (sans login)
// ════════════════════════════════════════════════════════════════════
// URL : /admin/distributor-view?token=XXX
//
// Lit le token depuis l'URL, charge le distributeur via RPC
// `get_distributor_by_token` (SECURITY DEFINER), puis affiche le même
// dashboard que dans l'admin mais en lecture seule.
//
// C'est le lien à envoyer à Bonfoni & co pour qu'ils voient leurs stats
// sans avoir besoin d'un compte admin YARAM.
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { fetchDistributorByToken } from '../lib/distributorsApi';
import DistributorDashboard from '../admin/DistributorDashboard';

export default function DistributorView() {
  const [distributor, setDistributor] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | invalid

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (!token) { setStatus('invalid'); return; }
        const d = await fetchDistributorByToken(token);
        if (!d) { setStatus('invalid'); return; }
        setDistributor(d);
        setStatus('ok');
      } catch (e) {
        console.error('[DistributorView]', e);
        setStatus('invalid');
      }
    })();
  }, []);

  if (status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #F8FAF7 0%, #EAF5EE 100%)',
      }}>
        <div style={{ textAlign: 'center', color: '#1F8B4C' }}>
          <div style={{
            width: 36, height: 36,
            borderRadius: '50%',
            border: '3px solid rgba(31, 139, 76, 0.12)',
            borderTopColor: '#1F8B4C',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Chargement de votre dashboard…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #F8FAF7 0%, #EAF5EE 100%)',
        padding: 20,
      }}>
        <div style={{
          background: 'white',
          padding: 32,
          borderRadius: 16,
          border: '1px solid #EEE',
          textAlign: 'center',
          maxWidth: 420,
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1A1A1A', marginBottom: 8 }}>
            Lien invalide ou expiré
          </h1>
          <p style={{ fontSize: 13, color: '#6B6B6B', lineHeight: 1.5 }}>
            Ce lien dashboard distributeur n'est pas valide. Contactez l'équipe YARAM
            pour qu'un nouveau lien vous soit envoyé.
          </p>
          <div style={{ marginTop: 20 }}>
            <a href="/" style={{
              display: 'inline-block', padding: '10px 18px',
              background: '#1F8B4C', color: 'white',
              borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 13,
            }}>← Retour à YARAM</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAF7' }}>
      {/* Bandeau publique */}
      <div style={{
        background: 'linear-gradient(135deg, #1F8B4C 0%, #166635 100%)',
        color: 'white',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }} className="dist-no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 18,
          }}>Y</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>YARAM × {distributor.name}</div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Dashboard partenaire confidentiel</div>
          </div>
        </div>
        <div style={{ fontSize: 11, opacity: 0.9 }}>
          🔐 Accès sécurisé par token unique
        </div>
      </div>

      <main className="adm-main" style={{ background: '#F8FAF7' }}>
        <DistributorDashboard distributor={distributor} readOnly={true} />
      </main>
    </div>
  );
}
