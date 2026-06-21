import { useState, useEffect, useRef, useMemo } from 'react';
import { updateProfile, getAllProducts } from '../lib/supabase';
import { addToCart } from '../lib/cart';
import { haptic } from '../lib/haptic';
import { toast } from '../lib/toast';
import { useNav } from '../App';
import './SkinQuiz.css';

// ═══════════════════════════════════════════════
// QUIZ STEPS — 8 questions YARAM
// ═══════════════════════════════════════════════
const STEPS = [
  {
    id: 'skin_type',
    question: 'Quel est ton type de peau ?',
    sub: 'Au quotidien, comment ta peau se comporte',
    options: [
      { value: 'sèche', label: 'Sèche', icon: '🌵', desc: 'Tire, parfois rugueuse' },
      { value: 'normale', label: 'Normale', icon: '🌟', desc: 'Équilibrée, peu de soucis' },
      { value: 'mixte', label: 'Mixte', icon: '🌗', desc: 'Brillante zone T, normale sur joues' },
      { value: 'grasse', label: 'Grasse', icon: '✨', desc: 'Brillante, pores visibles' },
      { value: 'inconnu', label: 'Je ne sais pas', icon: '🤔', desc: 'Aide-moi à découvrir' },
    ],
  },
  {
    id: 'skin_concerns',
    question: 'Quelles sont tes préoccupations principales ?',
    sub: 'Tu peux en choisir plusieurs',
    multi: true,
    options: [
      { value: 'acne', label: 'Acné', icon: '🔴', desc: 'Boutons, imperfections' },
      { value: 'taches', label: 'Taches', icon: '🟤', desc: 'Hyperpigmentation, post-acné' },
      { value: 'rides', label: 'Rides', icon: '⏳', desc: 'Premiers signes, fermeté' },
      { value: 'sensibilite', label: 'Sensibilité', icon: '🌹', desc: 'Rougeurs, réactions' },
      { value: 'brillance', label: 'Brillance', icon: '✨', desc: 'Excès de sébum' },
      { value: 'secheresse', label: 'Sécheresse', icon: '💧', desc: 'Peau tiraille' },
      { value: 'hyperpigmentation', label: 'Hyperpigmentation', icon: '🌑', desc: 'Zones plus foncées' },
    ],
  },
  {
    id: 'current_routine',
    question: 'À quoi ressemble ta routine actuelle ?',
    sub: 'Sois honnête, pas de jugement',
    options: [
      { value: 'rien', label: 'Rien du tout', icon: '🤷‍♀️', desc: 'Eau et c\'est tout' },
      { value: 'basique', label: 'Basique', icon: '🧴', desc: 'Nettoyant + hydratant' },
      { value: 'experte', label: 'Experte', icon: '🧪', desc: 'Routine complète, sérums, actifs' },
    ],
  },
  {
    id: 'time_per_day',
    question: 'Combien de temps par jour pour tes soins ?',
    sub: 'On adapte la complexité',
    options: [
      { value: 'court', label: 'Moins de 5 min', icon: '⚡', desc: 'L\'essentiel, vite fait' },
      { value: 'moyen', label: '5 à 10 min', icon: '⏱️', desc: 'Le bon équilibre' },
      { value: 'long', label: 'Plus de 10 min', icon: '🧘‍♀️', desc: 'J\'adore prendre mon temps' },
    ],
  },
  {
    id: 'budget',
    question: 'Quel budget mensuel pour tes soins ?',
    sub: 'Pour adapter les recommandations',
    options: [
      { value: 'eco', label: 'Petit budget', icon: '💰', desc: 'Moins de 10 000 FCFA' },
      { value: 'medium', label: 'Confortable', icon: '💸', desc: '10 000 - 25 000 FCFA' },
      { value: 'premium', label: 'Premium', icon: '👑', desc: 'Plus de 25 000 FCFA' },
    ],
  },
  {
    id: 'age_range',
    question: 'Quel est ton âge ?',
    sub: 'Les besoins évoluent avec le temps',
    options: [
      { value: 'teen', label: '13 - 19 ans', icon: '🌱', desc: 'Adolescence' },
      { value: 'twenties', label: '20 - 29 ans', icon: '🌸', desc: 'Premier soin sérieux' },
      { value: 'thirties', label: '30 - 39 ans', icon: '🌺', desc: 'Prévention' },
      { value: 'forties', label: '40 - 49 ans', icon: '🌻', desc: 'Maturité' },
      { value: 'fifties_plus', label: '50 ans et plus', icon: '🌷', desc: 'Soins ciblés' },
    ],
  },
  {
    id: 'pregnancy',
    question: 'Es-tu enceinte ou allaitante ?',
    sub: 'Certains actifs sont à éviter dans ces périodes',
    options: [
      { value: 'non', label: 'Non', icon: '✅', desc: 'Aucune restriction' },
      { value: 'oui', label: 'Oui', icon: '🤰', desc: 'On évite rétinol, salicylique fort, etc.' },
    ],
  },
  {
    id: 'allergies',
    question: 'Allergies connues ?',
    sub: 'Optionnel — tu peux passer cette étape',
    optional: true,
    freeText: true,
    placeholder: 'Ex : parfum, niacinamide, huile d\'arbre à thé...',
  },
];

