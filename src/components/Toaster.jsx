import { useEffect, useState } from 'react';
import { subscribe, dismissToast, resolveConfirm, resolvePrompt } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────────────
// <Toaster /> : monte UNE fois a la racine (App.jsx).
// Render les toasts en cours + un eventuel ConfirmModal.
// Styles inline pour ne pas dependre d'un CSS externe.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_STYLES = {
  success: { bg: '#1F8B4C', icon: '✓' },
  error:   { bg: '#D9342B', icon: '⚠' },
  info:    { bg: '#1A1A1A', icon: 'ℹ' },
};

export default function Toaster() {
  const [snap, setSnap] = useState({ toasts: [], confirm: null, prompt: null });

  useEffect(() => subscribe(setSnap), []);

  const { toasts, confirm, prompt } = snap;

  return (
    <>
      {/* ─── Stack de toasts en bas centre ─── */}
      <div
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 88,   // au-dessus du TabBar (~72px) + marge
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: 8,
          zIndex: 99999,
          pointerEvents: 'none',
          maxWidth: 360,
          width: 'calc(100vw - 32px)',
        }}
      >
        {toasts.map(t => {
          const s = KIND_STYLES[t.kind] || KIND_STYLES.info;
          return (
            <div
              key={t.id}
              onClick={() => dismissToast(t.id)}
              role="status"
              style={{
                background: s.bg,
                color: 'white',
                padding: '12px 14px',
                borderRadius: 10,
                boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
                fontSize: 13,
                fontWeight: 600,
                pointerEvents: 'auto',
                cursor: 'pointer',
                animation: 'yaramToastIn 220ms cubic-bezier(.2,.9,.3,1.2)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                lineHeight: 1.35,
                wordBreak: 'break-word',
              }}
            >
              <span style={{ flexShrink: 0, fontSize: 16, lineHeight: 1.2 }}>{s.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
            </div>
          );
        })}
      </div>

      {/* ─── Confirm modal ─── */}
      {confirm && (
        <div
          onClick={() => resolveConfirm(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
            padding: 20,
            animation: 'yaramOverlayIn 150ms ease-out',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: 16,
              padding: 22,
              maxWidth: 360,
              width: '100%',
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
              animation: 'yaramConfirmIn 200ms cubic-bezier(.2,.9,.3,1.2)',
            }}
            role="dialog"
            aria-modal="true"
          >
            <p style={{
              fontSize: 15,
              lineHeight: 1.45,
              color: '#1A1A1A',
              margin: 0,
              marginBottom: 18,
              whiteSpace: 'pre-line',
            }}>
              {confirm.message}
            </p>
            <div style={{ display: 'flex', gap: 8, flexDirection: 'row-reverse' }}>
              <button
                autoFocus
                onClick={() => resolveConfirm(true)}
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  background: confirm.danger ? '#D9342B' : '#1F8B4C',
                  color: 'white',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {confirm.confirmLabel}
              </button>
              <button
                onClick={() => resolveConfirm(false)}
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  background: '#F4F4F2',
                  color: '#1A1A1A',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {confirm.cancelLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Prompt modal (input texte) ─── */}
      {prompt && <PromptModal prompt={prompt} />}

      {/* ─── Animations CSS injectees ─── */}
      <style>{`
        @keyframes yaramToastIn {
          from { transform: translateY(20px) scale(0.95); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes yaramOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes yaramConfirmIn {
          from { transform: translateY(10px) scale(0.95); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function PromptModal({ prompt }) {
  const [value, setValue] = useState(prompt.initialValue || '');

  // Validation : requiredText prend la priorite, sinon utilise opts.validate, sinon valide si non vide
  const isValid = (() => {
    if (prompt.requiredText) return value === prompt.requiredText;
    if (typeof prompt.validate === 'function') return prompt.validate(value);
    return value.trim().length > 0;
  })();

  const handleSubmit = () => {
    if (!isValid) return;
    resolvePrompt(value);
  };

  const inputStyle = {
    width: '100%',
    padding: 11,
    borderRadius: 10,
    border: '1.5px solid #DDD',
    fontSize: 14,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    outline: 'none',
    marginTop: 4,
  };

  return (
    <div
      onClick={() => resolvePrompt(null)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: 20,
        animation: 'yaramOverlayIn 150ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 16,
          padding: 22,
          maxWidth: 420,
          width: '100%',
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          animation: 'yaramConfirmIn 200ms cubic-bezier(.2,.9,.3,1.2)',
        }}
        role="dialog"
        aria-modal="true"
      >
        <p style={{
          fontSize: 14,
          lineHeight: 1.45,
          color: '#1A1A1A',
          margin: 0,
          marginBottom: 12,
          whiteSpace: 'pre-line',
          fontWeight: 600,
        }}>
          {prompt.message}
        </p>
        {prompt.multiline ? (
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={prompt.placeholder}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
          />
        ) : (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && isValid) handleSubmit(); }}
            placeholder={prompt.placeholder}
            style={inputStyle}
          />
        )}
        {prompt.requiredText && (
          <p style={{ fontSize: 11, color: '#9B9B9B', marginTop: 6, marginBottom: 0 }}>
            Tape exactement <code style={{ background: '#F4F4F2', padding: '1px 6px', borderRadius: 4 }}>{prompt.requiredText}</code> pour confirmer
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexDirection: 'row-reverse', marginTop: 16 }}>
          <button
            onClick={handleSubmit}
            disabled={!isValid}
            style={{
              flex: 1,
              padding: '11px 14px',
              background: !isValid ? '#CCC' : (prompt.danger ? '#D9342B' : '#1F8B4C'),
              color: 'white',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: isValid ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            {prompt.confirmLabel}
          </button>
          <button
            onClick={() => resolvePrompt(null)}
            style={{
              flex: 1,
              padding: '11px 14px',
              background: '#F4F4F2',
              color: '#1A1A1A',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {prompt.cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
