import { useState } from 'react';
import { useUser } from '../App';
import './WhatsAppButton.css';

// Numéro YARAM support (modifiable)
const YARAM_PHONE = '221777608983'; // sans le +
const YARAM_NAME = 'YARAM Support';

export default function WhatsAppButton() {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  
  const userName = user?.first_name || '';
  
  const messages = [
    {
      label: '👋 Bonjour',
      icon: '👋',
      text: `Salut YARAM${userName ? `, c'est ${userName}` : ''} 👋`,
    },
    {
      label: '❓ Une question sur un produit',
      icon: '❓',
      text: `Salut${userName ? ` c'est ${userName}` : ''}, j'ai une question sur un produit que j'ai vu sur YARAM.`,
    },
    {
      label: '📦 Suivi commande',
      icon: '📦',
      text: `Salut${userName ? ` c'est ${userName}` : ''}, je voudrais des nouvelles de ma commande YARAM.`,
    },
    {
      label: '🤖 Question sur le Scan IA',
      icon: '🤖',
      text: `Salut${userName ? ` c'est ${userName}` : ''}, j'ai une question sur le Scan IA.`,
    },
    {
      label: '🛵 Problème de livraison',
      icon: '🛵',
      text: `Salut${userName ? ` c'est ${userName}` : ''}, j'ai un problème avec ma livraison YARAM.`,
    },
    {
      label: '💚 Autre',
      icon: '💚',
      text: `Salut YARAM${userName ? `, c'est ${userName}` : ''}, j'aurais besoin d'aide...`,
    },
  ];
  
  const handleSend = (msg) => {
    const url = `https://wa.me/${YARAM_PHONE}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    setOpen(false);
  };
  
  return (
    <>
      {/* Bouton flottant */}
      <button className="wa-fab" onClick={() => setOpen(true)} aria-label="Contacter sur WhatsApp">
        <svg viewBox="0 0 24 24" fill="white" width="28" height="28">
          <path d="M20.52 3.48A11.84 11.84 0 0 0 12 0C5.38 0 0 5.38 0 12c0 2.11.55 4.16 1.6 5.97L0 24l6.18-1.62A12.01 12.01 0 0 0 12 24c6.62 0 12-5.38 12-12 0-3.21-1.25-6.22-3.48-8.52zM12 22a9.94 9.94 0 0 1-5.07-1.39l-.36-.21-3.67.96.98-3.58-.24-.37A9.94 9.94 0 0 1 2 12C2 6.49 6.49 2 12 2s10 4.49 10 10-4.49 10-10 10zm5.47-7.53c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.48 1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35z"/>
        </svg>
      </button>
      
      {/* Modal des messages préformatés */}
      {open && (
        <div className="wa-modal-overlay" onClick={() => setOpen(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="wa-modal-head">
              <div className="wa-modal-avatar">D</div>
              <div className="wa-modal-info">
                <strong>{YARAM_NAME}</strong>
                <span>● En ligne · Réponse rapide</span>
              </div>
              <button className="wa-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            
            <div className="wa-modal-intro">
              <p>Salut ! Choisis ton type de question, on te répond direct sur WhatsApp 💚</p>
            </div>
            
            <div className="wa-options">
              {messages.map((m, i) => (
                <button key={i} className="wa-option" onClick={() => handleSend(m.text)}>
                  <span className="wa-option-icon">{m.icon}</span>
                  <span className="wa-option-text">{m.label}</span>
                  <span className="wa-option-arrow">→</span>
                </button>
              ))}
            </div>
            
            <div className="wa-modal-footer">
              <p>📞 Tu peux aussi appeler au <strong>+221 77 760 89 83</strong></p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
