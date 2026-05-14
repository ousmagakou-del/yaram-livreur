import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function HistorySection() {
  const [logs, setLogs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [lRes, oRes] = await Promise.all([
        supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('orders').select('id, status, total, created_at').order('created_at', { ascending: false }).limit(50),
      ]);
      setLogs(lRes.data || []);
      setOrders(oRes.data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Historique</h1>
          <p>Journal complet d'activité YARAM</p>
        </div>
      </header>

      <div className="adm-recent-card">
        <h3>📦 Dernières commandes</h3>
        {orders.length === 0 ? (
          <div className="adm-empty" style={{ padding: 20 }}>Pas encore d'activité</div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Commande</th><th>Statut</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id}>
                  <td><code>{o.id}</code></td>
                  <td><span className="adm-badge good">{o.status}</span></td>
                  <td>{o.total?.toLocaleString('fr-FR')} FCFA</td>
                  <td>{new Date(o.created_at).toLocaleString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="adm-recent-card" style={{ marginTop: 16 }}>
        <h3>📜 Actions admin</h3>
        {logs.length === 0 ? (
          <div className="adm-empty" style={{ padding: 20 }}>Aucune action enregistrée</div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th></tr></thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td>{new Date(l.created_at).toLocaleString('fr-FR')}</td>
                  <td>{l.actor || 'Admin'}</td>
                  <td>{l.action}</td>
                  <td>{l.entity} {l.entity_id && <code>{l.entity_id}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
