import { useState, useEffect } from 'react';
import { useNav } from '../App';
import { getMyFavorites } from '../lib/supabase';
import ProductTile from '../components/ProductTile';
import TabBar from '../components/TabBar';

export default function Favorites() {
  const { navigate } = useNav();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyFavorites();
        if (!cancelled) setFavorites(data || []);
      } catch (e) {
        console.warn('[Favorites] load failed:', e?.message);
        if (!cancelled) setFavorites([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page-anim" style={{height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 14, padding: 'calc(var(--safe-top) + 14px) 16px 14px', borderBottom: '1px solid var(--line)'}}>
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <div>
          <h1 style={{fontSize: 20, fontWeight: 700}}>Mes favoris</h1>
          <p style={{fontSize: 12, color: 'var(--ink-soft)'}}>{favorites.length} produit{favorites.length > 1 ? 's' : ''} sauvé{favorites.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      <div style={{flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 'calc(var(--tabbar-height) + 20px)'}}>
        {loading ? (
          <div style={{padding: 40, textAlign: 'center', color: 'var(--ink-soft)'}}>Chargement…</div>
        ) : favorites.length === 0 ? (
          <div style={{padding: 60, textAlign: 'center'}}>
            <div style={{fontSize: 64, opacity: 0.2}}>💚</div>
            <h3 style={{marginTop: 14, fontSize: 18}}>Aucun favori pour l'instant</h3>
            <p style={{fontSize: 13, marginTop: 6, color: 'var(--ink-soft)'}}>Touche le cœur sur un produit pour l'ajouter</p>
            <button className="btn-primary" onClick={() => navigate('/')} style={{maxWidth: 240, marginTop: 24}}>
              Découvrir le catalogue →
            </button>
          </div>
        ) : (
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
            {favorites.map(p => <ProductTile key={p.id} product={p} />)}
          </div>
        )}
      </div>
      <TabBar />
    </div>
  );
}