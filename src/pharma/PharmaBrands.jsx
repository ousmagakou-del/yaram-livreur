// ═══════════════════════════════════════════════════════════════
// YARAM Pharma — Section "Marques partenaires"
// ═══════════════════════════════════════════════════════════════
//
// 2 onglets :
//   1. Catalogue : liste des marques YARAM avec stats (top sellers)
//   2. Proposer : formulaire pour qu'une marque externe contacte YARAM
//
// Utilisation typique :
//  - La pharmacie veut savoir avec quelles marques YARAM travaille
//  - Si une marque visite la pharmacie en présentiel, elle peut soumettre
//    une demande de partenariat directement depuis l'app
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';

const COUNTRIES = [
  { code: 'SN', label: '🇸🇳 Sénégal' },
  { code: 'CI', label: '🇨🇮 Côte d\'Ivoire' },
  { code: 'ML', label: '🇲🇱 Mali' },
  { code: 'FR', label: '🇫🇷 France' },
  { code: 'US', label: '🇺🇸 USA' },
  { code: 'MA', label: '🇲🇦 Maroc' },
  { code: 'OTHER', label: '🌍 Autre' },
];

const CATEGORIES = [
  'Skincare', 'Maquillage', 'Cheveux', 'Hygiène',
  'Suppléments', 'Parapharmacie', 'Médical', 'Autre',
];

