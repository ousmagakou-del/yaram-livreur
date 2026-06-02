import { Component } from 'react';
import { captureException } from '../lib/sentry';

// ─────────────────────────────────────────────────────────────────────────────
// <ErrorBoundary /> : capture les erreurs React qui blanchissent les pages.
// Avant : une exception dans une page (cart malformé, props manquantes…)
// fait unmount silencieux → ECRAN BLANC sans aucun log côté user.
// Maintenant : on affiche un fallback visible + bouton "Recharger".
// ─────────────────────────────────────────────────────────────────────────────

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Render crash:', error, info?.componentStack);
    try {
      captureException(error, {
        componentStack: info?.componentStack,
        url: typeof window !== 'undefined' ? window.location.pathname : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
    } catch {}
    // Stocke l'erreur pour affichage debug même en prod (controlled disclosure)
    this.setState({ errorInfo: info });
  }

  handleResetCart = () => {
    try {
      localStorage.removeItem('yaram_cart');
      localStorage.removeItem('yaram_cart_last_added_at');
      window.location.href = '/';
    } catch {
      window.location.reload();
    }
  };

  handleReload = () => {
    try {
      // Reset state pour laisser une chance au remount avant full reload
      this.setState({ hasError: false, error: null });
      // Si l'erreur revient immédiatement → full reload
      setTimeout(() => {
        if (this.state.hasError) window.location.reload();
      }, 100);
    } catch {
      window.location.reload();
    }
  };

  handleHardReload = () => {
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
          padding: '24px',
          textAlign: 'center',
          background: 'var(--bg, #fff)',
          color: 'var(--ink, #111)',
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          Oups, un souci s'est produit
        </h2>
        <p style={{ fontSize: 14, color: 'var(--ink-soft, #666)', maxWidth: 320, marginBottom: 24 }}>
          On a eu un petit accroc en chargeant cette page. Recharge pour revenir à YARAM.
        </p>
        <button
          onClick={this.handleReload}
          style={{
            padding: '14px 32px',
            borderRadius: 12,
            background: 'var(--primary, #1F8B4C)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            border: 'none',
            cursor: 'pointer',
            marginBottom: 12,
          }}
        >
          Recharger
        </button>
        <button
          onClick={this.handleHardReload}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            background: 'transparent',
            color: 'var(--ink-soft, #666)',
            fontSize: 13,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Retour à l'accueil
        </button>
        {/* Bouton récupération : si crash sur Cart, vider localStorage et go Home */}
        {typeof window !== 'undefined' && window.location.pathname.includes('cart') && (
          <button
            onClick={this.handleResetCart}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              background: 'transparent',
              color: '#D9342B',
              fontSize: 13,
              border: '1px solid #D9342B',
              cursor: 'pointer',
              marginTop: 8,
            }}
          >
            🗑 Vider mon panier et revenir
          </button>
        )}

        {/* Affichage erreur EN PROD (controlled) — sinon impossible de débugger
            sur TestFlight sans Web Inspector branché. Petite police, dépliable. */}
        {this.state.error && (
          <details style={{ marginTop: 32, maxWidth: 360, width: '100%', textAlign: 'left' }}>
            <summary style={{ fontSize: 11, color: '#999', cursor: 'pointer' }}>
              Détails techniques (capture d'écran SVP)
            </summary>
            <pre style={{
              marginTop: 8,
              padding: 10,
              fontSize: 10,
              color: '#D9342B',
              background: '#FFF5F5',
              borderRadius: 8,
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {String(this.state.error?.message || this.state.error)}
              {this.state.error?.stack && '\n\n' + this.state.error.stack.split('\n').slice(0, 5).join('\n')}
            </pre>
          </details>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
