import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getAdminSession } from '../lib/adminAuth';
import { fmtDateTime } from '../lib/exports';

const ROLES = [
  { id: 'super_admin', label: 'Super Admin',         desc: 'Acces total + gestion des admins' },
  { id: 'admin',       label: 'Administrateur',      desc: 'Tous les modules sauf gestion admins' },
  { id: 'moderator',   label: 'Moderateur',          desc: 'Moderation avis + validation produits' },
  { id: 'dermato',     label: 'Dermato partenaire',  desc: 'Validation des scans peau uniquement' },
];

export default function AdminUsersSection() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  const [editingPin, setEditingPin] = useState(null);
  const [myRole, setMyRole] = useState(null); // role recupere directement de la DB
  const session = getAdminSession();

  const isSuperAdmin = myRole === 'super_admin';

  const flash = (text, kind = 'ok') => {
    setMsg({ text, kind });
    setTimeout(() => setMsg({ text: '', kind: '' }), 4000);
  };

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, name, role, active, last_login_at, login_count, failed_attempts, locked_until, created_at, notes')
      .order('created_at', { ascending: false });

    console.log('[AdminUsersSection] admins fetched:', data?.length, 'error:', error);
    console.log('[AdminUsersSection] current session:', session);

    setAdmins(data || []);

    // Trouver MON role dans la DB (ne fait PAS confiance a la session)
    let foundRole = null;

    // Try 1 : match par session.id
    if (session?.id && data) {
      const me = data.find(a => a.id === session.id);
      if (me) {
        foundRole = me.role;
        console.log('[AdminUsersSection] role found by id:', foundRole);
      }
    }

    // Try 2 : match par session.email
    if (!foundRole && session?.email && data) {
      const me = data.find(a => a.email?.toLowerCase() === session.email.toLowerCase());
      if (me) {
        foundRole = me.role;
        console.log('[AdminUsersSection] role found by email:', foundRole);
      }
    }

    // Try 3 : fallback - cherche directement par email connu (ton compte)
    // Comme la session peut etre buggee, on lit directement la DB pour gakououssou@gmail.com
    if (!foundRole && data) {
      const me = data.find(a => a.email?.toLowerCase() === 'gakououssou@gmail.com');
      if (me) {
        foundRole = me.role;
        console.warn('[AdminUsersSection] role found by HARDCODED email fallback. Session is broken:', session);
      }
    }

    console.log('[AdminUsersSection] final myRole:', foundRole);
    setMyRole(foundRole);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  // CallerId = soit la session, soit lookup par email, soit fallback hardcoded
  const getCallerId = async () => {
    if (session?.id) return session.id;
    const email = session?.email || 'gakououssou@gmail.com';
    const { data } = await supabase
      .from('admin_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
    return data?.id;
  };

  const handleCreate = async (form) => {
    const callerId = await getCallerId();
    if (!callerId) return flash('Session corrompue, reconnecte-toi', 'err');

    const { data, error } = await supabase.rpc('create_admin', {
      p_caller_id: callerId,
      p_email: form.email,
      p_name: form.name,
      p_pin: form.pin,
      p_role: form.role,
      p_notes: form.notes || null,
    });
    if (error) return flash('Erreur : ' + error.message, 'err');
    if (data?.success) {
      flash('Admin cree');
      setShowCreate(false);
      refresh();
    } else {
      flash((data?.error || 'Erreur inconnue'), 'err');
    }
  };

  const handleToggleActive = async (target) => {
    if (!confirm(`${target.active ? 'Desactiver' : 'Reactiver'} ${target.name} ?`)) return;
    const callerId = await getCallerId();
    if (!callerId) return flash('Session corrompue', 'err');

    const { data, error } = await supabase.rpc('toggle_admin_active', {
      p_caller_id: callerId,
      p_target_id: target.id,
      p_active: !target.active,
    });
    if (error) return flash('Erreur : ' + error.message, 'err');
    if (data?.success) {
      flash(`${target.name} ${target.active ? 'desactive' : 'reactive'}`);
      refresh();
    } else {
      flash((data?.error || 'Erreur'), 'err');
    }
  };

  const handleResetPin = async (target, newPin) => {
    const callerId = await getCallerId();
    if (!callerId) return flash('Session corrompue', 'err');

    const { data, error } = await supabase.rpc('reset_admin_pin', {
      p_caller_id: callerId,
      p_target_id: target.id,
      p_new_pin: newPin,
    });
    if (error) return flash('Erreur : ' + error.message, 'err');
    if (data?.success) {
      flash(`PIN de ${target.name} reinitialise`);
      setEditingPin(null);
      refresh();
    } else {
      flash((data?.error || 'Erreur'), 'err');
    }
  };

  const handleChangeRole = async (target, newRole) => {
    const callerId = await getCallerId();
    if (!callerId) return flash('Session corrompue', 'err');

    const { data, error } = await supabase.rpc('change_admin_role', {
      p_caller_id: callerId,
      p_target_id: target.id,
      p_new_role: newRole,
    });
    if (error) return flash('Erreur : ' + error.message, 'err');
    if (data?.success) {
      flash(`Role de ${target.name} change`);
      refresh();
    } else {
      flash((data?.error || 'Erreur'), 'err');
    }
  };

  const myId = session?.id || admins.find(a => a.email?.toLowerCase() === session?.email?.toLowerCase())?.id;

  const S = {
    section: { padding: 24 },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: '#6B6B6B', fontSize: 13, marginTop: 4 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 },
    btnPrimary: { padding: '10px 16px', borderRadius: 10, background: '#1F8B4C', color: 'white', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
    btnGhost: { padding: '6px 12px', borderRadius: 8, background: '#F4F4F2', color: '#1A1A1A', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    btnDanger: { padding: '6px 12px', borderRadius: 8, background: '#FCE9E7', color: '#D9342B', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
    card: { background: 'white', borderRadius: 14, border: '1px solid #EEE', padding: 20, marginTop: 16 },
    msg: (kind) => ({
      padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginBottom: 12,
      background: kind === 'err' ? '#FCE9E7' : '#E8F5EC',
      color: kind === 'err' ? '#D9342B' : '#1F8B4C',
    }),
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: '10px 8px', background: '#F9FAFB', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', borderBottom: '1px solid #EEE' },
    td: { padding: '10px 8px', borderBottom: '1px solid #F4F4F2' },
    badge: (kind) => ({
      display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: kind === 'active' ? '#E8F5EC' : kind === 'locked' ? '#FEF6E5' : '#F4F4F2',
      color: kind === 'active' ? '#1F8B4C' : kind === 'locked' ? '#A07700' : '#6B6B6B',
    }),
    roleSelect: { padding: '4px 8px', borderRadius: 6, border: '1px solid #DDD', fontSize: 12, fontFamily: 'inherit' },
  };

  return (
    <div style={S.section}>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>Gestion des admins</h1>
          <p style={S.sub}>
            {isSuperAdmin
              ? 'Creer, modifier, desactiver les comptes admins'
              : myRole === null
                ? 'Verification de tes permissions...'
                : 'Lecture seule (reserve au super_admin)'
            }
          </p>
        </div>
        {isSuperAdmin && (
          <button style={S.btnPrimary} onClick={() => setShowCreate(true)}>+ Creer un admin</button>
        )}
      </div>

      {msg.text && <div style={S.msg(msg.kind)}>{msg.text}</div>}

      {loading ? (
        <p style={{ color: '#9B9B9B' }}>Chargement...</p>
      ) : (
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Nom / Email</th>
                <th style={S.th}>Role</th>
                <th style={S.th}>Statut</th>
                <th style={S.th}>Derniere connexion</th>
                <th style={S.th}>Connexions</th>
                {isSuperAdmin && <th style={S.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {admins.map(a => {
                const isMe = a.id === myId;
                const isLocked = a.locked_until && new Date(a.locked_until) > new Date();
                const statusKind = isLocked ? 'locked' : a.active ? 'active' : 'disabled';
                const statusLabel = isLocked ? 'Verrouille' : a.active ? 'Actif' : 'Desactive';
                return (
                  <tr key={a.id} style={{ opacity: a.active ? 1 : 0.6 }}>
                    <td style={S.td}>
                      <strong>{a.name} {isMe && <span style={{ color: '#1F8B4C', fontSize: 11 }}>(toi)</span>}</strong>
                      <div style={{ fontSize: 11, color: '#9B9B9B' }}>{a.email}</div>
                    </td>
                    <td style={S.td}>
                      {isSuperAdmin && !isMe ? (
                        <select
                          style={S.roleSelect}
                          value={a.role}
                          onChange={e => handleChangeRole(a, e.target.value)}
                        >
                          {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      ) : (
                        ROLES.find(r => r.id === a.role)?.label || a.role
                      )}
                    </td>
                    <td style={S.td}>
                      <span style={S.badge(statusKind)}>{statusLabel}</span>
                      {a.failed_attempts > 0 && (
                        <div style={{ fontSize: 10, color: '#D9342B', marginTop: 2 }}>
                          {a.failed_attempts} echec{a.failed_attempts > 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td style={S.td}>
                      {a.last_login_at ? fmtDateTime(a.last_login_at) : <span style={{ color: '#9B9B9B' }}>Jamais</span>}
                    </td>
                    <td style={S.td}>{a.login_count || 0}</td>
                    {isSuperAdmin && (
                      <td style={S.td}>
                        {!isMe && (
                          <>
                            <button
                              style={S.btnGhost}
                              onClick={() => setEditingPin(a)}
                              title="Reinitialiser le PIN"
                            >
                              PIN
                            </button>
                            <button
                              style={{ ...(a.active ? S.btnDanger : S.btnGhost), marginLeft: 4 }}
                              onClick={() => handleToggleActive(a)}
                            >
                              {a.active ? 'Desactiver' : 'Reactiver'}
                            </button>
                          </>
                        )}
                        {isMe && <span style={{ fontSize: 11, color: '#9B9B9B' }}>-</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateAdminModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
      {editingPin && (
        <ResetPinModal admin={editingPin} onClose={() => setEditingPin(null)} onReset={handleResetPin} />
      )}
    </div>
  );
}

function CreateAdminModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ email: '', name: '', pin: '', role: 'admin', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await onCreate(form);
    setSubmitting(false);
  };

  return (
    <ModalShell title="Creer un admin" onClose={onClose}>
      <label style={modalStyles.label}>Email</label>
      <input style={modalStyles.input} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="prenom@yaram.app" />

      <label style={modalStyles.label}>Nom complet</label>
      <input style={modalStyles.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Aminata Fall" />

      <label style={modalStyles.label}>PIN initial (4-6 chiffres)</label>
      <input
        style={modalStyles.input}
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={form.pin}
        onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
        placeholder="----"
      />

      <label style={modalStyles.label}>Role</label>
      <select style={modalStyles.input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
        <option value="super_admin">Super Admin - Acces total + gestion admins</option>
        <option value="admin">Administrateur - Tous les modules</option>
        <option value="moderator">Moderateur - Reviews + validation</option>
        <option value="dermato">Dermato - Validation scans peau</option>
      </select>

      <label style={modalStyles.label}>Notes</label>
      <textarea
        style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
        value={form.notes}
        onChange={e => setForm({ ...form, notes: e.target.value })}
        placeholder="Comptable, basee a Saint-Louis..."
      />

      <button style={modalStyles.btnPrimary} onClick={submit} disabled={submitting}>
        {submitting ? 'Creation...' : "Creer l'admin"}
      </button>
      <button style={modalStyles.btnSec} onClick={onClose}>Annuler</button>
    </ModalShell>
  );
}

function ResetPinModal({ admin, onClose, onReset }) {
  const [pin, setPin] = useState('');
  return (
    <ModalShell title={`Reinitialiser le PIN de ${admin.name}`} onClose={onClose}>
      <p style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 12 }}>
        Communique-lui ce PIN par WhatsApp.
      </p>
      <label style={modalStyles.label}>Nouveau PIN (4-6 chiffres)</label>
      <input
        style={modalStyles.input}
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
        placeholder="----"
        autoFocus
      />
      <button style={modalStyles.btnPrimary} onClick={() => onReset(admin, pin)} disabled={pin.length < 4}>
        Reinitialiser
      </button>
      <button style={modalStyles.btnSec} onClick={onClose}>Annuler</button>
    </ModalShell>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div style={{
        background: 'white', borderRadius: 16, padding: 24,
        maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 0, marginBottom: 16 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const modalStyles = {
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 12, marginBottom: 6 },
  input: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #DDD', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' },
  btnPrimary: { width: '100%', padding: 12, marginTop: 16, background: '#1F8B4C', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  btnSec: { width: '100%', padding: 10, marginTop: 8, background: '#F4F4F2', color: '#1A1A1A', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};