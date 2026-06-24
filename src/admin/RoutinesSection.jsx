// ═══ Admin Routines — CRUD routines skincare avec étapes ordonnées ═══

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

const SKIN_TYPES = [
  { value: 'all', label: 'Toutes peaux' },
  { value: 'grasse', label: 'Grasse' },
  { value: 'seche', label: 'Sèche' },
  { value: 'mixte', label: 'Mixte' },
  { value: 'sensible', label: 'Sensible' },
  { value: 'normale', label: 'Normale' },
];

const SKIN_CONCERNS = [
  { value: '', label: '— Aucun —' },
  { value: 'acne', label: 'Acné' },
  { value: 'taches', label: 'Taches / Hyperpigmentation' },
  { value: 'rides', label: 'Rides / Anti-âge' },
  { value: 'deshydratation', label: 'Déshydratation' },
  { value: 'rougeurs', label: 'Rougeurs' },
  { value: 'pores', label: 'Pores dilatés' },
  { value: 'eclat', label: 'Éclat / Glow' },
];

const TIMES_OF_DAY = [
  { value: 'morning', label: 'Matin' },
  { value: 'evening', label: 'Soir' },
  { value: 'both', label: 'Matin & Soir' },
];

const DIFFICULTIES = [
  { value: 'easy', label: 'Facile', color: '#1F8B4C' },
  { value: 'medium', label: 'Intermédiaire', color: '#F4B53A' },
  { value: 'advanced', label: 'Avancée', color: '#E8385C' },
];

const emptyRoutine = () => ({
  id: null,
  title: '',
  description: '',
  skin_type: 'all',
  skin_concern: '',
  time_of_day: 'morning',
  difficulty: 'easy',
  estimated_minutes: 10,
  cover_url: '',
  by_pharmacist_id: '',
  is_published: false,
});

const emptyStep = (order) => ({
  step_order: order,
  title: '',
  instructions: '',
  product_id: null,
  product_name: '',
  product_price: 0,
  duration_seconds: 60,
  image_url: '',
});

