import { useState, useEffect } from 'react';
import { getSiteSettings, updateSiteSettings, uploadBannerImage } from '../lib/supabase';
import { adminLogAction } from '../lib/adminApi';
import { toast, confirmDialog } from '../lib/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration generale du site — persistee en DB (table site_settings).
//
// MIGRATION SQL A LANCER UNE FOIS dans Supabase Studio :
//
//   CREATE TABLE IF NOT EXISTS public.site_settings (
//     key         text PRIMARY KEY,
//     value       jsonb NOT NULL,
//     updated_at  timestamptz DEFAULT now()
//   );
//   ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
//   -- Lecture publique (l'app cliente peut lire les settings publics)
//   CREATE POLICY "settings_read_all" ON public.site_settings
//     FOR SELECT USING (true);
//   -- Ecriture : service_role uniquement (l'admin passe par RPC ou edge function)
//   -- Pour le MVP on autorise l'ecriture cote anon mais a securiser en prod !
//   CREATE POLICY "settings_write_anon_TEMP" ON public.site_settings
//     FOR ALL USING (true) WITH CHECK (true);
//
// Note : les VRAIES sources d'info de l'app (commission 8% dans supabase.js,
// frais livraison par ville dans utils.js, etc.) ne sont PAS encore branchees
// sur cette table. Pour le moment cette page persiste les valeurs en DB mais
// le code ne les lit pas. Prochaine etape : remplacer les constantes par des
// lectures de getSiteSettings() dans les helpers concernes.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  siteName: 'YARAM',
  commission: 8,
  deliveryFee: 1500,
  freeDeliveryFrom: 50000,
  whatsapp: '+221 77 760 89 83',
  email: 'contact@yaram.sn',
  primaryColor: '#1F8B4C',
  accentColor: '#FFD700',
  // ─── Hero banner Home (3 lignes typo XXL + sous-titre + couleurs) ───
  heroEnabled: true,
  heroLine1: 'Zéro',
  heroLine2: 'frais de',
  heroLine3: 'service',
  heroSubtext: 'Livraison à 1 500 FCFA',
  heroBackground: '#1F8B4C',
  heroImage: '',                // ← URL image de couverture (override la couleur si défini)
  heroOverlayOpacity: 0.5,      // ← 0.0 à 1.0 : voile noir sur l'image pour lisibilité texte
  heroLine1Color: '#FFF8E5',
  heroLineColor: '#FFFFFF',
  heroSubBg: '#F4B53A',
  heroSubColor: '#4A1B0C',
  heroCtaLabel: 'Découvrir les promos',
  heroCtaRoute: 'promos',
  // ─── Cycles d'animation (3 phrases séparées par | pour chaque ligne) ───
  heroLine1Cycle: 'ZÉRO|100%|LIVRAISON',
  heroLine2Cycle: 'FRAIS DE|AUTHENTIQUE|EN 1H30',
  heroLine3Cycle: 'SERVICE|MARQUES|CHRONO',
  // ─── Boutique internationale ───
  intlBgImage: '',
};

