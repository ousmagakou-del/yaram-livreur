import { useState } from 'react';
import { useNav, useUser } from '../App';
import { supabase, signOut } from '../lib/supabase';
import { useDocumentTitle } from '../lib/seo';
import { toast } from '../lib/toast';
import './Legal.css';

export default function DeleteAccount() {
  const { navigate } = useNav();
  const { user, refreshUser } = useUser();
  useDocumentTitle('Supprimer mon compte · YARAM');

  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('intro'); // intro | confirm | done

  const REQUIRED = 'SUPPRIMER';

  const handleDelete = async () => {
    if (confirmText !== REQUIRED) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expirée — reconnecte-toi');
        setSubmitting(false);
        return;
      }
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co'}/functions/v1/delete-my-account`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        toast.error('Erreur : ' + (data?.error || 'suppression échouée'));
        setSubmitting(false);
        return;
      }
      // Signout + redirect home
      await signOut();
      await refreshUser(null);
      setStep('done');
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || 'inattendue'));
      setSubmitting(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="legal-screen page-anim">
        <article className="legal-content" style={{ textAlign: 'center', paddingTop: 60 }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>👋</div>
          <h1 style={{ color: 'var(--primary, #1F8B4C)' }}>Compte supprimé</h1>
          <p style={{ fontSize: 16, marginTop: 20 }}>
            Ton compte et toutes tes données personnelles ont été supprimés. Tes commandes
            passées restent dans la compta de la pharmacie (anonymisées) pour 10 ans (obligation légale).
          </p>
          <p style={{ marginTop: 20 }}>
            Merci d'avoir essayé YARAM. Tu peux revenir quand tu veux 💚
          </p>
          <div className="legal-cta">
            <button className="legal-btn-pri" onClick={() => navigate({ name: 'home', params: {} })}>
              Retour à l'accueil
            </button>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="legal-screen page-anim">
      <header className="legal-header">
        <button className="legal-back" onClick={() => navigate(-1)} aria-label="Retour">←</button>
        <h1>Supprimer mon compte</h1>
      </header>

      <article className="legal-content">
        {step === 'intro' && (
          <>
            <p style={{ fontSize: 16 }}>
              Tu veux supprimer ton compte YARAM ? On respecte ton choix, mais on veut être sûrs
              que tu comprends ce qui va se passer.
            </p>

            <h2>Ce qui sera supprimé immédiatement</h2>
            <ul>
              <li><strong>Ton profil</strong> : prénom, email, téléphone, ville</li>
              <li><strong>Tes adresses de livraison</strong></li>
              <li><strong>Tes favoris</strong></li>
              <li><strong>Tes scans IA peau</strong> et photos associées</li>
              <li><strong>Tes points fidélité</strong> et leur historique</li>
              <li><strong>Tes avis produits</strong></li>
              <li><strong>Tes abonnements aux notifications push</strong></li>
              <li><strong>Ton compte de connexion</strong> (auth)</li>
            </ul>

            <h2>Ce qui sera conservé (anonymisé)</h2>
            <p>
              Pour des raisons légales (comptabilité sénégalaise — obligation 10 ans) et
              opérationnelles (commission pharma, statistiques agrégées), tes <strong>commandes
              passées</strong> sont conservées mais <strong>complètement anonymisées</strong> :
              ton nom, téléphone, adresse et email sont remplacés par "[Supprimé]". Plus aucune
              donnée personnelle restante.
            </p>

            <div className="legal-warning-box">
              <strong>⚠️ Action irréversible</strong>
              <p style={{ margin: '8px 0 0' }}>
                Une fois supprimé, ton compte ne peut pas être restauré. Si tu changes d'avis,
                il faudra recréer un nouveau compte (sans tes points fidélité ni ton historique).
              </p>
            </div>

            <h2>Alternative</h2>
            <p>
              Si tu veux juste te déconnecter ou faire une pause, retourne sur ton profil et
              utilise "Se déconnecter". Tes données restent intactes pour ton retour.
            </p>

            <div className="legal-cta" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="legal-btn-pri" onClick={() => navigate(-1)}>
                Annuler
              </button>
              <button className="legal-btn-danger" onClick={() => setStep('confirm')}>
                Je veux quand même supprimer
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <h2 style={{ color: '#D9342B', marginTop: 0 }}>Dernière confirmation</h2>
            <p>
              Pour confirmer, tape exactement <strong>{REQUIRED}</strong> dans la case ci-dessous
              (en majuscules) :
            </p>

            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={REQUIRED}
              autoFocus
              style={{
                width: '100%',
                padding: 14,
                fontSize: 16,
                border: '2px solid #D9342B',
                borderRadius: 10,
                marginTop: 12,
                marginBottom: 20,
                fontFamily: 'inherit',
                textAlign: 'center',
                letterSpacing: 2,
                fontWeight: 700,
              }}
            />

            <p style={{ fontSize: 13, color: '#888', textAlign: 'center' }}>
              Compte : <strong>{user?.email || user?.phone || 'utilisateur'}</strong>
            </p>

            <div className="legal-cta" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="legal-btn-pri" onClick={() => setStep('intro')} disabled={submitting}>
                Retour
              </button>
              <button
                className="legal-btn-danger"
                onClick={handleDelete}
                disabled={confirmText !== REQUIRED || submitting}
                style={{ opacity: confirmText !== REQUIRED ? 0.5 : 1 }}
              >
                {submitting ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
