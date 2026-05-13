import { useNav } from '../App';

// ─── Vrais logos officiels ───
const WaveLogo = ({ size = 44 }) => (
  <img 
    src="/logos/wave.png" 
    alt="Wave" 
    style={{ width: size, height: size, objectFit: 'contain', borderRadius: 8 }}
    onError={e => { e.target.style.display = 'none'; }}
  />
);

const OrangeMoneyLogo = ({ size = 44 }) => (
  <img 
    src="/logos/orange-money.png" 
    alt="Orange Money" 
    style={{ width: size, height: size, objectFit: 'contain', borderRadius: 8 }}
    onError={e => { e.target.style.display = 'none'; }}
  />
);

const YasLogo = ({ size = 44 }) => (
  <img 
    src="/logos/yas.png" 
    alt="Yas" 
    style={{ width: size, height: size, objectFit: 'contain', borderRadius: 8 }}
    onError={e => { e.target.style.display = 'none'; }}
  />
);

const CashLogo = ({ size = 44 }) => (
  <div style={{
    width: size, height: size, borderRadius: 8,
    background: '#1F8B4C',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'white', fontSize: size * 0.5,
    boxShadow: '0 2px 8px rgba(31,139,76,0.3)',
  }}>
    💵
  </div>
);

const CardLogo = ({ size = 44 }) => (
  <div style={{
    width: size, height: size, borderRadius: 8,
    background: 'linear-gradient(135deg, #1A1A1A, #4B4B4B)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'white', fontSize: size * 0.5,
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  }}>
    💳
  </div>
);

export default function Payments() {
  const { navigate } = useNav();
  
  const methods = [
    { 
      id: 'wave', 
      Logo: WaveLogo,
      name: 'Wave', 
      desc: 'Paiement instantané · gratuit',
      tag: 'Le + populaire',
      tagColor: '#1DC8F2',
      default: true 
    },
    { 
      id: 'om', 
      Logo: OrangeMoneyLogo,
      name: 'Orange Money', 
      desc: 'Code USSD #144#',
      tag: 'Réseau Orange',
      tagColor: '#FF7900',
    },
    { 
      id: 'yas', 
      Logo: YasLogo,
      name: 'Yas Money', 
      desc: 'Paiement via Yas (ex-Free Money)',
      tag: 'Réseau Yas',
      tagColor: '#E5004C',
    },
    { 
      id: 'cod', 
      Logo: CashLogo,
      name: 'Cash à la livraison', 
      desc: 'Tu paies au livreur en espèces',
      tag: '100% safe',
      tagColor: '#1F8B4C',
    },
    { 
      id: 'card', 
      Logo: CardLogo,
      name: 'Carte bancaire', 
      desc: 'Visa / Mastercard',
      tag: 'Bientôt disponible',
      tagColor: '#9B9B9B',
      disabled: true,
    },
  ];

  return (
    <div className="page-anim" style={{
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      background: 'var(--bg)',
    }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', 
        alignItems: 'center', 
        gap: 14, 
        padding: 'calc(var(--safe-top) + 14px) 16px 14px', 
        borderBottom: '1px solid var(--line)',
      }}>
        <button className="icon-back-btn" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        <h1 style={{fontSize: 18, fontWeight: 700}}>Moyens de paiement</h1>
      </div>

      {/* CONTENU */}
      <div style={{flex: 1, overflowY: 'auto', padding: 16}}>
        
        {/* Banner pro */}
        <div style={{
          background: 'linear-gradient(135deg, #1F8B4C, #166635)',
          color: 'white',
          padding: 16,
          borderRadius: 14,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
            ✨ Diaara accepte tous les moyens de paiement
          </div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            Wave, Orange Money, Yas et cash. Choisis ce qui te convient !
          </div>
        </div>

        {/* Liste des méthodes */}
        {methods.map(m => {
          const Logo = m.Logo;
          return (
            <div key={m.id} style={{
              display: 'flex', 
              alignItems: 'center', 
              gap: 14,
              padding: 16, 
              marginBottom: 10,
              background: 'white',
              border: m.default ? '2px solid #1F8B4C' : '1px solid #EEE',
              borderRadius: 14,
              opacity: m.disabled ? 0.6 : 1,
              transition: 'all 0.2s',
            }}>
              <Logo size={44} />
              
              <div style={{flex: 1}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                  <strong style={{fontSize: 15}}>{m.name}</strong>
                  {m.default && (
                    <span style={{
                      background: '#E8F5EC', 
                      color: '#1F8B4C',
                      padding: '2px 8px', 
                      borderRadius: 999,
                      fontSize: 10, 
                      fontWeight: 700,
                    }}>
                      Par défaut
                    </span>
                  )}
                </div>
                <p style={{fontSize: 12, color: '#6B6B6B', marginTop: 4}}>{m.desc}</p>
                
                {m.tag && (
                  <div style={{
                    display: 'inline-block',
                    marginTop: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    color: m.tagColor,
                  }}>
                    • {m.tag}
                  </div>
                )}
              </div>

              {!m.disabled && (
                <div style={{ color: '#1F8B4C', fontSize: 18 }}>✓</div>
              )}
            </div>
          );
        })}

        {/* Info sécurité */}
        <div style={{
          marginTop: 14, 
          padding: 14, 
          background: '#F9FAFB',
          border: '1px solid #EEE',
          borderRadius: 12, 
          fontSize: 12,
          color: '#4B4B4B',
        }}>
          <div style={{ fontWeight: 700, color: '#1A1A1A', marginBottom: 6 }}>
            🔒 Paiements 100% sécurisés
          </div>
          <p style={{ lineHeight: 1.5 }}>
            Aucune donnée bancaire n'est stockée par Diaara. Les paiements sont sécurisés par Wave, Orange Money, Yas et notre partenaire BCEAO.
          </p>
        </div>

        {/* Footer info */}
        <div style={{
          marginTop: 16,
          padding: 14,
          background: '#FEF6E5',
          color: '#A07700',
          borderRadius: 12,
          fontSize: 12,
        }}>
          <strong>💡 Conseil :</strong> Wave est le mode le plus rapide. Tes paiements arrivent en moins de 10 secondes.
        </div>
      </div>
    </div>
  );
}