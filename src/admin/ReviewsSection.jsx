import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';

export default function ReviewsSection() {
  const [reviews, setReviews] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('*, products(name, brand, img), users_profile!user_id(first_name, last_name)')
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[ReviewsSection] fetch error:', error.message);
        toast.error('Erreur chargement avis : ' + error.message);
      }
      setReviews(data || []);
    } finally {
      setLoading(false);
    }
  };

  const moderate = async (id, status) => {
    const { error } = await supabase.from('reviews').update({ status }).eq('id', id);
    if (error) {
      toast.error('Erreur modération : ' + error.message);
      return;
    }
    toast.success(status === 'approved' ? 'Avis approuvé ✅' : 'Avis rejeté');
    refresh();
  };

  const filtered = filter === 'all' ? reviews : reviews.filter(r => r.status === filter);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Modération avis</h1>
          <p>{reviews.length} avis · {reviews.filter(r => r.status === 'pending').length} en attente</p>
        </div>
      </header>

      <div className="adm-filters">
        {[
          { id: 'pending', label: '⏳ En attente' },
          { id: 'approved', label: '✅ Approuvés' },
          { id: 'rejected', label: '❌ Rejetés' },
          { id: 'all', label: 'Tous' },
        ].map(f => (
          <button key={f.id} className={`adm-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label} <span className="adm-filter-count">
              {f.id === 'all' ? reviews.length : reviews.filter(r => r.status === f.id).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>⭐</div>
          <p>Aucun avis</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(r => (
            <div key={r.id} className="adm-recent-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {r.products?.img && <img src={r.products.img} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover' }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong>{r.products?.brand} · {r.products?.name}</strong>
                    <span className={`adm-badge ${r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'medium'}`}>{r.status}</span>
                  </div>
                  <p style={{ fontSize: 13, color: '#F4B53A' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} · par {r.users_profile?.first_name || 'Anonyme'}</p>
                  {r.title && <p style={{ fontWeight: 700, marginTop: 6 }}>{r.title}</p>}
                  {r.body && <p style={{ fontSize: 13, marginTop: 4, color: '#1A1A1A' }}>{r.body}</p>}
                  <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 6 }}>
                    {new Date(r.created_at).toLocaleString('fr-FR')}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {r.status !== 'approved' && (
                    <button className="adm-btn-pri" onClick={() => moderate(r.id, 'approved')}>✅ Approuver</button>
                  )}
                  {r.status !== 'rejected' && (
                    <button className="adm-btn-danger" onClick={() => moderate(r.id, 'rejected')}>❌ Rejeter</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