// ═══════════════════════════════════════════════
// SCORE & DIAGNOSTIC
// ═══════════════════════════════════════════════
function computeScore(answers) {
  let score = 50;
  if (answers.current_routine === 'experte') score += 20;
  else if (answers.current_routine === 'basique') score += 10;
  if (answers.skin_type === 'normale') score += 10;
  if (answers.skin_type === 'sèche' || answers.skin_type === 'grasse') score -= 5;
  const concerns = answers.skin_concerns || [];
  score -= Math.min(concerns.length * 3, 15);
  if (answers.time_per_day === 'long') score += 5;
  if (answers.budget === 'premium') score += 5;
  return Math.max(20, Math.min(95, score));
}

function buildDiagnosis(answers) {
  const concerns = answers.skin_concerns || [];
  const recos = new Set();
  const avoid = new Set();
  if (concerns.includes('acne')) {
    recos.add('niacinamide'); recos.add('acide salicylique'); recos.add('zinc');
  }
  if (concerns.includes('taches') || concerns.includes('hyperpigmentation')) {
    recos.add('vitamine c'); recos.add('niacinamide'); recos.add('acide azelaique');
  }
  if (concerns.includes('rides')) {
    recos.add('retinol'); recos.add('peptides'); recos.add('vitamine c');
  }
  if (concerns.includes('sensibilite')) {
    recos.add('centella'); recos.add('panthenol'); recos.add('ceramides');
    avoid.add('parfum'); avoid.add('alcool denat');
  }
  if (concerns.includes('brillance')) {
    recos.add('niacinamide'); recos.add('argile');
  }
  if (concerns.includes('secheresse') || answers.skin_type === 'sèche') {
    recos.add('acide hyaluronique'); recos.add('ceramides'); recos.add('squalane');
  }
  if (answers.pregnancy === 'oui') {
    avoid.add('retinol'); avoid.add('acide salicylique'); avoid.add('hydroquinone');
  }
  return {
    ingredients_recommandes: [...recos],
    ingredients_a_eviter: [...avoid],
  };
}

