import { Component } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// <ErrorBoundary /> : capture les erreurs React qui blanchissent les pages.
// Avant : une exception dans une page (cart malformé, props manquantes…)
// fait unmount silencieux → ECRAN BLANC sans aucun log côté user.
// Maintenant : on affiche un fallback visible + bouton "Recharger".
// ─────────────────────────────────────────────────────────────────────────────

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log dans la console iOS (visible via Safari Web Inspector) + Sentry plus tard
    console.error('[ErrorBoundary] Render crash:', error, info?.componentStack);
    try {
      // Si Sentry est dispo
      if (typeof window !== 'undefined' && window.Sentry) {
        window.Sentry.captureException(error, { extra: info });
      }
    } catch {}
  }

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
        {import.meta.env.DEV && this.state.error && (
          <pre style={{
            marginTop: 24,
            fontSize: 11,
            color: '#D9342B',
            maxWidth: 360,
            overflow: 'auto',
            textAlign: 'left',
          }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
