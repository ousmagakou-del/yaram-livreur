// ═══ Admin Articles — CRUD blog / contenu éditorial ═══

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast, confirmDialog } from '../lib/toast';

const emptyArticle = () => ({
  id: null,
  title: '',
  subtitle: '',
  category_id: '',
  cover_url: '',
  author_name: '',
  author_avatar: '',
  read_time_minutes: 5,
  body_markdown: '',
  tags: '',                // edited as comma-separated string
  related_products: '',    // edited as comma-separated ids
  is_published: false,
});

// ─── Mini parser markdown inline ──────────────────────────────────────────
// Supporte : ## headings, **bold**, *italic*, `code`, [link](url), blocs séparés par \n\n.
// Volontairement minimal pour preview admin (pas de XSS car React échappe par défaut).
function renderInline(text) {
  if (!text) return null;
  // Tokenise sur **bold**, *italic*, `code`, [link](url)
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={`b${key++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      parts.push(<code key={`c${key++}`} style={{ background: '#f4f4f2', padding: '2px 6px', borderRadius: 4, fontSize: '0.9em' }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('[')) {
      const labelEnd = tok.indexOf(']');
      const label = tok.slice(1, labelEnd);
      const url = tok.slice(labelEnd + 2, -1);
      parts.push(<a key={`a${key++}`} href={url} target="_blank" rel="noreferrer" style={{ color: '#1F8B4C' }}>{label}</a>);
    } else if (tok.startsWith('*')) {
      parts.push(<em key={`i${key++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(md) {
  if (!md) return <p style={{ color: '#9aa3a0' }}>(Corps vide)</p>;
  const blocks = md.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('### ')) {
      return <h3 key={i} style={{ fontSize: 16, fontWeight: 800, margin: '14px 0 6px' }}>{renderInline(trimmed.slice(4))}</h3>;
    }
    if (trimmed.startsWith('## ')) {
      return <h2 key={i} style={{ fontSize: 20, fontWeight: 800, margin: '18px 0 8px' }}>{renderInline(trimmed.slice(3))}</h2>;
    }
    if (trimmed.startsWith('# ')) {
      return <h1 key={i} style={{ fontSize: 24, fontWeight: 900, margin: '20px 0 10px' }}>{renderInline(trimmed.slice(2))}</h1>;
    }
    // Listes simples
    if (/^[-*]\s/.test(trimmed)) {
      const items = trimmed.split('\n').filter(l => /^[-*]\s/.test(l)).map(l => l.replace(/^[-*]\s/, ''));
      return (
        <ul key={i} style={{ marginLeft: 20, marginBottom: 10 }}>
          {items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{renderInline(it)}</li>)}
        </ul>
      );
    }
    return (
      <p key={i} style={{ marginBottom: 12, lineHeight: 1.55 }}>
        {trimmed.split('\n').map((line, k) => (
          <span key={k}>
            {renderInline(line)}
            {k < trimmed.split('\n').length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

// ─── Section principale ───────────────────────────────────────────────────
export default function ArticlesSection() {
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);

  useEffect(() => {
    refresh();
    loadCategories();
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_all_articles');
      if (error) {
        console.warn('[ArticlesSection] fetch error:', error.message);
        toast.error('Erreur chargement articles : ' + error.message);
        setArticles([]);
      } else {
        setArticles(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    // Best effort : on tente plusieurs sources (table article_categories).
    const { data, error } = await supabase
      .from('article_categories')
      .select('id, slug, name, color')
      .order('name', { ascending: true });
    if (!error && Array.isArray(data)) {
      setCategories(data);
    }
  };

  const handleEdit = (a) => {
    setEditing({
      ...emptyArticle(),
      ...a,
      tags: Array.isArray(a.tags) ? a.tags.join(', ') : (a.tags || ''),
      related_products: Array.isArray(a.related_products)
        ? a.related_products.join(', ')
        : (a.related_products || ''),
    });
    setShowEditor(true);
  };

  const handleNew = () => {
    setEditing(emptyArticle());
    setShowEditor(true);
  };

  const handleDelete = async (a) => {
    const ok = await confirmDialog({
      title: 'Supprimer cet article ?',
      message: `"${a.title}" sera supprimé (soft delete).`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('admin_delete_article', { p_id: a.id });
    if (error) {
      toast.error('Erreur suppression : ' + error.message);
      return;
    }
    toast.success('Article supprimé');
    refresh();
  };

  const handleSave = async (form) => {
    // Sérialisation tags + related_products
    const tagsArr = (form.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const relatedArr = (form.related_products || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    const payload = {
      title: form.title,
      subtitle: form.subtitle || null,
      category_id: form.category_id || null,
      cover_url: form.cover_url || null,
      author_name: form.author_name || null,
      author_avatar: form.author_avatar || null,
      read_time_minutes: parseInt(form.read_time_minutes, 10) || 5,
      body_markdown: form.body_markdown || '',
      tags: tagsArr,
      related_products: relatedArr,
      is_published: !!form.is_published,
    };

    try {
      if (form.id) {
        const { error } = await supabase.rpc('admin_update_article', {
          p_id: form.id,
          p_data: payload,
        });
        if (error) throw error;
        toast.success('Article mis à jour');
      } else {
        const { error } = await supabase.rpc('admin_create_article', {
          p_data: payload,
        });
        if (error) throw error;
        toast.success('Article créé');
      }
      setShowEditor(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error('Erreur enregistrement : ' + e.message);
    }
  };

  const handleCreateCategory = async ({ slug, name, color }) => {
    const { error } = await supabase.rpc('admin_create_category', {
      p_slug: slug,
      p_name: name,
      p_color: color,
    });
    if (error) {
      toast.error('Erreur création catégorie : ' + error.message);
      return;
    }
    toast.success('Catégorie créée');
    setShowNewCat(false);
    loadCategories();
  };

  const counts = useMemo(() => ({
    all: articles.length,
    published: articles.filter(a => a.is_published).length,
    draft: articles.filter(a => !a.is_published).length,
  }), [articles]);

  const filtered = useMemo(() => {
    if (filter === 'published') return articles.filter(a => a.is_published);
    if (filter === 'draft') return articles.filter(a => !a.is_published);
    return articles;
  }, [articles, filter]);

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Articles</h1>
          <p>{counts.all} articles · {counts.published} publiés · {counts.draft} brouillons</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adm-btn-sec" onClick={() => setShowNewCat(true)}>+ Catégorie</button>
          <button className="adm-btn-pri" onClick={handleNew}>+ Nouvel article</button>
        </div>
      </header>

      <div className="adm-filters">
        {[
          { id: 'all', label: 'Tous' },
          { id: 'published', label: '✅ Publiés' },
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
      </div>

      {loading ? (
        <div className="adm-empty">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="adm-empty">
          <div style={{ fontSize: 48, opacity: 0.2 }}>📝</div>
          <p>Aucun article</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Cover</th>
                <th style={thStyle}>Titre</th>
                <th style={thStyle}>Catégorie</th>
                <th style={thStyle}>Statut</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Vues</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Sauvés</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const cat = categories.find(c => c.id === a.category_id) || null;
                const catName = a.category_name || cat?.name || '—';
                const catColor = a.category_color || cat?.color || '#F4F4F2';
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={tdStyle}>
                      {a.cover_url ? (
                        <img
                          src={a.cover_url}
                          alt=""
                          style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover', background: '#f4f4f2' }}
                        />
                      ) : (
                        <div style={{ width: 50, height: 50, borderRadius: 8, background: '#f4f4f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>—</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{a.title || '(sans titre)'}</div>
                      {a.subtitle && <div style={{ fontSize: 12, color: '#6B6B6B' }}>{a.subtitle}</div>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: catColor,
                        color: '#1A1A1A',
                        fontSize: 12,
                        fontWeight: 700,
                      }}>{catName}</span>
                    </td>
                    <td style={tdStyle}>
                      {a.is_published ? (
                        <span className="adm-badge good">Publié</span>
                      ) : (
                        <span className="adm-badge medium">Brouillon</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{a.view_count ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{a.save_count ?? 0}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="adm-btn-sec" onClick={() => handleEdit(a)}>Éditer</button>
                        <button className="adm-btn-danger" onClick={() => handleDelete(a)}>Supprimer</button>
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
        <ArticleEditor
          initial={editing}
          categories={categories}
          onClose={() => { setShowEditor(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}

      {showNewCat && (
        <NewCategoryModal
          onClose={() => setShowNewCat(false)}
          onCreate={handleCreateCategory}
        />
      )}
    </div>
  );
}

// ─── Styles tableau ───────────────────────────────────────────────────────
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

// ─── Modal éditeur article ────────────────────────────────────────────────
function ArticleEditor({ initial, categories, onClose, onSave }) {
  const [form, setForm] = useState(initial);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error('Le titre est obligatoire');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            {form.id ? 'Éditer article' : 'Nouvel article'}
          </h2>
          <button style={closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <div style={modalBody}>
          <div style={fieldGrid}>
            <Field label="Titre *" full>
              <input
                style={inputStyle}
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Comment choisir un sérum vitamine C"
              />
            </Field>

            <Field label="Sous-titre" full>
              <input
                style={inputStyle}
                value={form.subtitle || ''}
                onChange={(e) => update('subtitle', e.target.value)}
                placeholder="Guide pratique pour peaux sensibles"
              />
            </Field>

            <Field label="Catégorie">
              <select
                style={inputStyle}
                value={form.category_id || ''}
                onChange={(e) => update('category_id', e.target.value)}
              >
                <option value="">— Aucune —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Temps de lecture (min)">
              <input
                style={inputStyle}
                type="number"
                min={1}
                value={form.read_time_minutes}
                onChange={(e) => update('read_time_minutes', e.target.value)}
              />
            </Field>

            <Field label="Cover URL" full>
              <input
                style={inputStyle}
                value={form.cover_url || ''}
                onChange={(e) => update('cover_url', e.target.value)}
                placeholder="https://…"
              />
              {form.cover_url && (
                <img
                  src={form.cover_url}
                  alt=""
                  style={{ marginTop: 8, maxWidth: 180, borderRadius: 8 }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
            </Field>

            <Field label="Auteur (nom)">
              <input
                style={inputStyle}
                value={form.author_name || ''}
                onChange={(e) => update('author_name', e.target.value)}
                placeholder="Dr. Awa Diop"
              />
            </Field>

            <Field label="Avatar auteur (URL)">
              <input
                style={inputStyle}
                value={form.author_avatar || ''}
                onChange={(e) => update('author_avatar', e.target.value)}
                placeholder="https://…"
              />
            </Field>

            <Field label="Corps (Markdown)" full>
              <textarea
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5 }}
                rows={14}
                value={form.body_markdown || ''}
                onChange={(e) => update('body_markdown', e.target.value)}
                placeholder={`## Introduction\n\nLa vitamine C est **un actif** majeur…\n\n## Étapes\n\n- Étape 1\n- Étape 2`}
              />
            </Field>

            <Field label="Tags (séparés par virgules)" full>
              <input
                style={inputStyle}
                value={form.tags}
                onChange={(e) => update('tags', e.target.value)}
                placeholder="hydratation, anti-age, vitamine-c"
              />
            </Field>

            <Field label="Produits liés (IDs séparés par virgules)" full>
              <textarea
                style={inputStyle}
                rows={2}
                value={form.related_products}
                onChange={(e) => update('related_products', e.target.value)}
                placeholder="prod-uuid-1, prod-uuid-2"
              />
            </Field>

            <Field full>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={!!form.is_published}
                  onChange={(e) => update('is_published', e.target.checked)}
                />
                Publier (visible aux utilisateurs)
              </label>
            </Field>
          </div>
        </div>

        <div style={modalFooter}>
          <button className="adm-btn-sec" onClick={() => setShowPreview(true)}>Aperçu</button>
          <div style={{ flex: 1 }} />
          <button className="adm-btn-sec" onClick={onClose}>Annuler</button>
          <button className="adm-btn-pri" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>

        {showPreview && (
          <PreviewModal
            article={form}
            onClose={() => setShowPreview(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Sub-modal preview ────────────────────────────────────────────────────
function PreviewModal({ article, onClose }) {
  return (
    <div style={{ ...modalBackdrop, zIndex: 1100 }} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Aperçu</h2>
          <button style={closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div style={{ ...modalBody, maxHeight: '70vh' }}>
          {article.cover_url && (
            <img
              src={article.cover_url}
              alt=""
              style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 12, marginBottom: 16 }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 6 }}>{article.title || '(Titre)'}</h1>
          {article.subtitle && <p style={{ fontSize: 16, color: '#6B6B6B', marginBottom: 14 }}>{article.subtitle}</p>}
          <div style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 18 }}>
            {article.author_name && <span>Par {article.author_name} · </span>}
            {article.read_time_minutes} min de lecture
          </div>
          <div style={{ fontSize: 15, color: '#1A1A1A' }}>
            {renderMarkdown(article.body_markdown)}
          </div>
          {article.tags && (
            <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {article.tags.split(',').map(t => t.trim()).filter(Boolean).map((t, i) => (
                <span key={i} style={{ background: '#f4f4f2', padding: '4px 10px', borderRadius: 999, fontSize: 12 }}>#{t}</span>
              ))}
            </div>
          )}
        </div>
        <div style={modalFooter}>
          <div style={{ flex: 1 }} />
          <button className="adm-btn-pri" onClick={onClose}>Fermer l'aperçu</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal nouvelle catégorie ─────────────────────────────────────────────
function NewCategoryModal({ onClose, onCreate }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#FFE4D6');

  const submit = () => {
    if (!slug.trim() || !name.trim()) {
      toast.error('Slug et nom obligatoires');
      return;
    }
    onCreate({ slug: slug.trim(), name: name.trim(), color });
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Nouvelle catégorie</h2>
          <button style={closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div style={modalBody}>
          <Field label="Slug *" full>
            <input
              style={inputStyle}
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="conseils-peau"
            />
          </Field>
          <Field label="Nom *" full>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Conseils peau"
            />
          </Field>
          <Field label="Couleur" full>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 80, height: 40, padding: 2, border: '1px solid #ddd', borderRadius: 8 }}
            />
          </Field>
        </div>
        <div style={modalFooter}>
          <div style={{ flex: 1 }} />
          <button className="adm-btn-sec" onClick={onClose}>Annuler</button>
          <button className="adm-btn-pri" onClick={submit}>Créer</button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers UI ──────────────────────────────────────────────────────────
function Field({ label, full, children }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column' }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: '#1A1A1A', marginBottom: 6 }}>{label}</label>}
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
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
  maxWidth: 820,
  maxHeight: '90vh',
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