// ═══════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════
export default function SkinQuiz({ onComplete }) {
  const { navigate } = useNav();
  const [phase, setPhase] = useState('intro'); // intro | quiz | saving | result
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [direction, setDirection] = useState('forward'); // forward | back
  const [saving, setSaving] = useState(false);
  const [score, setScore] = useState(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [recos, setRecos] = useState([]);
  const [diagnosis, setDiagnosis] = useState(null);
  const [allergiesText, setAllergiesText] = useState('');

  // touch handlers (swipe)
  const touchStart = useRef(null);
  const touchEnd = useRef(null);

  const currentStep = STEPS[step];
  const isMulti = currentStep?.multi;
  const isFreeText = currentStep?.freeText;
  const isOptional = currentStep?.optional;
  const currentValue = answers[currentStep?.id];
  const canContinue =
    isFreeText ? true : isOptional ? true :
    isMulti
      ? Array.isArray(currentValue) && currentValue.length > 0
      : currentValue !== undefined;

  const progress = ((step + 1) / STEPS.length) * 100;

  // ─── Swipe handlers ───
  const onTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };
  const onTouchMove = (e) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };
  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current) return;
    const distance = touchStart.current - touchEnd.current;
    const minSwipe = 60;
    if (distance > minSwipe && canContinue) {
      handleNext();
    } else if (distance < -minSwipe && step > 0) {
      handleBack();
    }
  };

  // ─── Sélection option ───
  const selectOption = (val) => {
    haptic('light');
    if (isMulti) {
      const prev = Array.isArray(currentValue) ? currentValue : [];
      const next = prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val];
      setAnswers({ ...answers, [currentStep.id]: next });
    } else {
      setAnswers({ ...answers, [currentStep.id]: val });
    }
  };

  // ─── Navigation quiz ───
  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setDirection('forward');
      setStep(s => s + 1);
      haptic('medium');
    } else {
      finishQuiz();
    }
  };
  const handleBack = () => {
    if (step === 0) return;
    setDirection('back');
    setStep(s => s - 1);
    haptic('light');
  };

  // ─── Fin du quiz : save + reco ───
  const finishQuiz = async () => {
    haptic('success');
    setPhase('saving');
    setSaving(true);
    const finalScore = computeScore(answers);
    const diag = buildDiagnosis(answers);
    setScore(finalScore);
    setDiagnosis(diag);

    try {
      await updateProfile({
        skin_type: answers.skin_type || 'normale',
        skin_phototype: 'V', // valeur par défaut Sénégal
        skin_concerns: answers.skin_concerns || [],
        skin_sensitivity: (answers.skin_concerns || []).includes('sensibilite') ? 'modérée' : 'aucune',
        budget: answers.budget || 'medium',
        current_routine: answers.current_routine,
        time_per_day: answers.time_per_day,
        age_range: answers.age_range,
        pregnancy: answers.pregnancy,
        allergies: allergiesText || null,
        skin_score: finalScore,
      });
    } catch (e) {
      // Si certaines colonnes n'existent pas, on tente avec un sous-ensemble safe
      try {
        await updateProfile({
          skin_type: answers.skin_type || 'normale',
          skin_phototype: 'V',
          skin_concerns: answers.skin_concerns || [],
          skin_sensitivity: 'aucune',
          budget: answers.budget || 'medium',
        });
      } catch (e2) {
        toast.error('Sauvegarde échouée : ' + (e2?.message || 'Réessaie'));
      }
    }

    // Génère les recos produits (ne bloque pas en cas d'erreur)
    try {
      const all = await getAllProducts();
      const recoIngs = diag.ingredients_recommandes.map(i => i.toLowerCase());
      const avoidIngs = diag.ingredients_a_eviter.map(i => i.toLowerCase());
      const matches = [];
      for (const p of all) {
        if (!p.active) continue;
        const text = `${p.name || ''} ${p.brand || ''} ${p.description || ''} ${p.ingredients || ''} ${p.category || ''}`.toLowerCase();
        if (avoidIngs.some(ing => text.includes(ing))) continue;
        const score = recoIngs.reduce((acc, ing) => acc + (text.includes(ing) ? 1 : 0), 0);
        if (score > 0) matches.push({ p, score });
      }
      matches.sort((a, b) => b.score - a.score || (b.p.rating || 0) - (a.p.rating || 0));
      setRecos(matches.slice(0, 5).map(m => m.p));
    } catch {
      setRecos([]);
    }

    setSaving(false);
    setPhase('result');
  };

  // ─── Animation count-up score ───
  useEffect(() => {
    if (phase !== 'result') return;
    let raf;
    const start = performance.now();
    const duration = 1100;
    const animate = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setAnimatedScore(Math.round(eased * score));
      if (p < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [phase, score]);

  // ─── Bulk add to cart ───
  const addAllToCart = () => {
    if (!recos.length) return;
    // On a besoin d'une pharmacie pour addToCart ; on utilise une fausse "pharmacie YARAM"
    // si l'app ne gère pas la sélection auto. Sinon on tente la 1ère pharmacie dispo dans le produit.
    const fakePharmacy = { id: 'yaram-default', name: 'YARAM' };
    let added = 0;
    for (const p of recos) {
      const res = addToCart({ product: p, pharmacy: fakePharmacy, qty: 1 });
      if (res?.success) added++;
    }
    if (added > 0) {
      haptic('success');
      toast.success(`${added} produit${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au panier`);
      setTimeout(() => navigate({ name: 'cart', params: {} }), 600);
    } else {
      toast.error('Impossible d\'ajouter au panier');
    }
  };

  const saveProfile = async () => {
    haptic('success');
    toast.success('Profil peau sauvegardé');
    if (onComplete) await onComplete();
  };

  const skinTypeLabel = useMemo(() => {
    const opt = STEPS[0].options.find(o => o.value === answers.skin_type);
    return opt?.label || 'Personnalisée';
  }, [answers.skin_type]);

  // ═══════════════════════════════════════════════
  // RENDER : INTRO
  // ═══════════════════════════════════════════════
  if (phase === 'intro') {
    return (
      <div className="squiz-screen squiz-intro">
        <div className="squiz-intro-bg">
          <span className="squiz-bubble squiz-bubble-1" />
          <span className="squiz-bubble squiz-bubble-2" />
          <span className="squiz-bubble squiz-bubble-3" />
          <span className="squiz-bubble squiz-bubble-4" />
        </div>

        <div className="squiz-intro-top">
          <button className="squiz-skip" onClick={async () => {
            try {
              await updateProfile({
                skin_type: 'normale', skin_phototype: 'V',
                skin_concerns: [], skin_sensitivity: 'aucune', budget: 'medium',
              });
              if (onComplete) await onComplete();
            } catch (e) {
              toast.error('Erreur : ' + (e?.message || 'Réessaie'));
            }
          }}>Passer</button>
        </div>

        <div className="squiz-intro-content">
          <div className="squiz-illustration">
            <div className="squiz-face">
              <span className="squiz-eye left" />
              <span className="squiz-eye right" />
              <span className="squiz-mouth" />
              <span className="squiz-blush left" />
              <span className="squiz-blush right" />
              <span className="squiz-sparkle s1">✨</span>
              <span className="squiz-sparkle s2">✨</span>
              <span className="squiz-sparkle s3">✨</span>
            </div>
            <span className="squiz-float squiz-float-1">🧴</span>
            <span className="squiz-float squiz-float-2">💧</span>
            <span className="squiz-float squiz-float-3">🌿</span>
            <span className="squiz-float squiz-float-4">🌸</span>
          </div>

          <h1 className="squiz-intro-title">
            Découvre ta peau<br/>en 2 minutes
          </h1>
          <p className="squiz-intro-sub">
            8 questions personnalisées · 100% gratuit
          </p>

          <ul className="squiz-intro-checks">
            <li><span>✓</span> Routine sur-mesure</li>
            <li><span>✓</span> Produits adaptés à ta peau</li>
            <li><span>✓</span> Conseils d'experts</li>
          </ul>
        </div>

        <div className="squiz-intro-bottom">
          <button
            className="squiz-cta-primary"
            onClick={() => { haptic('medium'); setPhase('quiz'); }}
          >
            Commencer le quiz
            <span className="squiz-cta-arrow">→</span>
          </button>
          <p className="squiz-intro-foot">2 min · sans inscription supplémentaire</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // RENDER : SAVING
  // ═══════════════════════════════════════════════
  if (phase === 'saving') {
    return (
      <div className="squiz-screen squiz-saving">
        <div className="squiz-saving-spinner" />
        <h2>On analyse ta peau...</h2>
        <p>Quelques secondes pour ta routine personnalisée</p>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // RENDER : RESULT
  // ═══════════════════════════════════════════════
  if (phase === 'result') {
    return (
      <div className="squiz-screen squiz-result">
        <div className="squiz-result-hero">
          <div className="squiz-result-bg">
            <span className="squiz-hbubble b1" />
            <span className="squiz-hbubble b2" />
            <span className="squiz-hbubble b3" />
          </div>
          <p className="squiz-result-eyebrow">Ton type de peau</p>
          <h1 className="squiz-result-type">{skinTypeLabel}</h1>
          <div className="squiz-score-ring">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" className="squiz-ring-bg" />
              <circle
                cx="60" cy="60" r="52"
                className="squiz-ring-fg"
                style={{ strokeDashoffset: 326 - (326 * animatedScore) / 100 }}
              />
            </svg>
            <div className="squiz-score-num">
              <strong>{animatedScore}</strong>
              <span>/ 100</span>
            </div>
          </div>
          <p className="squiz-score-label">
            {animatedScore >= 75 ? 'Peau en pleine forme ✨' :
             animatedScore >= 55 ? 'Bonne base, on peut affiner' :
             'On va prendre soin de toi'}
          </p>
        </div>

        <div className="squiz-result-body">
          <h2 className="squiz-result-h2">
            Voici <em>TA</em> routine personnalisée
          </h2>
          <p className="squiz-result-h2-sub">
            Sélectionnée selon tes {(answers.skin_concerns || []).length || 'préférences'} préoccupations
          </p>

          {recos.length === 0 ? (
            <div className="squiz-empty-recos">
              <p>On finalise tes recommandations. Lance un scan photo pour une analyse précise.</p>
            </div>
          ) : (
            <div className="squiz-reco-list">
              {recos.map((p, i) => (
                <button
                  key={p.id}
                  className="squiz-reco-card"
                  style={{ animationDelay: `${i * 80}ms` }}
                  onClick={() => { haptic('light'); navigate({ name: 'product', params: { id: p.id } }); }}
                >
                  <div className="squiz-reco-img">
                    {p.img ? <img src={p.img} alt={p.name} loading="lazy" decoding="async" /> : <span>🧴</span>}
                  </div>
                  <div className="squiz-reco-info">
                    <p className="squiz-reco-brand">{p.brand}</p>
                    <p className="squiz-reco-name">{p.name}</p>
                    {p.price && <p className="squiz-reco-price">{p.price.toLocaleString('fr-FR')} FCFA</p>}
                  </div>
                  <div className="squiz-reco-badge">#{i + 1}</div>
                </button>
              ))}
            </div>
          )}

          {diagnosis?.ingredients_recommandes?.length > 0 && (
            <div className="squiz-ings">
              <p className="squiz-ings-title">Actifs à privilégier</p>
              <div className="squiz-ings-chips">
                {diagnosis.ingredients_recommandes.slice(0, 6).map(i => (
                  <span key={i} className="squiz-chip">{i}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="squiz-result-bottom">
          {recos.length > 0 && (
            <button className="squiz-cta-primary" onClick={addAllToCart}>
              Ajouter toute la routine au panier
              <span className="squiz-cta-arrow">→</span>
            </button>
          )}
          <button className="squiz-cta-secondary" onClick={saveProfile}>
            Sauvegarder mon profil peau
          </button>
          <button
            className="squiz-cta-link"
            onClick={() => { haptic('light'); navigate({ name: 'scan', params: {} }); }}
          >
            Analyse photo précise →
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // RENDER : QUIZ
  // ═══════════════════════════════════════════════
  return (
    <div
      className="squiz-screen squiz-quiz"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="squiz-top">
        <button
          className="squiz-top-back"
          onClick={handleBack}
          disabled={step === 0}
          aria-label="Précédent"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="squiz-progress">
          <div className="squiz-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="squiz-step-num">{step + 1}/{STEPS.length}</div>
      </div>

      <div className={`squiz-content squiz-anim-${direction}`} key={step}>
        <h1 className="squiz-question">{currentStep.question}</h1>
        <p className="squiz-sub">
          {currentStep.sub}{isMulti && ' · Plusieurs choix possibles'}
        </p>

        {isFreeText ? (
          <div className="squiz-freetext">
            <textarea
              className="squiz-textarea"
              placeholder={currentStep.placeholder}
              value={allergiesText}
              onChange={(e) => setAllergiesText(e.target.value)}
              rows={4}
            />
            <p className="squiz-freetext-hint">Tu peux laisser vide si aucune allergie</p>
          </div>
        ) : (
          <div className="squiz-options">
            {currentStep.options.map(opt => {
              const isSelected = isMulti
                ? Array.isArray(currentValue) && currentValue.includes(opt.value)
                : currentValue === opt.value;
              return (
                <button
                  key={opt.value}
                  className={`squiz-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => selectOption(opt.value)}
                >
                  <span className="squiz-option-icon">{opt.icon}</span>
                  <div className="squiz-option-text">
                    <strong>{opt.label}</strong>
                    <span>{opt.desc}</span>
                  </div>
                  <div className="squiz-option-check">
                    {isSelected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="squiz-bottom">
        <button
          className="squiz-btn-back"
          onClick={handleBack}
          disabled={step === 0}
        >
          Précédent
        </button>
        <button
          className="squiz-btn-next"
          onClick={handleNext}
          disabled={!canContinue || saving}
        >
          {step < STEPS.length - 1 ? 'Suivant' : 'Voir mon résultat'}
          <span className="squiz-cta-arrow">→</span>
        </button>
      </div>
    </div>
  );
}
