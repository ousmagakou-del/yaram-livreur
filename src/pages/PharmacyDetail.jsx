import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { supabase } from '../lib/supabase';

export default function PharmacyDetail({ pharmacyId }) {
  const { navigate } = useNav();
  const [pharmacy, setPharmacy] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pharmacyId) return;
    (async () => {
      // Pharmacie
      const { data: ph } = await supabase
        .from('pharmacies')
        .select('*')
        .eq('id', pharmacyId)
        .single();
      setPharmacy(ph);

      // Produits dispo dans cette pharmacie - DEBUG
      const { data: inv, error } = await supabase
        .from('inventory')
        .select('product_id, stock, products(*)')
        .eq('pharmacy_id', pharmacyId)
        .gt('stock', 0)
        .eq('active', true);
      
      console.log('Inventory query result:', { count: inv?.length, error, sample: inv?.[0] });

      // Construire la liste des produits, sans filtrer trop
      const productList = (inv || [])
        .filter(i => i.products) // Garder seulement ceux qui ont un produit lié
        .map(i => ({ ...i.products, stock: i.stock }));
      
      console.log('Products after filter:', productList.length);
      
      setProducts(productList);
      setLoading(false);
    })();
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
  const mapsUrl = pharmacy.latitude && pharmacy.longitude
    ? `https://www.google.com/maps/search/?api=1&query=${pharmacy.latitude},${pharmacy.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((pharmacy.address || '') + ' ' + (pharmacy.city || ''))}`;

  const waMessage = `Bonjour ${pharmacy.name} 👋\n\nJe vous écris depuis Diaara. J'aimerais avoir des infos.\n\nMerci 💚`;

  const S = {
    screen: { minHeight: '100vh', background: '#F5F6F8', paddingBottom: 80, fontFamily: 'system-ui, -apple-system, sans-serif' },
    header: { position: 'sticky', top: 0, background: 'white', borderBottom: '1px solid #EEE', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 10 },
    backBtn: { width: 36, height: 36, borderRadius: '50%', background: '#F4F4F2', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: 15, fontWeight: 700, color: '#1A1A1A' },
    
    cover: { position: 'relative', height: 200, background: '#DDD', overflow: 'hidden' },
    coverImg: { width: '100%', height: '100%', objectFit: 'cover' },
    coverGradient: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.6))' },
    coverTitle: { position: 'absolute', bottom: 16, left: 16, right: 16, color: 'white' },
    coverName: { fontSize: 22, fontWeight: 800, marginBottom: 4, textShadow: '0 2px 4px rgba(0,0,0,0.5)' },
    coverLoc: { fontSize: 13, opacity: 0.95 },
    
    section: { background: 'white', margin: '12px 16px', borderRadius: 14, padding: 16, border: '1px solid #EEE' },
    sectionTitle: { fontSize: 14, fontWeight: 800, marginBottom: 12, color: '#1A1A1A' },
    
    infoRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0' },
    infoIcon: { fontSize: 20, flexShrink: 0, width: 28 },
    infoText: { flex: 1, fontSize: 13, color: '#4B4B4B', lineHeight: 1.4 },
    infoLabel: { fontSize: 11, color: '#9B9B9B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 2 },
    
    actionsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 16px', marginTop: 12 },
    actionBtn: { padding: '12px 8px', background: 'white', border: '1px solid #EEE', borderRadius: 12, cursor: 'pointer', textAlign: 'center', textDecoration: 'none', color: '#1A1A1A', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontFamily: 'inherit' },
    actionIcon: { fontSize: 22 },
    actionLabel: { fontSize: 11, fontWeight: 700 },
    
    productGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
    productCard: { background: 'white', border: '1px solid #EEE', borderRadius: 12, padding: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
    productImg: { width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 8, marginBottom: 6, background: '#F4F4F2' },
    productBrand: { fontSize: 10, color: '#6B6B6B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
    productName: { fontSize: 12, fontWeight: 700, color: '#1A1A1A', marginTop: 2, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
    productPrice: { fontSize: 13, fontWeight: 800, color: '#1F8B4C', marginTop: 4 },
    productStock: { fontSize: 10, color: '#1F8B4C', fontWeight: 600, marginTop: 2 },
    
    badge: { display: 'inline-block', background: '#E8F5EC', color: '#166635', padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, marginRight: 6, marginBottom: 4 },
    
    empty: { textAlign: 'center', padding: 40, color: '#9B9B9B', fontSize: 13 },
  };

  return (
    <div style={S.screen}>
      <header style={S.header}>
        <button onClick={() => navigate(-1)} style={S.backBtn}>←</button>
        <div style={S.headerTitle}>Détails pharmacie</div>
      </header>

      <div style={S.cover}>
        {pharmacy.image_url ? (
          <img src={pharmacy.image_url} alt={pharmacy.name} style={S.coverImg} />
        ) : pharmacy.cover ? (
          <img src={pharmacy.cover} alt={pharmacy.name} style={S.coverImg} />
        ) : (
          <div style={{ ...S.coverImg, background: 'linear-gradient(135deg, #1F8B4C, #166635)' }} />
        )}
        <div style={S.coverGradient} />
        <div style={S.coverTitle}>
          <h1 style={S.coverName}>{pharmacy.name}</h1>
          <p style={S.coverLoc}>📍 {pharmacy.neighborhood ? `${pharmacy.neighborhood}, ` : ''}{pharmacy.city}</p>
        </div>
      </div>

      {pharmacy.description && (
        <div style={S.section}>
          <p style={{ fontSize: 13, color: '#4B4B4B', lineHeight: 1.5 }}>
            {pharmacy.description}
          </p>
          {pharmacy.manager_name && (
            <p style={{ fontSize: 12, color: '#1F8B4C', marginTop: 10, fontWeight: 700 }}>
              👨‍⚕️ {pharmacy.manager_name}
            </p>
          )}
        </div>
      )}

      <div style={S.actionsRow}>
        {phone && (
          <a href={`tel:${phone}`} style={S.actionBtn}>
            <span style={S.actionIcon}>📞</span>
            <span style={S.actionLabel}>Appeler</span>
          </a>
        )}
        {whatsapp && (
          <a 
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(waMessage)}`}
            target="_blank" 
            rel="noopener noreferrer" 
            style={{ ...S.actionBtn, background: '#E8F8EC', borderColor: '#25D366' }}
          >
            <span style={S.actionIcon}>💬</span>
            <span style={{ ...S.actionLabel, color: '#166635' }}>WhatsApp</span>
          </a>
        )}
        <a 
          href={mapsUrl}
          target="_blank" 
          rel="noopener noreferrer" 
          style={S.actionBtn}
        >
          <span style={S.actionIcon}>🗺️</span>
          <span style={S.actionLabel}>Itinéraire</span>
        </a>
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>📋 Infos pharmacie</div>

        {pharmacy.address && (
          <div style={S.infoRow}>
            <span style={S.infoIcon}>📍</span>
            <div style={S.infoText}>
              <span style={S.infoLabel}>Adresse</span>
              {pharmacy.address}
              <br />
              {pharmacy.neighborhood ? `${pharmacy.neighborhood}, ` : ''}{pharmacy.city}
            </div>
          </div>
        )}

        {pharmacy.hours && (
          <div style={S.infoRow}>
            <span style={S.infoIcon}>🕐</span>
            <div style={S.infoText}>
              <span style={S.infoLabel}>Horaires d'ouverture</span>
              {pharmacy.hours}
            </div>
          </div>
        )}

        {pharmacy.delivery_hours && (
          <div style={S.infoRow}>
            <span style={S.infoIcon}>🛵</span>
            <div style={S.infoText}>
              <span style={S.infoLabel}>Horaires de livraison</span>
              {pharmacy.delivery_hours}
            </div>
          </div>
        )}

        {pharmacy.phone && (
          <div style={S.infoRow}>
            <span style={S.infoIcon}>📞</span>
            <div style={S.infoText}>
              <span style={S.infoLabel}>Téléphone</span>
              <a href={`tel:${phone}`} style={{ color: '#1F8B4C', textDecoration: 'none', fontWeight: 600 }}>
                {pharmacy.phone}
              </a>
            </div>
          </div>
        )}

        {pharmacy.whatsapp && (
          <div style={S.infoRow}>
            <span style={S.infoIcon}>💬</span>
            <div style={S.infoText}>
              <span style={S.infoLabel}>WhatsApp</span>
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" style={{ color: '#1F8B4C', textDecoration: 'none', fontWeight: 600 }}>
                {pharmacy.whatsapp}
              </a>
            </div>
          </div>
        )}
      </div>

      {(pharmacy.latitude && pharmacy.longitude) && (
        <div style={{ ...S.section, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 16, paddingBottom: 0 }}>
            <div style={S.sectionTitle}>🗺️ Localisation</div>
          </div>
          <a 
            href={mapsUrl}
            target="_blank" 
            rel="noopener noreferrer" 
            style={{ display: 'block', position: 'relative', height: 180, background: '#E8F0FE', textDecoration: 'none' }}
          >
            <iframe
              src={`https://maps.google.com/maps?q=${pharmacy.latitude},${pharmacy.longitude}&z=15&output=embed`}
              style={{ width: '100%', height: '100%', border: 0 }}
              loading="lazy"
              title="Carte"
            />
            <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#1F8B4C', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
              📍 Ouvrir dans Maps
            </div>
          </a>
        </div>
      )}

      <div style={S.section}>
        <div style={S.sectionTitle}>
          🛍️ Produits disponibles ({products.length})
        </div>
        
        {products.length === 0 ? (
          <div style={S.empty}>
            <p>Pas de produits actuellement</p>
          </div>
        ) : (
          <>
            <div style={S.productGrid}>
              {products.slice(0, 20).map(p => (
                <button 
                  key={p.id} 
                  style={S.productCard}
                  onClick={() => navigate({ name: 'product', params: { id: p.id } })}
                >
                  {p.img && <img src={p.img} alt="" style={S.productImg} />}
                  <div style={S.productBrand}>{p.brand}</div>
                  <div style={S.productName}>{p.name}</div>
                  <div style={S.productPrice}>{p.price?.toLocaleString('fr-FR')} FCFA</div>
                  <div style={S.productStock}>✓ {p.stock} en stock</div>
                </button>
              ))}
            </div>

            {products.length > 20 && (
              <button 
                onClick={() => navigate({ name: 'search', params: {} })}
                style={{ width: '100%', padding: 12, marginTop: 12, background: '#F4F4F2', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#1F8B4C', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Voir les {products.length - 20} autres produits →
              </button>
            )}
          </>
        )}
      </div>

      <div style={S.section}>
        <div style={S.sectionTitle}>✅ Garanties Diaara</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span style={S.badge}>✓ Pharmacie agréée</span>
          <span style={S.badge}>✓ Produits authentiques</span>
          <span style={S.badge}>✓ Livraison rapide</span>
          <span style={S.badge}>✓ Commission 8%</span>
        </div>
      </div>
    </div>
  );
}