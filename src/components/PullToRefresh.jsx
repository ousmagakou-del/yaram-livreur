// ════════════════════════════════════════════════════════
// YARAM — Pull To Refresh component (v4 — final, listeners sur scroll parent)
// ════════════════════════════════════════════════════════
//
// Stratégie qui marche partout (PWA + Capacitor iOS + Android) :
//   1. Le composant détecte le scroll container parent (yhome-scroll, prof-scroll, etc.)
//   2. Les TOUCH LISTENERS sont attachés au scroll container parent (pas au wrapper)
//      → Aucune dépendance sur le DOM du wrapper, marche même en display:contents
//   3. Le wrapper utilise display:contents au repos (transparent pour flex/grid)
//   4. Switch à display:block UNIQUEMENT quand on pull pour le transform
//
// Usage : place le composant à l'intérieur du scroll container.
//   <div className="yhome-scroll">     ← scroll container natif
//     <PullToRefresh onRefresh={fn}>   ← invisible au layout
//       <content />
//     </PullToRefresh>
//   </div>
// ════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react';

const PULL_THRESHOLD = 80;
const MAX_PULL = 140;
const SPINNER_HEIGHT = 60;

function findScrollParent(el) {
  let node = el?.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (
      /(auto|scroll|overlay)/.test(style.overflowY) ||
      /(auto|scroll|overlay)/.test(style.overflow)
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function getScrollTop(scrollEl) {
  if (scrollEl) return scrollEl.scrollTop || 0;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

export default function PullToRefresh({ onRefresh, children, disabled = false }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(null);
  const anchorRef = useRef(null); // span pour détecter le scroll parent
  const isPulling = useRef(false);

  useEffect(() => {
    if (disabled) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    // Détecte le scroll container parent (yhome-scroll, prof-scroll, ou window)
    const scrollParent = findScrollParent(anchor);
    // Cible où on attache les listeners : le scroll parent (préféré) sinon document
    const target = scrollParent || document;

    const handleTouchStart = (e) => {
      isPulling.current = false;
      const scrollTop = getScrollTop(scrollParent);
      if (scrollTop > 0 || isRefreshing) {
        touchStartY.current = null;
        return;
      }
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e) => {
      if (touchStartY.current === null || isRefreshing) return;

      const deltaY = e.touches[0].clientY - touchStartY.current;

      if (deltaY <= 0) {
        if (isPulling.current) {
          isPulling.current = false;
          setPullDistance(0);
        }
        return;
      }

      // Si on a scrollé entre temps, abandon
      const scrollTop = getScrollTop(scrollParent);
      if (scrollTop > 0) {
        if (isPulling.current) {
          isPulling.current = false;
          setPullDistance(0);
        }
        touchStartY.current = null;
        return;
      }

      let resisted;
      if (deltaY < PULL_THRESHOLD) {
        resisted = deltaY;
      } else {
        const extra = deltaY - PULL_THRESHOLD;
        resisted = PULL_THRESHOLD + extra * 0.4;
      }
      resisted = Math.min(resisted, MAX_PULL);

      // Seuil minimum 8px : on laisse passer les micro-scrolls
      if (resisted < 8) return;

      isPulling.current = true;
      setPullDistance(resisted);

      if (e.cancelable) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = async () => {
      const wasPulling = isPulling.current;
      const finalDistance = pullDistance;
      touchStartY.current = null;
      isPulling.current = false;

      if (!wasPulling || isRefreshing) return;

      const shouldRefresh = finalDistance >= PULL_THRESHOLD;

      if (shouldRefresh && onRefresh) {
        setIsRefreshing(true);
        setPullDistance(SPINNER_HEIGHT);
        try {
          await onRefresh();
        } catch (e) {
          console.warn('[PullToRefresh] onRefresh error:', e?.message);
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    const handleTouchCancel = () => {
      touchStartY.current = null;
      isPulling.current = false;
      if (!isRefreshing) setPullDistance(0);
    };

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', handleTouchEnd, { passive: true });
    target.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
      target.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [pullDistance, isRefreshing, onRefresh, disabled]);

  const isActive = pullDistance > 0 || isRefreshing;

  // wrapper transparent au layout au repos, transformable quand on pull
  const wrapperStyle = isActive
    ? {
        position: 'relative',
        display: 'block',
        transform: `translateY(${pullDistance}px)`,
        transition: pullDistance === 0 || pullDistance === SPINNER_HEIGHT
          ? 'transform 0.25s ease-out'
          : 'none',
        willChange: 'transform',
      }
    : {
        display: 'contents', // INVISIBLE au flex/grid → préserve le layout parent
      };

  const spinnerOpacity = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const readyToRefresh = pullDistance >= PULL_THRESHOLD;
  const spinnerStaticRotation = pullDistance * 3;

  return (
    <>
      {/* Anchor invisible pour détecter le scroll container parent au mount */}
      <span ref={anchorRef} style={{ display: 'none' }} aria-hidden="true" />

      <div style={wrapperStyle}>
        {isActive && (
          <div
            style={{
              position: 'absolute',
              top: -SPINNER_HEIGHT,
              left: 0,
              right: 0,
              height: SPINNER_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: spinnerOpacity,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: `3px solid ${readyToRefresh ? '#1F8B4C' : '#D9D9D9'}`,
                borderTopColor: readyToRefresh ? 'transparent' : '#1F8B4C',
                transform: isRefreshing ? undefined : `rotate(${spinnerStaticRotation}deg)`,
                animation: isRefreshing ? 'ptr-spin 0.8s linear infinite' : 'none',
                background: 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                transition: 'border-color 0.15s',
              }}
            />
          </div>
        )}

        <style>{`
          @keyframes ptr-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>

        {children}
      </div>
    </>
  );
}