// ─── Section principale ───────────────────────────────────────────────────
export default function RoutinesSection() {
  const [routines, setRoutines] = useState([]);
  const [filter, setFilter] = useState('all');
  const [skinFilter, setSkinFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_all_routines');
      if (error) {
        console.warn('[RoutinesSection] fetch error:', error.message);
        toast.error('Erreur chargement routines : ' + error.message);
        setRoutines([]);
      } else {
        setRoutines(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleNew = () => {
    setEditing({ routine: emptyRoutine(), steps: [] });
    setShowEditor(true);
  };

  const handleEdit = async (r) => {
    // Fetch steps
    const { data: steps, error } = await supabase
      .from('routine_steps')
      .select('*')
      .eq('routine_id', r.id)
      .order('step_order', { ascending: true });
    if (error) {
      toast.error('Erreur chargement étapes : ' + error.message);
      return;
    }
    // Enrichir steps avec name+price produit pour affichage
    const enriched = await Promise.all(
      (steps || []).map(async (s) => {
        if (!s.product_id) return { ...s, product_name: '', product_price: 0 };
        const { data: p } = await supabase
          .from('products')
          .select('name, price')
          .eq('id', s.product_id)
          .maybeSingle();
        return {
          ...s,
          product_name: p?.name || '',
          product_price: p?.price || 0,
        };
      })
    );
    setEditing({
      routine: { ...emptyRoutine(), ...r },
      steps: enriched,
    });
    setShowEditor(true);
  };

  const handleDelete = async (r) => {
    const ok = await confirmDialog({
      title: 'Supprimer cette routine ?',
      message: `"${r.title}" sera supprimée.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('admin_delete_routine', { p_id: r.id });
    if (error) {
      toast.error('Erreur suppression : ' + error.message);
      return;
    }
    toast.success('Routine supprimée');
    refresh();
  };

  const handleSave = async ({ routine, steps }) => {
    if (!routine.title.trim()) {
      toast.error('Le titre est obligatoire');
      return;
    }

    const payload = {
      title: routine.title,
      description: routine.description || null,
      skin_type: routine.skin_type || 'all',
      skin_concern: routine.skin_concern || null,
      time_of_day: routine.time_of_day || 'morning',
      difficulty: routine.difficulty || 'easy',
      estimated_minutes: parseInt(routine.estimated_minutes, 10) || 0,
      cover_url: routine.cover_url || null,
      by_pharmacist_id: routine.by_pharmacist_id || null,
      is_published: !!routine.is_published,
    };

    try {
      let routineId = routine.id;
      if (routineId) {
        const { error } = await supabase.rpc('admin_update_routine', {
          p_id: routineId,
          p_data: payload,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.rpc('admin_create_routine', {
          p_data: payload,
        });
        if (error) throw error;
        // admin_create_routine peut renvoyer uuid string ou objet { id }
        routineId = typeof data === 'string' ? data : data?.id || data?.[0]?.id;
        if (!routineId) throw new Error('ID routine non retourné par le RPC');
      }

      // Steps : on envoie le JSON nettoyé
      const stepsPayload = steps.map((s, i) => ({
        step_order: i + 1,
        title: s.title || '',
        instructions: s.instructions || '',
        product_id: s.product_id || null,
        duration_seconds: parseInt(s.duration_seconds, 10) || 0,
        image_url: s.image_url || null,
      }));

      const { error: stepsErr } = await supabase.rpc('admin_set_routine_steps', {
        p_routine_id: routineId,
        p_steps: stepsPayload,
      });
      if (stepsErr) throw stepsErr;

      toast.success(routine.id ? 'Routine mise à jour' : 'Routine créée');
      setShowEditor(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error('Erreur enregistrement : ' + e.message);
    }
  };

  // ─── Filtres ───
  const counts = useMemo(() => ({
    all: routines.length,
    published: routines.filter(r => r.is_published).length,
    draft: routines.filter(r => !r.is_published).length,
  }), [routines]);

  const filtered = useMemo(() => {
    let list = routines;
    if (filter === 'published') list = list.filter(r => r.is_published);
    else if (filter === 'draft') list = list.filter(r => !r.is_published);
    if (skinFilter !== 'all') list = list.filter(r => r.skin_type === skinFilter);
    return list;
  }, [routines, filter, skinFilter]);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Routines</h1>
          <p>{counts.all} routines · {counts.published} publiées · {counts.draft} brouillons</p>
        </div>
        <button className="adm-btn-pri" onClick={handleNew}>+ Nouvelle routine</button>
      </header>

      <div className="adm-filters">
        {[
          { id: 'all', label: 'Toutes' },
          { id: 'published', label: '✅ Publiées' },
          { id: 'draft', label: '📝 Brouillons' },
        ].map(f => (
          <button
            key={f.id}
            className={`adm-filter ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span className="adm-filter-count">{counts[f.id]}</span>
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6B6B6B', fontWeight: 700 }}>Type peau :</span>
          <select
            value={skinFilter}
            onChange={(e) => setSkinFilter(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          >
            {SKIN_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>🧴</div>
          <p>Aucune routine</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Cover</th>
                <th style={thStyle}>Titre</th>
                <th style={thStyle}>Peau</th>
                <th style={thStyle}>Difficulté</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Étapes</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Prix total</th>
                <th style={thStyle}>Statut</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const diff = DIFFICULTIES.find(d => d.value === r.difficulty) || DIFFICULTIES[0];
                const skin = SKIN_TYPES.find(s => s.value === r.skin_type) || SKIN_TYPES[0];
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={tdStyle}>
                      {r.cover_url ? (
                        <img src={r.cover_url} alt="" style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover', background: '#f4f4f2' }} />
                      ) : (
                        <div style={{ width: 50, height: 50, borderRadius: 8, background: '#f4f4f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>—</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{r.title || '(sans titre)'}</div>
                      {r.description && (
                        <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: '#f4f4f2',
                        fontSize: 12,
                        fontWeight: 700,
                      }}>{skin.label}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: diff.color + '22',
                        color: diff.color,
                        fontSize: 12,
                        fontWeight: 700,
                      }}>{diff.label}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{r.steps_count ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {r.total_price != null ? `${Number(r.total_price).toLocaleString('fr-FR')} F` : '—'}
                    </td>
                    <td style={tdStyle}>
                      {r.is_published ? (
                        <span className="adm-badge good">Publiée</span>
                      ) : (
                        <span className="adm-badge medium">Brouillon</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="adm-btn-sec" onClick={() => handleEdit(r)}>Éditer</button>
                        <button className="adm-btn-danger" onClick={() => handleDelete(r)}>Supprimer</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showEditor && editing && (
        <RoutineEditor
          initial={editing}
          onClose={() => { setShowEditor(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── Modal éditeur routine ────────────────────────────────────────────────
function RoutineEditor({ initial, onClose, onSave }) {
  const [routine, setRoutine] = useState(initial.routine);
  const [steps, setSteps] = useState(initial.steps || []);
  const [saving, setSaving] = useState(false);

  const update = (k, v) => setRoutine(prev => ({ ...prev, [k]: v }));

  const addStep = () => {
    setSteps(prev => [...prev, emptyStep(prev.length + 1)]);
  };

  const removeStep = (index) => {
    setSteps(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i + 1 })));
  };

  const moveStep = (index, dir) => {
    setSteps(prev => {
      const next = [...prev];
      const swapIdx = index + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[index], next[swapIdx]] = [next[swapIdx], next[index]];
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  };

  const updateStep = (index, patch) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  // Totaux automatiques
  const totals = useMemo(() => {
    const price = steps.reduce((sum, s) => sum + (Number(s.product_price) || 0), 0);
    const seconds = steps.reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0);
    return { price, minutes: Math.round(seconds / 60) };
  }, [steps]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSave({ routine, steps });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {routine.id ? 'Éditer routine' : 'Nouvelle routine'}
          </h2>
          <button style={closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <div style={modalBody}>
          <div style={fieldGrid}>
            <Field label="Titre *" full>
              <input
                style={inputStyle}
                value={routine.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Routine éclat matin"
              />
            </Field>

            <Field label="Description" full>
              <textarea
                style={inputStyle}
                rows={3}
                value={routine.description || ''}
                onChange={(e) => update('description', e.target.value)}
                placeholder="Routine simple en 4 étapes pour un teint éclatant…"
              />
            </Field>

            <Field label="Type de peau">
              <select style={inputStyle} value={routine.skin_type} onChange={(e) => update('skin_type', e.target.value)}>
                {SKIN_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>

            <Field label="Préoccupation">
              <select style={inputStyle} value={routine.skin_concern || ''} onChange={(e) => update('skin_concern', e.target.value)}>
                {SKIN_CONCERNS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>

            <Field label="Moment">
              <select style={inputStyle} value={routine.time_of_day} onChange={(e) => update('time_of_day', e.target.value)}>
                {TIMES_OF_DAY.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>

            <Field label="Difficulté">
              <select style={inputStyle} value={routine.difficulty} onChange={(e) => update('difficulty', e.target.value)}>
                {DIFFICULTIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>

            <Field label="Durée estimée (min)">
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={routine.estimated_minutes}
                onChange={(e) => update('estimated_minutes', e.target.value)}
              />
            </Field>

            <Field label="Pharmacien (UUID, optionnel)">
              <input
                style={inputStyle}
                value={routine.by_pharmacist_id || ''}
                onChange={(e) => update('by_pharmacist_id', e.target.value)}
                placeholder="uuid"
              />
            </Field>

            <Field label="Cover URL" full>
              <input
                style={inputStyle}
                value={routine.cover_url || ''}
                onChange={(e) => update('cover_url', e.target.value)}
                placeholder="https://…"
              />
              {routine.cover_url && (
                <img
                  src={routine.cover_url}
                  alt=""
                  style={{ marginTop: 8, maxWidth: 180, borderRadius: 8 }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
            </Field>

            <Field full>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={!!routine.is_published}
                  onChange={(e) => update('is_published', e.target.checked)}
                />
                Publier (visible aux utilisateurs)
              </label>
            </Field>
          </div>

          {/* ─── Steps ─── */}
          <div style={{ marginTop: 24, borderTop: '1px solid #eee', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Étapes ({steps.length})</h3>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: '#6B6B6B' }}>Total : <strong>{totals.minutes} min</strong></span>
                <span style={{ color: '#6B6B6B' }}>·</span>
                <span style={{ color: '#6B6B6B' }}>Prix : <strong>{totals.price.toLocaleString('fr-FR')} F</strong></span>
                <button className="adm-btn-pri" onClick={addStep}>+ Ajouter étape</button>
              </div>
            </div>

            {steps.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', background: '#fafafa', borderRadius: 8, color: '#6B6B6B' }}>
                Aucune étape. Cliquez sur "Ajouter étape" pour commencer.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {steps.map((s, i) => (
                  <StepEditor
                    key={i}
                    index={i}
                    step={s}
                    total={steps.length}
                    onChange={(patch) => updateStep(i, patch)}
                    onMove={(dir) => moveStep(i, dir)}
                    onRemove={() => removeStep(i)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={modalFooter}>
          <div style={{ flex: 1 }} />
          <button className="adm-btn-sec" onClick={onClose}>Annuler</button>
          <button className="adm-btn-pri" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step editor avec product picker ──────────────────────────────────────
function StepEditor({ index, step, total, onChange, onMove, onRemove }) {
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <div style={{
      border: '1px solid #e5e5e5',
      borderRadius: 12,
      padding: 14,
      background: '#fff',
      display: 'flex',
      gap: 12,
    }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: '#1F8B4C',
        color: '#fff',
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>{index + 1}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={fieldGrid}>
          <Field label="Titre de l'étape" full>
            <input
              style={inputStyle}
              value={step.title || ''}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Nettoyer le visage"
            />
          </Field>

          <Field label="Instructions" full>
            <textarea
              style={inputStyle}
              rows={2}
              value={step.instructions || ''}
              onChange={(e) => onChange({ instructions: e.target.value })}
              placeholder="Masser doucement pendant 30 secondes…"
            />
          </Field>

          <Field label="Produit recommandé" full>
            <ProductPicker
              productId={step.product_id}
              productName={step.product_name}
              onSelect={({ id, name, price }) => onChange({
                product_id: id,
                product_name: name,
                product_price: price,
              })}
              onClear={() => onChange({ product_id: null, product_name: '', product_price: 0 })}
            />
            {step.product_price > 0 && (
              <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 4 }}>
                Prix : {Number(step.product_price).toLocaleString('fr-FR')} F
              </div>
            )}
          </Field>

          <Field label="Durée (secondes)">
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={step.duration_seconds}
              onChange={(e) => onChange({ duration_seconds: e.target.value })}
            />
          </Field>

          <Field label="Image étape (URL)">
            <input
              style={inputStyle}
              value={step.image_url || ''}
              onChange={(e) => onChange({ image_url: e.target.value })}
              placeholder="https://…"
            />
          </Field>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => onMove(-1)}
          disabled={isFirst}
          style={{ ...iconBtn, opacity: isFirst ? 0.3 : 1 }}
          title="Monter"
        >↑</button>
        <button
          onClick={() => onMove(1)}
          disabled={isLast}
          style={{ ...iconBtn, opacity: isLast ? 0.3 : 1 }}
          title="Descendre"
        >↓</button>
        <button
          onClick={onRemove}
          style={{ ...iconBtn, background: '#fee', color: '#c00', borderColor: '#fcc' }}
          title="Supprimer l'étape"
        >×</button>
      </div>
    </div>
  );
}

// ─── Product picker (autocomplete) ────────────────────────────────────────
function ProductPicker({ productId, productName, onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  // Fermer le dropdown au clic externe
  useEffect(() => {
    const onDocClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, brand, img')
        .ilike('name', `%${query}%`)
        .limit(10);
      setSearching(false);
      if (error) {
        console.warn('[ProductPicker] search error:', error.message);
        setResults([]);
        return;
      }
      setResults(data || []);
      setOpen(true);
    }, 250);

    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query]);

  if (productId) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: '#f4f4f2',
        borderRadius: 8,
        border: '1px solid #ddd',
      }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{productName || `Produit ${productId.slice(0, 8)}`}</span>
        <button
          type="button"
          onClick={onClear}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00', fontSize: 18 }}
          title="Retirer le produit"
        >×</button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Rechercher un produit (min. 2 caractères)…"
      />
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 4,
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: 8,
          maxHeight: 240,
          overflowY: 'auto',
          zIndex: 50,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        }}>
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect({ id: p.id, name: p.name, price: p.price });
                setQuery('');
                setResults([]);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f4f4f2'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              {p.img && <img src={p.img} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.brand ? `${p.brand} · ` : ''}{p.name}
                </div>
                <div style={{ fontSize: 11, color: '#6B6B6B' }}>
                  {p.price ? `${Number(p.price).toLocaleString('fr-FR')} F` : '—'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {searching && (
        <div style={{ position: 'absolute', right: 10, top: 10, fontSize: 11, color: '#6B6B6B' }}>…</div>
      )}
    </div>
  );
}

// ─── Helpers UI ───────────────────────────────────────────────────────────
function Field({ label, full, children }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column' }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', marginBottom: 6 }}>{label}</label>}
      {children}
    </div>
  );
}

// ─── Styles partagés ──────────────────────────────────────────────────────
const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const thStyle = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: '#6B6B6B',
  background: '#fafafa',
  borderBottom: '1px solid #eee',
};
const tdStyle = {
  padding: '12px',
  verticalAlign: 'middle',
  fontSize: 13,
  color: '#1A1A1A',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const iconBtn = {
  width: 32,
  height: 32,
  border: '1px solid #ddd',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalBackdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 20,
};

const modalCard = {
  background: '#fff',
  borderRadius: 16,
  width: '100%',
  maxWidth: 920,
  maxHeight: '92vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};

const modalHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid #eee',
};

const modalBody = {
  padding: 20,
  overflowY: 'auto',
  flex: 1,
};

const modalFooter = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '14px 20px',
  borderTop: '1px solid #eee',
  background: '#fafafa',
};

const closeBtn = {
  background: 'none',
  border: 'none',
  fontSize: 28,
  lineHeight: 1,
  cursor: 'pointer',
  color: '#6B6B6B',
  padding: 0,
  width: 32,
  height: 32,
};

const fieldGrid = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
};