export default function SettingsSection() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIntl, setUploadingIntl] = useState(false);

  // ─── Upload image fond pour Boutique internationale ───
  const handleIntlBgUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIntl(true);
    try {
      const url = await uploadBannerImage(file);
      if (url) {
        setSettings(s => ({ ...s, intlBgImage: url }));
        toast.success('Image uploadée — clique sur Enregistrer pour appliquer');
      }
    } catch (err) {
      toast.error('Upload échoué : ' + (err?.message || 'erreur'), { duration: 7000 });
    } finally {
      setUploadingIntl(false);
      e.target.value = '';
    }
  };

  const handleIntlBgClear = async () => {
    if (!(await confirmDialog('Retirer l\'image de fond ?', { confirmLabel: 'Retirer' }))) return;
    setSettings(s => ({ ...s, intlBgImage: '' }));
    toast.success('Image retirée — clique sur Enregistrer pour appliquer');
  };

  // ─── Upload image de couverture pour Hero banner home ───
  const [uploadingHero, setUploadingHero] = useState(false);
  const handleHeroImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHero(true);
    try {
      const url = await uploadBannerImage(file);
      if (url) {
        setSettings(s => ({ ...s, heroImage: url }));
        toast.success('Image uploadée — clique sur Enregistrer pour appliquer');
      }
    } catch (err) {
      toast.error('Upload échoué : ' + (err?.message || 'erreur'), { duration: 7000 });
    } finally {
      setUploadingHero(false);
      e.target.value = '';
    }
  };

  const handleHeroImageClear = async () => {
    if (!(await confirmDialog('Retirer l\'image de couverture du hero ?', { confirmLabel: 'Retirer' }))) return;
    setSettings(s => ({ ...s, heroImage: '' }));
    toast.success('Image retirée — clique sur Enregistrer pour appliquer');
  };

  useEffect(() => {
    (async () => {
      const remote = await getSiteSettings();
      // Merge DB sur defaults pour gerer le cas d'une table vide ou partielle
      setSettings({ ...DEFAULTS, ...remote });
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const result = await updateSiteSettings(settings);
    setSaving(false);
    if (result.success) {
      adminLogAction({
        action:     'update_site_settings',
        targetType: 'site_settings',
        targetId:   null,
        before:     null,
        after:      { keys: Object.keys(settings || {}), updated_count: Object.keys(settings || {}).length },
      }).catch(() => { /* best-effort */ });
      toast.success('Paramètres enregistrés en base de données');
    } else {
      toast.error('Échec sauvegarde : ' + (result.error || 'erreur inconnue'));
    }
  };

  const handleReset = async () => {
    if (!(await confirmDialog('Réinitialiser aux valeurs par défaut ?', { confirmLabel: 'Réinitialiser', danger: true }))) return;
    setSettings(DEFAULTS);
    setSaving(true);
    const result = await updateSiteSettings(DEFAULTS);
    setSaving(false);
    if (result.success) {
      adminLogAction({
        action:     'reset_site_settings',
        targetType: 'site_settings',
        targetId:   null,
        before:     null,
        after:      { reset_to_defaults: true, keys: Object.keys(DEFAULTS) },
      }).catch(() => { /* best-effort */ });
      toast.success('Paramètres réinitialisés');
    } else {
      toast.error('Échec : ' + (result.error || 'erreur inconnue'));
    }
  };

  return (
    <div className="adm-section">
      <header className="adm-header">
        <div>
          <h1>Paramètres</h1>
          <p>Configuration générale YARAM (persistée en DB)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adm-btn-sec" onClick={handleReset} disabled={saving || loading}>↺ Réinitialiser</button>
          <button className="adm-btn-pri" onClick={handleSave} disabled={saving || loading}>
            {saving ? '💾 Sauvegarde…' : '💾 Enregistrer'}
          </button>
        </div>
      </header>

      {/* ────────── INFO sur quoi est branche / pas encore ────────── */}
      <div style={{
        background: '#E6F1FB',
        border: '1.5px solid #4285F4',
        borderRadius: 12,
        padding: 14,
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>ℹ️</span>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#185FA5' }}>
          <strong>Les valeurs sont sauvegardées en base</strong> (table <code>site_settings</code>).
          Toutefois certains modules de l'app (calcul de la commission dans <code>supabase.js</code>,
          frais de livraison par ville dans <code>utils.js</code>) utilisent encore des valeurs
          en dur dans le code. Modifier ici ne les affecte pas <em>encore</em> — la prochaine
          étape sera de les brancher sur <code>getSiteSettings()</code>.
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement…</p>
      ) : (
        <div className="adm-form-grid">
          <div className="adm-form-section">
            <h3>🏢 Identité</h3>
            <label>Nom de la boutique<input value={settings.siteName} onChange={e => setSettings({ ...settings, siteName: e.target.value })} /></label>
            <label>Email contact<input value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} /></label>
            <label>WhatsApp<input value={settings.whatsapp} onChange={e => setSettings({ ...settings, whatsapp: e.target.value })} /></label>
          </div>

          <div className="adm-form-section">
            <h3>💰 Business <small style={{ color: '#9B9B9B', fontWeight: 500, fontSize: 11 }}>(à câbler côté code)</small></h3>
            <label>Commission YARAM (%)<input type="number" step="0.1" value={settings.commission} onChange={e => setSettings({ ...settings, commission: parseFloat(e.target.value) || 0 })} /></label>
            <label>Frais livraison Dakar (FCFA)<input type="number" value={settings.deliveryFee} onChange={e => setSettings({ ...settings, deliveryFee: parseInt(e.target.value) || 0 })} /></label>
            <label>Livraison gratuite dès (FCFA)<input type="number" value={settings.freeDeliveryFrom} onChange={e => setSettings({ ...settings, freeDeliveryFrom: parseInt(e.target.value) || 0 })} /></label>
          </div>

          <div className="adm-form-section">
            <h3>🎨 Couleurs <small style={{ color: '#9B9B9B', fontWeight: 500, fontSize: 11 }}>(à câbler côté CSS)</small></h3>
            <label>Couleur principale<input type="color" value={settings.primaryColor} onChange={e => setSettings({ ...settings, primaryColor: e.target.value })} style={{ height: 44 }} /></label>
            <label>Couleur accent<input type="color" value={settings.accentColor} onChange={e => setSettings({ ...settings, accentColor: e.target.value })} style={{ height: 44 }} /></label>
          </div>

          {/* ════════ HERO BANNER (page Home) ════════ */}
          <div className="adm-form-section" style={{ gridColumn: '1 / -1' }}>
            <h3>🎨 Hero banner (page Home)</h3>
            <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 12 }}>
              Slogan typo XXL animé en haut de la home cliente. 3 lignes de texte
              en très gros, sous-titre en pill, couleurs personnalisables. Les
              utilisatrices voient ce nouveau texte au prochain refresh de l'app.
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={settings.heroEnabled !== false}
                onChange={e => setSettings({ ...settings, heroEnabled: e.target.checked })}
              />
              <span>Afficher le hero banner</span>
            </label>

            {/* ── Aperçu live ── */}
            <div style={{
              background: settings.heroBackground || '#1F8B4C',
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                fontSize: 38, fontWeight: 900, color: settings.heroLine1Color,
                lineHeight: 0.92, letterSpacing: -1.5, textTransform: 'uppercase',
              }}>{settings.heroLine1 || 'Ligne 1'}</div>
              <div style={{
                fontSize: 30, fontWeight: 900, color: settings.heroLineColor,
                lineHeight: 0.92, letterSpacing: -1.2, textTransform: 'uppercase', marginTop: 2,
              }}>{settings.heroLine2 || 'Ligne 2'}</div>
              <div style={{
                fontSize: 30, fontWeight: 900, color: settings.heroLineColor,
                lineHeight: 0.92, letterSpacing: -1.2, textTransform: 'uppercase', marginTop: 2,
              }}>{settings.heroLine3 || 'Ligne 3'}</div>
              {settings.heroSubtext && (
                <div style={{
                  display: 'inline-block', marginTop: 10,
                  background: settings.heroSubBg, color: settings.heroSubColor,
                  fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
                  fontStyle: 'italic',
                }}>{settings.heroSubtext}</div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>Ligne 1<input value={settings.heroLine1} onChange={e => setSettings({ ...settings, heroLine1: e.target.value })} maxLength={20} /></label>
              <label>Ligne 2<input value={settings.heroLine2} onChange={e => setSettings({ ...settings, heroLine2: e.target.value })} maxLength={20} /></label>
              <label>Ligne 3<input value={settings.heroLine3} onChange={e => setSettings({ ...settings, heroLine3: e.target.value })} maxLength={20} /></label>
              <label>Sous-titre (pill)<input value={settings.heroSubtext} onChange={e => setSettings({ ...settings, heroSubtext: e.target.value })} maxLength={40} /></label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 12 }}>
              <label>Fond hero<input type="color" value={settings.heroBackground} onChange={e => setSettings({ ...settings, heroBackground: e.target.value })} style={{ height: 40 }} /></label>
              <label>Couleur L1<input type="color" value={settings.heroLine1Color} onChange={e => setSettings({ ...settings, heroLine1Color: e.target.value })} style={{ height: 40 }} /></label>
              <label>Couleur L2/L3<input type="color" value={settings.heroLineColor} onChange={e => setSettings({ ...settings, heroLineColor: e.target.value })} style={{ height: 40 }} /></label>
              <label>Pill fond<input type="color" value={settings.heroSubBg} onChange={e => setSettings({ ...settings, heroSubBg: e.target.value })} style={{ height: 40 }} /></label>
              <label>Pill texte<input type="color" value={settings.heroSubColor} onChange={e => setSettings({ ...settings, heroSubColor: e.target.value })} style={{ height: 40 }} /></label>
            </div>

            {/* ════════ IMAGE DE COUVERTURE (override couleur de fond) ════════ */}
            <div style={{ marginTop: 20, padding: 16, background: '#FAFAFA', borderRadius: 12, border: '1px solid #E5E5E5' }}>
              <h4 style={{ margin: 0, marginBottom: 8 }}>📸 Image de couverture (optionnel)</h4>
              <p style={{ fontSize: 12, color: '#6B6B6B', marginBottom: 12 }}>
                Si tu uploades une image, elle remplace la couleur de fond du hero. Un voile noir transparent
                est appliqué par dessus pour que le texte blanc reste lisible.
              </p>

              {/* Aperçu live */}
              <div style={{
                position: 'relative',
                height: 160,
                borderRadius: 12,
                overflow: 'hidden',
                background: settings.heroImage
                  ? `url(${settings.heroImage}) center/cover`
                  : settings.heroBackground || '#1F8B4C',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {settings.heroImage && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: `rgba(0,0,0,${settings.heroOverlayOpacity || 0.5})`,
                  }} />
                )}
                <div style={{
                  position: 'relative', zIndex: 1, color: '#fff',
                  fontSize: 22, fontWeight: 900, textAlign: 'center', letterSpacing: -0.5,
                  textShadow: settings.heroImage ? '0 2px 8px rgba(0,0,0,0.5)' : 'none',
                }}>
                  {settings.heroImage ? '✨ Aperçu avec voile' : 'Pas d\'image — fond couleur'}
                </div>
              </div>

              {/* Upload + clear */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <label style={{
                  display: 'inline-block', padding: '10px 18px',
                  background: '#1F8B4C', color: '#fff', borderRadius: 8,
                  cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  opacity: uploadingHero ? 0.6 : 1,
                }}>
                  {uploadingHero ? 'Upload…' : (settings.heroImage ? '🔄 Changer l\'image' : '📤 Uploader une image')}
                  <input type="file" accept="image/*" onChange={handleHeroImageUpload} disabled={uploadingHero} style={{ display: 'none' }} />
                </label>
                {settings.heroImage && (
                  <button
                    type="button"
                    onClick={handleHeroImageClear}
                    style={{
                      padding: '10px 14px', background: '#fff', color: '#D9342B',
                      border: '2px solid #D9342B', borderRadius: 8,
                      cursor: 'pointer', fontWeight: 700, fontSize: 13,
                    }}
                  >Retirer l'image</button>
                )}
              </div>

              {/* Slider opacité voile */}
              {settings.heroImage && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Opacité du voile noir : <span style={{ color: '#1F8B4C' }}>{Math.round((settings.heroOverlayOpacity || 0.5) * 100)}%</span>
                  </label>
                  <p style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 6 }}>
                    Voile sombre par dessus l'image pour lisibilité du texte blanc.
                    0% = image brute (texte peu lisible), 100% = noir total.
                  </p>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.heroOverlayOpacity || 0.5}
                    onChange={e => setSettings({ ...settings, heroOverlayOpacity: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                    <span>0% (clair)</span>
                    <span>50% (recommandé)</span>
                    <span>100% (sombre)</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <label>CTA label (optionnel)<input value={settings.heroCtaLabel} onChange={e => setSettings({ ...settings, heroCtaLabel: e.target.value })} placeholder="Découvrir les promos" /></label>
              <label>CTA route (au clic)
                <select value={settings.heroCtaRoute} onChange={e => setSettings({ ...settings, heroCtaRoute: e.target.value })} style={{ height: 40 }}>
                  <option value="promos">Promos</option>
                  <option value="pharmacies">Pharmacies</option>
                  <option value="categories">Catégories</option>
                  <option value="international">International</option>
                  <option value="cart">Panier</option>
                  <option value="">Aucune (juste affichage)</option>
                </select>
              </label>
            </div>

            {/* ────── ANIMATION : 3 lignes qui cyclent toutes les 2.6s ────── */}
            <div style={{
              marginTop: 18,
              padding: 14,
              background: '#FFFBEB',
              border: '1.5px dashed #F4B53A',
              borderRadius: 12,
            }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>✨ Animation des 3 lignes (cycle)</h4>
              <p style={{ fontSize: 12, color: '#6B6B6B', margin: '0 0 10px', lineHeight: 1.5 }}>
                Sépare les phrases par <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4 }}>|</code>.
                Chaque ligne cycle indépendamment toutes les 2,6 s.
                Exemple : <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4 }}>ZÉRO|100%|LIVRAISON</code>
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                <label>Ligne 1 — cycle
                  <input
                    value={settings.heroLine1Cycle || ''}
                    onChange={e => setSettings({ ...settings, heroLine1Cycle: e.target.value })}
                    placeholder="ZÉRO|100%|LIVRAISON"
                  />
                </label>
                <label>Ligne 2 — cycle
                  <input
                    value={settings.heroLine2Cycle || ''}
                    onChange={e => setSettings({ ...settings, heroLine2Cycle: e.target.value })}
                    placeholder="FRAIS DE|AUTHENTIQUE|EN 1H30"
                  />
                </label>
                <label>Ligne 3 — cycle
                  <input
                    value={settings.heroLine3Cycle || ''}
                    onChange={e => setSettings({ ...settings, heroLine3Cycle: e.target.value })}
                    placeholder="SERVICE|MARQUES|CHRONO"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* ════════ BLOC : Boutique internationale ════════ */}
          <div className="adm-form-section">
            <h3>🌍 Boutique internationale</h3>
            <p style={{ fontSize: 13, color: '#6B6B6B', margin: '0 0 14px' }}>
              Image de fond personnalisée pour la card "Boutique internationale" sur Home.
              Si vide, gradient bleu nuit par défaut.
            </p>

            <div style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '16 / 9',
              borderRadius: 14,
              overflow: 'hidden',
              background: settings.intlBgImage
                ? `url(${settings.intlBgImage}) center/cover`
                : 'linear-gradient(155deg, #002F66 0%, #003F88 30%, #00498A 60%, #002a5c 100%)',
              marginBottom: 12,
              border: '1px solid #E2E2E0',
            }}>
              {!settings.intlBgImage && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 13,
                  fontWeight: 600,
                }}>Aucune image · gradient par défaut</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className="adm-btn-sec" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {uploadingIntl ? '⏳ Upload…' : '📤 Uploader une image'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleIntlBgUpload}
                  disabled={uploadingIntl}
                  style={{ display: 'none' }}
                />
              </label>
              {settings.intlBgImage && (
                <button className="adm-btn-sec" onClick={handleIntlBgClear} type="button">
                  🗑 Retirer
                </button>
              )}
            </div>

            <p style={{ fontSize: 11, color: '#999', margin: '10px 0 0' }}>
              Recommandé : 1200×675px ou plus, format paysage 16:9, JPG/PNG.
              L'image est compressée automatiquement à 1200px max côté long.
            </p>
          </div>

          <div className="adm-form-section">
            <h3>ℹ️ À propos</h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: '#6B6B6B' }}>
              <strong>YARAM v0.1</strong><br />
              Marketplace beauté Sénégal 🇸🇳<br />
              Commission marketplace : {settings.commission}%<br />
              Livraison YARAM mutualisée
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
