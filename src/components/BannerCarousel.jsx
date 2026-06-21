import { useState, useEffect, useRef, memo } from 'react';
import { useNav } from '../App';
import { getActiveBanners, incrementBannerClick } from '../lib/supabase';
import './BannerCarousel.css';

const AUTO_SCROLL_MS = 5000; // 5 secondes

function BannerCarousel() {
  const { navigate } = useNav();
  const [banners, setBanners] = useState([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef(null);
  const startXRef = useRef(null);

  useEffect(() => {
    (async () => {
      const data = await getActiveBanners();
      setBanners(data);
    })();
  }, []);

  useEffect(() => {
    if (banners.length <= 1 || paused) return;
    intervalRef.current = setInterval(() => {
      setCurrent(c => (c + 1) % banners.length);
    }, AUTO_SCROLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [banners.length, paused]);

  const handleClick = async (banner) => {
    if (!banner.link_type || banner.link_type === 'none') return;
    
    // Track click
    incrementBannerClick(banner.id);
    
    if (banner.link_type === 'product' && banner.link_target) {
      navigate({ name: 'product', params: { id: banner.link_target } });
    } else if (banner.link_type === 'pharmacy') {
      navigate({ name: 'pharmacies' });
    } else if (banner.link_type === 'category' && banner.link_target) {
      navigate({ name: 'search', params: { category: banner.link_target } });
    } else if (banner.link_type === 'scan') {
      navigate('scan');
    } else if (banner.link_type === 'external' && banner.link_target) {
      window.open(banner.link_target, '_blank');
    }
  };

  const handleSwipeStart = (e) => {
    setPaused(true);
    startXRef.current = e.touches?.[0]?.clientX || e.clientX;
  };

  const handleSwipeEnd = (e) => {
    if (startXRef.current === null) { setPaused(false); return; }
    const endX = e.changedTouches?.[0]?.clientX || e.clientX;
    const diff = startXRef.current - endX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        // Swipe gauche = suivant
        setCurrent(c => (c + 1) % banners.length);
      } else {
        // Swipe droit = précédent
        setCurrent(c => (c - 1 + banners.length) % banners.length);
      }
    }
    startXRef.current = null;
    setTimeout(() => setPaused(false), 1500);
  };

  if (banners.length === 0) return null;

  const banner = banners[current];

  return (
    <div className="bc-wrap">
      <div
        className="bc-banner"
        style={{
          backgroundColor: banner.bg_color || '#1F8B4C',
          color: banner.text_color || '#FFFFFF',
        }}
        onClick={() => handleClick(banner)}
        onMouseDown={handleSwipeStart}
        onMouseUp={handleSwipeEnd}
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        role={banner.link_type && banner.link_type !== 'none' ? 'button' : undefined}
      >
        <div className="bc-content">
          {banner.sponsor_name && (
            <span className="bc-sponsor">{banner.sponsor_name}</span>
          )}
          <h3>{banner.title}</h3>
          {banner.subtitle && <p>{banner.subtitle}</p>}
          {banner.cta_text && banner.link_type !== 'none' && (
            <button className="bc-cta">
              {banner.cta_text} →
            </button>
          )}
        </div>
        {banner.image_url && (
          <div className="bc-image">
            <img src={banner.image_url} alt={banner.title || 'Promo YARAM'} loading="lazy" decoding="async" onError={(e) => e.target.style.display = 'none'} />
          </div>
        )}
      </div>
      
      {banners.length > 1 && (
        <div className="bc-dots">
          {banners.map((_, i) => (
            <button
              key={i}
              className={`bc-dot ${i === current ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setCurrent(i); setPaused(true); setTimeout(() => setPaused(false), 3000); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// PERF : memo — BannerCarousel n'a pas de props, donc tout re-render parent
// déclencherait inutilement un cycle complet (carousel rotate + state).
export default memo(BannerCarousel);