export default function PharmaBrands() {
  const [tab, setTab] = useState('catalogue'); // 'catalogue' | 'submit'

  // ─── Catalogue ─────────────────────────────────────────
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('list_public_brands');
        if (cancel) return;
        if (error) {
          toast.error('Catalogue : ' + error.message);
          setBrands([]);
        } else {
          setBrands(data || []);
        }
      } catch (e) {
        if (!cancel) setBrands([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const filteredBrands = useMemo(() => {
    if (!search.trim()) return brands;
    const q = search.toLowerCase();
    return brands.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.tagline || '').toLowerCase().includes(q) ||
      (b.country || '').toLowerCase().includes(q)
    );
  }, [brands, search]);

  // ─── Form proposer ────────────────────────────────────
  const [form, setForm] = useState({
    brand_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    country: 'SN',
    product_category: '',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!form.brand_name.trim()) return toast.error('Nom de marque requis');
    if (!form.contact_email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contact_email)) {
      return toast.error('Email valide requis');
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_brand_partnership', {
        p_brand_name: form.brand_name,
        p_contact_name: form.contact_name,
        p_contact_email: form.contact_email,
        p_contact_phone: form.contact_phone || null,
        p_country: form.country,
        p_product_category: form.product_category || null,
        p_message: form.message || null,
        p_source: 'pharma_app',
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'submission failed');
      setSubmitted(true);
      toast.success('Demande envoyée ! L\'équipe YARAM revient vers vous sous 48h');
    } catch (err) {
      toast.error('Erreur : ' + (err?.message || 'envoi échoué'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="phar-section">
      <header className="phar-header">
        <div>
          <h1>🏷️ Marques partenaires</h1>
          <p>{brands.length > 0 ? `${brands.length} marques en collaboration` : 'Découvre les marques YARAM ou propose la tienne'}</p>
        </div>
      </header>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '2px solid #F4F4F2' }}>
        <button
          onClick={() => setTab('catalogue')}
          style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === 'catalogue' ? '2px solid #1F8B4C' : '2px solid transparent',
            marginBottom: -2, fontWeight: tab === 'catalogue' ? 800 : 600,
            color: tab === 'catalogue' ? '#1F8B4C' : '#666',
            cursor: 'pointer', fontSize: 14,
          }}
        >📚 Catalogue marques</button>
        <button
          onClick={() => setTab('submit')}
          style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === 'submit' ? '2px solid #1F8B4C' : '2px solid transparent',
            marginBottom: -2, fontWeight: tab === 'submit' ? 800 : 600,
            color: tab === 'submit' ? '#1F8B4C' : '#666',
            cursor: 'pointer', fontSize: 14,
          }}
        >✨ Devenir partenaire</button>
      </div>

      {/* ════════ CATALOGUE ════════ */}
      {tab === 'catalogue' && (
        <div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Rechercher une marque…"
            style={{
              width: '100%', padding: 12, fontSize: 14, marginBottom: 16,
              border: '1px solid #DDD', borderRadius: 10, boxSizing: 'border-box',
            }}
          />
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Chargement…</div>
          ) : filteredBrands.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
              {search ? 'Aucune marque trouvée' : 'Aucune marque pour le moment'}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 12,
            }}>
              {filteredBrands.map(b => (
                <div key={b.id} style={{
                  background: 'white', border: '1px solid #EFEFEF',
                  borderRadius: 14, padding: 14, textAlign: 'center',
                  boxShadow: '0 2px 8px rgba(14,91,51,0.04)',
                  transition: 'transform 0.18s ease, box-shadow 0.2s ease',
                }}>
                  {b.img ? (
                    <img src={b.img} alt={b.name}
                      style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 12, marginBottom: 8 }}
                      loading="lazy" decoding="async" />
                  ) : (
                    <div style={{
                      width: 64, height: 64, borderRadius: 12, margin: '0 auto 8px',
                      background: 'linear-gradient(135deg,#E8F5EC 0%,#FFF7E5 100%)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 24, fontWeight: 900, color: '#1F8B4C',
                    }}>
                      {(b.name || '?')[0]}
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0E5B33', marginBottom: 2 }}>{b.name}</div>
                  {b.tagline && <div style={{ fontSize: 10, color: '#888', lineHeight: 1.3, minHeight: 26 }}>{b.tagline.slice(0, 40)}</div>}
                  <div style={{
                    display: 'inline-block', marginTop: 6,
                    background: b.local ? '#E8F5EC' : '#FFF7E5',
                    color: b.local ? '#0E5B33' : '#8B6B00',
                    padding: '2px 8px', borderRadius: 10, fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                  }}>
                    {b.local ? '🇸🇳 LOCAL' : `🌍 ${b.country || 'IMPORT'}`}
                  </div>
                  {b.product_count > 0 && (
                    <div style={{ fontSize: 10, color: '#666', marginTop: 6, fontWeight: 700 }}>
                      {b.product_count} produits
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ FORM DEVENIR PARTENAIRE ════════ */}
      {tab === 'submit' && (
        <div style={{ maxWidth: 560 }}>
          {submitted ? (
            <div style={{
              background: 'linear-gradient(135deg,#E8F5EC 0%,#FFF7E5 100%)',
              borderRadius: 18, padding: 32, textAlign: 'center',
              border: '1px solid rgba(31,139,76,0.18)',
            }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0E5B33', marginBottom: 8 }}>
                Demande reçue !
              </h2>
              <p style={{ color: '#4A6B5A', marginBottom: 18, lineHeight: 1.55 }}>
                Notre équipe étudie votre proposition.<br/>
                Vous recevrez une réponse sous <strong>48h ouvrées</strong> à l'email indiqué.
              </p>
              <button
                onClick={() => { setSubmitted(false); setForm({
                  brand_name: '', contact_name: '', contact_email: '', contact_phone: '',
                  country: 'SN', product_category: '', message: '',
                }); }}
                style={{
                  padding: '12px 28px', borderRadius: 999,
                  background: 'linear-gradient(135deg,#1F8B4C 0%,#0E5B33 100%)',
                  color: 'white', border: 'none', fontWeight: 800, fontSize: 14,
                  cursor: 'pointer', boxShadow: '0 8px 20px rgba(31,139,76,0.3)',
                }}
              >Soumettre une autre demande</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{
              background: 'white', borderRadius: 18, padding: 22,
              border: '1px solid #EFEFEF', boxShadow: '0 4px 16px rgba(14,91,51,0.05)',
            }}>
              <div style={{
                padding: 14, marginBottom: 18,
                background: 'linear-gradient(135deg,#E8F5EC 0%,#FFF7E5 100%)',
                borderRadius: 12, fontSize: 13, color: '#0E5B33', lineHeight: 1.5,
              }}>
                💚 <strong>Votre marque veut rejoindre YARAM ?</strong><br/>
                Remplissez ce formulaire en 30 secondes. Notre équipe vous recontacte sous 48h.
              </div>

              <Field label="Nom de la marque *">
                <input
                  type="text" value={form.brand_name}
                  onChange={e => setForm({ ...form, brand_name: e.target.value })}
                  placeholder="Ex: Sephora, La Roche-Posay, …"
                  style={inputStyle}
                  required
                />
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Nom du contact">
                  <input
                    type="text" value={form.contact_name}
                    onChange={e => setForm({ ...form, contact_name: e.target.value })}
                    placeholder="Aïssatou Diop"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Pays">
                  <select value={form.country}
                    onChange={e => setForm({ ...form, country: e.target.value })}
                    style={inputStyle}>
                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Email *">
                <input
                  type="email" value={form.contact_email}
                  onChange={e => setForm({ ...form, contact_email: e.target.value })}
                  placeholder="contact@marque.com"
                  style={inputStyle}
                  required
                />
              </Field>

              <Field label="Téléphone WhatsApp (optionnel)">
                <input
                  type="tel" value={form.contact_phone}
                  onChange={e => setForm({ ...form, contact_phone: e.target.value })}
                  placeholder="+221 77 000 00 00"
                  style={inputStyle}
                />
              </Field>

              <Field label="Catégorie produit">
                <select value={form.product_category}
                  onChange={e => setForm({ ...form, product_category: e.target.value })}
                  style={inputStyle}>
                  <option value="">— Choisir —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>

              <Field label="Message">
                <textarea
                  value={form.message}
                  onChange={e => setForm({ ...form, message: e.target.value })}
                  placeholder="Présentez votre marque, vos produits phares, le type de collaboration souhaitée…"
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
                />
              </Field>

              <button type="submit" disabled={submitting} style={{
                width: '100%', marginTop: 14, padding: 14,
                background: submitting ? '#999' : 'linear-gradient(135deg,#1F8B4C 0%,#0E5B33 100%)',
                color: 'white', border: 'none', borderRadius: 12,
                fontSize: 15, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer',
                boxShadow: submitting ? 'none' : '0 8px 22px rgba(31,139,76,0.32)',
              }}>
                {submitting ? 'Envoi…' : '✨ Envoyer ma demande'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: 11, fontSize: 14,
  border: '1px solid #DDD', borderRadius: 10, boxSizing: 'border-box',
  fontFamily: 'inherit',
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 800,
        color: '#1F8B4C', textTransform: 'uppercase', letterSpacing: 1,
        marginBottom: 5,
      }}>{label}</label>
      {children}
    </div>
  );
}
