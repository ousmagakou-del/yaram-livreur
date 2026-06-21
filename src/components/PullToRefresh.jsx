// ════════════════════════════════════════════════════════
// YARAM — Pull To Refresh component (v5 — fix iOS Capacitor + listeners stables)
// ════════════════════════════════════════════════════════
//
// Stratégie qui marche partout (PWA + Capacitor iOS + Android) :
//   1. Le composant détecte le scroll container parent (yhome-scroll, prof-scroll, etc.)
//   2. Les TOUCH LISTENERS sont attachés au scroll container parent (pas au wrapper)
//      → Aucune dépendance sur le DOM du wrapper, marche même en display:contents
//   3. Le wrapper utilise display:contents au repos (transparent pour flex/grid)
//   4. Switch à display:block UNIQUEMENT quand on pull pour le transform
//
// FIX v5 (juin 2026) :
//   - Listeners attachés UNE SEULE FOIS au mount (deps stables) au lieu de re-bind
//     à chaque setPullDistance → la swipe ne se faisait pas car les listeners
//     étaient torn down en plein milieu du geste.
//   - State du pull stocké dans des refs (pas dans React state) pour le live tracking,
//     React state seulement pour le render visuel via rAF throttling.
//   - overscroll-behavior-y: contain ajouté sur le scroll parent pour empêcher
//     la bounce native iOS de bouffer le swipe quand on est à scrollTop = 0.
//
// Usage : place le composant à l'intérieur du scroll container.
//   <div className="yhome-scroll">     ← scroll container natif
//     <PullToRefresh onRefresh={fn}>   ← invisible au layout
//       <content />
//     </PullToRefresh>
//   </div>
// ════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react';

const PULL_THRESHOLD = 70;       // 70px (60-80 sweet spot iPhone)
const MAX_PULL = 140;
const SPINNER_HEIGHT = 60;

function findScrollParent(el) {
  let node = el?.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
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
  const anchorRef = useRef(null);

  // ─── Refs pour tracking live du geste (pas de re-bind) ───
  const touchStartY = useRef(null);
  const isPulling = useRef(false);
  const currentPullRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled);
  const rafIdRef = useRef(null);

  // Sync refs avec props (sans re-bind)
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { isRefreshingRef.current = isRefreshing; }, [isRefreshing]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const scrollParent = findScrollParent(anchor);
    const target = scrollParent || document;

    // ─── iOS Safari : overscroll-behavior contain empêche le bounce natif
    // de bouffer le swipe quand on est à scrollTop=0. Critique pour Capacitor WKWebView.
    // On le set sur le scroll parent ET on restore au cleanup.
    let prevOverscroll = '';
    if (scrollParent) {
      try {
        prevOverscroll = scrollParent.style.overscrollBehaviorY || '';
        scrollParent.style.overscrollBehaviorY = 'contain';
        scrollParent.style.webkitOverflowScrolling = 'touch';
      } catch { /* noop */ }
    }

    // ─── Render throttle via rAF ───
    const scheduleRender = (next) => {
      currentPullRef.current = next;
      if (rafIdRef.current != null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        setPullDistance(currentPullRef.current);
      });
    };

    const handleTouchStart = (e) => {
      if (disabledRef.current || isRefreshingRef.current) return;
      isPulling.current = false;
      const scrollTop = getScrollTop(scrollParent);
      if (scrollTop > 0) {
        touchStartY.current = null;
        return;
      }
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e) => {
      if (disabledRef.current || isRefreshingRef.current) return;
      if (touchStartY.current === null) return;

      const deltaY = e.touches[0].clientY - touchStartY.current;

      if (deltaY <= 0) {
        if (isPulling.current) {
          isPulling.current = false;
          scheduleRender(0);
        }
        return;
      }

      // Si on a scrollé entre temps, abandon
      const scrollTop = getScrollTop(scrollParent);
      if (scrollTop > 0) {
        if (isPulling.current) {
          isPulling.current = false;
          scheduleRender(0);
        }
        touchStartY.current = null;
        return;
      }

      // Résistance progressive (rubber-band custom)
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
      scheduleRender(resisted);

      // preventDefault : empêche le scroll natif de prendre le geste
      // Note : sur iOS, certains touchmove sont déjà passive — on protège.
      if (e.cancelable) {
        try { e.preventDefault(); } catch { /* noop iOS strict */ }
      }
    };

    const handleTouchEnd = async () => {
      const wasPulling = isPulling.current;
      const finalDistance = currentPullRef.current;
      touchStartY.current = null;
      isPulling.current = false;

      if (!wasPulling || isRefreshingRef.current) {
        if (currentPullRef.current !== 0) scheduleRender(0);
        return;
      }

      const shouldRefresh = finalDistance >= PULL_THRESHOLD;

      if (shouldRefresh && onRefreshRef.current) {
        // Haptic feedback si dispo (iOS Capacitor)
        try {
          if (navigator?.vibrate) navigator.vibrate(15);
        } catch { /* noop */ }

        isRefreshingRef.current = true;
        setIsRefreshing(true);
        scheduleRender(SPINNER_HEIGHT);
        try {
          await onRefreshRef.current();
        } catch (err) {
          console.warn('[PullToRefresh] onRefresh error:', err?.message);
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          scheduleRender(0);
        }
      } else {
        scheduleRender(0);
      }
    };

    const handleTouchCancel = () => {
      touchStartY.current = null;
      isPulling.current = false;
      if (!isRefreshingRef.current) scheduleRender(0);
    };

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    // touchmove non-passive pour pouvoir preventDefault
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', handleTouchEnd, { passive: true });
    target.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
      target.removeEventListener('touchcancel', handleTouchCancel);
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (scrollParent) {
        try { scrollParent.style.overscrollBehaviorY = prevOverscroll; } catch { /* noop */ }
      }
    };
    // ⚠️ DÉPS VIDES INTENTIONNELLES : on bind les listeners UNE seule fois au mount.
    // Les changements de onRefresh / disabled / isRefreshing passent par les refs
    // (synchronisées dans des useEffect séparés ci-dessus). Ça évite que la swipe
    // se fasse couper en plein milieu par un re-bind quand setPullDistance trigger
    // un re-render de tout le composant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
