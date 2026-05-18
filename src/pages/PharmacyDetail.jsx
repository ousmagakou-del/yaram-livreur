import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { supabase } from '../lib/supabase';

const FALLBACK_IMG = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23F4F4F2%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22%231F8B4C%22 font-weight=%22bold%22%3ED%3C/text%3E%3C/svg%3E';

export default function PharmacyDetail({ pharmacyId }) {
  const { navigate } = useNav();
  const [pharmacy, setPharmacy] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!pharmacyId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Securite : on selectionne explicitement les colonnes publiques pour ne pas exposer le PIN
        const { data: ph } = await supabase
          .from('pharmacies')
          .select('id, name, tagline, owner_name, manager_name, city, neighborhood, address, lat, lng, phone, whatsapp, hours, delivery_hours, logo, cover, description, active, rating, review_count')
          .eq('id', pharmacyId).single();
        if (cancelled) return;
        setPharmacy(ph);

        const { data: inv } = await supabase
          .from('inventory').select('product_id, stock, products(*)')
          .eq('pharmacy_id', pharmacyId).gt('stock', 0).eq('active', true);
        if (cancelled) return;

        const list = [];
        (inv || []).forEach(i => {
          if (i.products && i.products.id) list.push({ ...i.products, stock: i.stock });
        });
        setProducts(list);
      } catch (e) {
        console.warn('[PharmacyDetail] load failed:', e?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pharmacyId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement…</div>;
  if (!pharmacy) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p>Pharmacie introuvable</p>
        <button onClick={() => navigate(-1)} style={{ marginTop: 20, padding: '10px 20px', background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>← Retour</button>
      </div>
    );
  }

  const phone = pharmacy.phone?.replace(/\s/g, '') || '';
  const whatsapp = pharmacy.whatsapp?.replace(/\s|\+/g, '') || '';
  
  // ⚠️ FIX: utilise lat/lng (pas latitude/longitude)
  const mapsUrl = pharmacy.lat && pharmacy.lng
    ? `https://www.google.com/maps/search/?api=1&query=${pharmacy.lat},${pharmacy.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((pharmacy.address || '') + ' ' + (pharmacy.city || ''))}`;

  const waMessage = `Bonjour ${pharmacy.name} 👋\n\nJe vous écris depuis YARAM.\n\nMerci 💚`;
  const displayed = showAll ? products : products.slice(0, 20);

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#F5F6F8', paddingBottom: 100, fontFamily: 'system-ui, sans-serif', WebkitOverflowScrolling: 'touch' }}>
      
      <header style={{ position: 'relative', background: 'white', borderBottom: '1px solid #EEE', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{ width: 36, height: 36, borderRadius: '50%', background: '#F4F4F2', border: 'none', cursor: 'pointer', fontSize: 18 }}>←</button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Détails pharmacie</div>
      </header>

      <div style={{ height: 200, background: 'linear-gradient(135deg, #1F8B4C, #166635)', position: 'relative' }}>
        {pharmacy.cover && (
          <img src={pharmacy.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.6))' }} />
        <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, color: 'white' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{pharmacy.name}</h1>
          <p style={{ fontSize: 13, opacity: 0.95, marginTop: 4 }}>📍 {pharmacy.neighborhood ? `${pharmacy.neighborhood}, ` : ''}{pharmacy.city}</p>
        </div>
      </div>

      {(pharmacy.description || pharmacy.tagline) && (
        <div style={{ background: 'white', margin: '12px 16px', borderRadius: 14, padding: 16, border: '1px solid #EEE' }}>
          <p style={{ fontSize: 13, color: '#4B4B4B', lineHeight: 1.5 }}>{pharmacy.description || pharmacy.tagline}</p>
          {pharmacy.manager_name && (
            <p style={{ fontSize: 12, color: '#1F8B4C', marginTop: 10, fontWeight: 700 }}>👨‍⚕️ {pharmacy.manager_name}</p>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 16px', marginTop: 12 }}>
        {phone && (
          <a href={`tel:${phone}`} style={{ padding: '12px 8px', background: 'white', border: '1px solid #EEE', borderRadius: 12, textAlign: 'center', textDecoration: 'none', color: '#1A1A1A', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 22 }}>📞</span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Appeler</span>
          </a>
        )}
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(waMessage)}`} target="_blank" rel="noopener noreferrer" style={{ padding: '12px 8px', background: '#E8F8EC', border: '1px solid #25D366', borderRadius: 12, textAlign: 'center', textDecoration: 'none', color: '#166635', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 22 }}>💬</span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>WhatsApp</span>
          </a>
        )}
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '12px 8px', background: 'white', border: '1px solid #EEE', borderRadius: 12, textAlign: 'center', textDecoration: 'none', color: '#1A1A1A', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 22 }}>🗺️</span>
          <span style={{ fontSize: 11, fontWeight: 700 }}>Itinéraire</span>
        </a>
      </div>

      <div style={{ background: 'white', margin: '12px 16px', borderRadius: 14, padding: 16, border: '1px solid #EEE' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>📋 Infos pharmacie</div>

        {pharmacy.address && (
          <div style={{ display: 'flex', gap: 12, padding: '8px 0', fontSize: 13 }}>
            <span style={{ fontSize: 20 }}>📍</span>
            <div>
              <div style={{ fontSize: 11, color: '#9B9B9B', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Adresse</div>
              {pharmacy.address}<br />{pharmacy.neighborhood ? `${pharmacy.neighborhood}, ` : ''}{pharmacy.city}
            </div>
          </div>
        )}

        {pharmacy.hours && (
          <div style={{ display: 'flex', gap: 12, padding: '8px 0', fontSize: 13 }}>
            <span style={{ fontSize: 20 }}>🕐</span>
            <div>
              <div style={{ fontSize: 11, color: '#9B9B9B', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Horaires</div>
              {pharmacy.hours}
            </div>
          </div>
        )}

        {pharmacy.delivery_hours && (
          <div style={{ display: 'flex', gap: 12, padding: '8px 0', fontSize: 13 }}>
            <span style={{ fontSize: 20 }}>🛵</span>
            <div>
              <div style={{ fontSize: 11, color: '#9B9B9B', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Livraison</div>
              {pharmacy.delivery_hours}
            </div>
          </div>
        )}

        {pharmacy.phone && (
          <div style={{ display: 'flex', gap: 12, padding: '8px 0', fontSize: 13 }}>
            <span style={{ fontSize: 20 }}>📞</span>
            <div>
              <div style={{ fontSize: 11, color: '#9B9B9B', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Téléphone</div>
              <a href={`tel:${phone}`} style={{ color: '#1F8B4C', textDecoration: 'none', fontWeight: 600 }}>{pharmacy.phone}</a>
            </div>
          </div>
        )}
      </div>

      {/* CARTE - FIX: utilise lat/lng */}
      {pharmacy.lat && pharmacy.lng && (
        <div style={{ background: 'white', margin: '12px 16px', borderRadius: 14, overflow: 'hidden', border: '1px solid #EEE' }}>
          <div style={{ padding: '16px 16px 8px', fontSize: 14, fontWeight: 800 }}>🗺️ Localisation</div>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', height: 180, position: 'relative' }}>
            <iframe
              src={`https://maps.google.com/maps?q=${pharmacy.lat},${pharmacy.lng}&z=15&output=embed`}
              style={{ width: '100%', height: '100%', border: 0 }}
              loading="lazy"
              title="Carte"
            />
          </a>
        </div>
      )}

      <div style={{ background: 'white', margin: '12px 16px', borderRadius: 14, padding: 16, border: '1px solid #EEE' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>
          🛍️ Produits disponibles ({products.length})
        </div>
        
        {products.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#9B9B9B', fontSize: 13 }}>
            Pas de produits actuellement
          </div>
        )}

        {products.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {displayed.map((p, idx) => (
              <button
                key={p.id || idx}
                onClick={() => navigate({ name: 'product', params: { id: p.id } })}
                style={{
                  background: 'white', border: '1px solid #EEE', borderRadius: 12,
                  padding: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  display: 'block', width: '100%',
                }}
              >
                <img
                  src={p.img || FALLBACK_IMG}
                  alt={p.name || ''}
                  onError={e => { e.target.onerror = null; e.target.src = FALLBACK_IMG; }}
                  style={{
                    width: '100%', aspectRatio: '1/1', objectFit: 'cover',
                    borderRadius: 8, marginBottom: 6, background: '#F4F4F2', display: 'block',
                  }}
                />
                {p.brand && (
                  <div style={{ fontSize: 10, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase' }}>{p.brand}</div>
                )}
                <div style={{
                  fontSize: 12, fontWeight: 700, color: '#1A1A1A', marginTop: 2,
                  lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: 32,
                }}>{p.name || '—'}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#1F8B4C', marginTop: 4 }}>
                  {(p.price || 0).toLocaleString('fr-FR')} FCFA
                </div>
                <div style={{ fontSize: 10, color: '#1F8B4C', fontWeight: 600, marginTop: 2 }}>
                  ✓ {p.stock} en stock
                </div>
              </button>
            ))}
          </div>
        )}

        {products.length > 20 && !showAll && (
          <button onClick={() => setShowAll(true)} style={{
            width: '100%', padding: 12, marginTop: 12,
            background: '#1F8B4C', color: 'white', border: 'none',
            borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            Voir les {products.length - 20} autres produits ↓
          </button>
        )}
        
        {showAll && products.length > 20 && (
          <button onClick={() => setShowAll(false)} style={{
            width: '100%', padding: 12, marginTop: 12,
            background: '#F4F4F2', color: '#1A1A1A', border: 'none',
            borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            Réduire ↑
          </button>
        )}
      </div>

      <div style={{ background: 'white', margin: '12px 16px', borderRadius: 14, padding: 16, border: '1px solid #EEE' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>✅ Garanties YARAM</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ background: '#E8F5EC', color: '#166635', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>✓ Pharmacie agréée</span>
          <span style={{ background: '#E8F5EC', color: '#166635', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>✓ Produits authentiques</span>
          <span style={{ background: '#E8F5EC', color: '#166635', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>✓ Livraison rapide</span>
        </div>
      </div>
    </div>
  );
}
