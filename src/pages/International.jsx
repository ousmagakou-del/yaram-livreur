// ════════════════════════════════════════════════════════
// YARAM — Page "Boutique internationale" (produits import)
// ════════════════════════════════════════════════════════
// Listing dédié pour les produits is_imported = true.
// Délai 15j en moyenne, paiement 50% acompte + 50% solde à l'arrivée.
// ════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useNav } from '../App';
import ProductTile from '../components/ProductTile';
import './International.css';

// Mapping codes pays → emoji + label
const COUNTRIES = {
  US: { flag: '🇺🇸', label: 'États-Unis' },
  FR: { flag: '🇫🇷', label: 'France' },
  UK: { flag: '🇬🇧', label: 'Royaume-Uni' },
  NG: { flag: '🇳🇬', label: 'Nigeria' },
  GH: { flag: '🇬🇭', label: 'Ghana' },
  ZA: { flag: '🇿🇦', label: 'Afrique du Sud' },
  CI: { flag: '🇨🇮', label: 'Côte d\'Ivoire' },
  KR: { flag: '🇰🇷', label: 'Corée du Sud' },
  JP: { flag: '🇯🇵', label: 'Japon' },
};

export default function International() {
  const { navigate } = useNav();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState('all');

  useEffect(() => {
    document.title = 'Boutique internationale | YARAM';
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, brand, category, score, price, review_count, rating, badges, img, active, created_at, is_imported, lead_time_days, origin_country')
          .eq('is_imported', true)
          .eq('active', true)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (mounted) setProducts(data || []);
      } catch (e) {
        console.warn('[International] fetch failed:', e?.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const availableCountries = useMemo(() => {
    const set = new Set();
    products.forEach(p => p.origin_country && set.add(p.origin_country));
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    if (selectedCountry === 'all') return products;
    return products.filter(p => p.origin_country === selectedCountry);
  }, [products, selectedCountry]);

  return (
    <div className="international-page">
      {/* HERO */}
      <div className="intl-hero">
        <button className="intl-back" onClick={() => navigate('/')} aria-label="Retour">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div className="intl-hero-content">
          <h1>🌍 Boutique internationale</h1>
          <p>Tes marques préférées importées des 4 coins du monde</p>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="intl-howit">
        <h2>Comment ça marche ?</h2>
        <div className="intl-steps">
          <div className="intl-step">
            <div className="intl-step-icon">🛒</div>
            <div>
              <strong>1. Tu commandes</strong>
              <p>Tu choisis ton produit et tu payes <strong>50% d'acompte</strong>.</p>
            </div>
          </div>
          <div className="intl-step">
            <div className="intl-step-icon">✈️</div>
            <div>
              <strong>2. On importe pour toi</strong>
              <p>YARAM commande chez le fournisseur et fait venir à Dakar.</p>
            </div>
          </div>
          <div className="intl-step">
            <div className="intl-step-icon">📦</div>
            <div>
              <strong>3. Arrivée à Dakar</strong>
              <p>Tu paies le <strong>solde 50%</strong>, on te livre.</p>
            </div>
          </div>
          <div className="intl-step">
            <div className="intl-step-icon">⏱️</div>
            <div>
              <strong>Délai : 15 jours en moyenne</strong>
              <p>Tu es notifié à chaque étape (commande, transit, arrivée).</p>
            </div>
          </div>
        </div>
      </div>

      {/* FILTRE PAYS */}
      {availableCountries.length > 1 && (
        <div className="intl-filters">
          <button
            className={`intl-filter-chip ${selectedCountry === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCountry('all')}
          >
            🌍 Tout ({products.length})
          </button>
          {availableCountries.map(code => {
            const c = COUNTRIES[code] || { flag: '🌐', label: code };
            const count = products.filter(p => p.origin_country === code).length;
            return (
              <button
                key={code}
                className={`intl-filter-chip ${selectedCountry === code ? 'active' : ''}`}
                onClick={() => setSelectedCountry(code)}
              >
                {c.flag} {c.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* LISTING */}
      <div className="intl-products">
        {loading && (
          <div className="intl-empty">
            <p>Chargement des produits...</p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="intl-empty">
            <div className="intl-empty-icon">📦</div>
            <h3>Aucun produit pour le moment</h3>
            <p>On ajoute régulièrement de nouvelles marques internationales. Reviens bientôt !</p>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="intl-grid">
            {filtered.map(p => (
              <ProductTile key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
