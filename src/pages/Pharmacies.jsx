import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { getAllPharmacies } from '../lib/supabase';
import TabBar from '../components/TabBar';
import './Pharmacies.css';

export default function Pharmacies() {
  const { navigate } = useNav();
  const [pharmacies, setPharmacies] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const all = await getAllPharmacies();
      setPharmacies(all);
      setLoading(false);
    })();
  }, []);

  const cities = ['all', ...Array.from(new Set(pharmacies.map(p => p.city)))];
  const filtered = filter === 'all' ? pharmacies : pharmacies.filter(p => p.city === filter);

  const openDetail = (id) => {
    navigate({ name: 'pharmacy_detail', params: { id } });
  };

  return (
    <div className="ph-screen page-anim">
      <div className="ph-header">
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1>Pharmacies partenaires</h1>
          <p>{pharmacies.length} partenaires</p>
        </div>
      </div>

      <div className="ph-filters">
        {cities.map(c => (
          <button
            key={c}
            className={'ph-filter ' + (filter === c ? 'active' : '')}
            onClick={() => setFilter(c)}
          >
            {c === 'all' ? 'Toutes' : c}
          </button>
        ))}
      </div>

      <div className="ph-scroll">
        {loading ? (
          <div style={{padding: 40, textAlign: 'center'}}>Chargement…</div>
        ) : (
          filtered.map(p => {
            const waUrl = p.whatsapp ? 'https://wa.me/' + p.whatsapp.replace(/\D/g, '') : null;
            return (
              <div 
                key={p.id} 
                className="ph-card" 
                onClick={() => openDetail(p.id)}
                style={{ cursor: 'pointer' }}
              >
                {p.cover && (
                  <div className="ph-cover" style={{backgroundImage: 'url(' + p.cover + ')'}} />
                )}
                <div className="ph-body">
                  <div className="ph-head">
                    {p.logo && <img src={p.logo} alt="" className="ph-logo" />}
                    <div style={{flex: 1}}>
                      <h3>{p.name}</h3>
                      <div className="ph-meta">📍 {p.neighborhood}, {p.city}</div>
                    </div>
                    {p.rating > 0 && <span className="ph-rating">★ {p.rating}</span>}
                  </div>
                  {p.tagline && <p className="ph-tagline">{p.tagline}</p>}
                  <div className="ph-info-row">🕐 {p.hours}</div>
                  {p.phone && <div className="ph-info-row">📞 {p.phone}</div>}
                  
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    {waUrl && (
                      <a 
                        className="ph-wa" 
                        href={waUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, textAlign: 'center' }}
                      >
                        💬 WhatsApp
                      </a>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); openDetail(p.id); }}
                      style={{ 
                        flex: 1, 
                        padding: '10px 14px', 
                        background: '#1F8B4C', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 8, 
                        fontSize: 13, 
                        fontWeight: 700, 
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      Voir détails →
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div style={{height: 40}} />
      </div>
      <TabBar active="pharmacies" />
    </div>
  );
}