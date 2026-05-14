import { useState } from 'react';
import { supabase } from '../lib/supabase';

const SUPABASE_URL = 'https://qxhhnrnworwrnwmqekmb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw';

export default function PiSpiTest() {
  const [accountNumber, setAccountNumber] = useState('70736465014827148510');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [currentAction, setCurrentAction] = useState('');
  const [aliasType, setAliasType] = useState('telephone');
  const [aliasValue, setAliasValue] = useState('221777608983');

  const callGateway = async (action, params = {}) => {
    setLoading(true);
    setCurrentAction(action);
    setResult(null);
    
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/pi-spi-gateway`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...params }),
      });
      
      const data = await response.json();
      setResult({ status: response.status, data });
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  const S = {
    screen: { minHeight: '100vh', background: '#F5F6F8', padding: 20, fontFamily: 'system-ui, sans-serif' },
    container: { maxWidth: 700, margin: '0 auto' },
    header: { background: 'linear-gradient(135deg, #1F8B4C, #166635)', color: 'white', padding: 20, borderRadius: 14, marginBottom: 16 },
    title: { fontSize: 22, fontWeight: 800, marginBottom: 4 },
    subtitle: { fontSize: 13, opacity: 0.9 },
    section: { background: 'white', borderRadius: 14, padding: 16, marginBottom: 12, border: '1px solid #EEE' },
    sectionTitle: { fontSize: 14, fontWeight: 800, marginBottom: 12 },
    label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12, marginBottom: 6 },
    input: { width: '100%', padding: 10, border: '1px solid #DDD', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' },
    btn: { padding: '12px 16px', background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', margin: '4px 4px 4px 0' },
    btnSec: { padding: '12px 16px', background: '#F4F4F2', color: '#1A1A1A', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', margin: '4px 4px 4px 0' },
    result: { background: '#1A1A1A', color: '#0F0', padding: 14, borderRadius: 8, fontSize: 11, fontFamily: 'Menlo, Monaco, monospace', overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
    error: { background: '#FCE9E7', color: '#D9342B', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 },
    success: { background: '#E8F5EC', color: '#1F8B4C', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 },
  };

  return (
    <div style={S.screen}>
      <div style={S.container}>
        <div style={S.header}>
          <div style={S.title}>🏦 PI-SPI BCEAO Test</div>
          <div style={S.subtitle}>Sandbox · YARAM Gateway</div>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>⚙️ Configuration</div>
          <label style={S.label}>Numéro de compte sandbox</label>
          <input
            style={S.input}
            value={accountNumber}
            onChange={e => setAccountNumber(e.target.value)}
            placeholder="70736465014827148510"
          />
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>🔐 Étape 1 — Test OAuth2</div>
          <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 8 }}>
            Vérifie que tes clés Client ID + Secret marchent
          </p>
          <button onClick={() => callGateway('test_auth')} disabled={loading} style={S.btn}>
            {loading && currentAction === 'test_auth' ? '⏳ Connexion...' : '🔐 Tester OAuth2'}
          </button>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>💰 Étape 2 — Vérifier compte</div>
          <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 8 }}>
            Récupère les infos du compte sandbox
          </p>
          <button onClick={() => callGateway('check_balance', { accountNumber })} disabled={loading} style={S.btn}>
            {loading && currentAction === 'check_balance' ? '⏳' : '💰 Voir compte'}
          </button>
          <button onClick={() => callGateway('list_aliases', { accountNumber })} disabled={loading} style={S.btn}>
            {loading && currentAction === 'list_aliases' ? '⏳' : '📋 Lister alias'}
          </button>
          <button onClick={() => callGateway('list_operations', { accountNumber })} disabled={loading} style={S.btn}>
            {loading && currentAction === 'list_operations' ? '⏳' : '📊 Lister opérations'}
          </button>
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>➕ Étape 3 — Créer alias</div>
          <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 8 }}>
            Permet de recevoir des paiements via téléphone/email
          </p>
          
          <label style={S.label}>Type d'alias</label>
          <select style={S.input} value={aliasType} onChange={e => setAliasType(e.target.value)}>
            <option value="telephone">Téléphone</option>
            <option value="email">Email</option>
            <option value="qrcode">QR Code</option>
          </select>
          
          <label style={S.label}>Valeur</label>
          <input
            style={S.input}
            value={aliasValue}
            onChange={e => setAliasValue(e.target.value)}
            placeholder="221777608983"
          />
          
          <div style={{ marginTop: 12 }}>
            <button 
              onClick={() => callGateway('create_alias', { accountNumber, aliasType, aliasValue })} 
              disabled={loading}
              style={S.btn}
            >
              {loading && currentAction === 'create_alias' ? '⏳' : '➕ Créer alias'}
            </button>
          </div>
        </div>

        {result && (
          <div style={S.section}>
            <div style={S.sectionTitle}>
              📋 Résultat 
              {result.status && (
                <span style={{ 
                  marginLeft: 8, 
                  padding: '2px 8px', 
                  borderRadius: 999, 
                  fontSize: 11,
                  background: result.status >= 200 && result.status < 300 ? '#E8F5EC' : '#FCE9E7',
                  color: result.status >= 200 && result.status < 300 ? '#1F8B4C' : '#D9342B',
                }}>
                  HTTP {result.status}
                </span>
              )}
            </div>
            <div style={S.result}>{JSON.stringify(result, null, 2)}</div>
          </div>
        )}

        <div style={{ fontSize: 11, color: '#9B9B9B', textAlign: 'center', marginTop: 16 }}>
          YARAM · PI-SPI Sandbox Tester · v1.0
        </div>
      </div>
    </div>
  );
}
