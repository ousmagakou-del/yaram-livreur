// src/lib/exports.js
// Utilitaires d'export pour l'admin Finances : CSV (2 formats) + PDF facture
import { getCachedSetting } from './supabase';

// ─── Téléchargement générique d'un Blob ───
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── CSV générique ───
// rows: array d'objets, headers: [{key, label}], opts: {format: 'excel-fr' | 'standard'}
export function exportCSV(rows, headers, filename, opts = {}) {
  const format = opts.format || 'standard';
  const sep = format === 'excel-fr' ? ';' : ',';

  // Échappe une cellule
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    // En format Excel FR, les nombres décimaux utilisent la virgule
    if (format === 'excel-fr' && typeof v === 'number' && !Number.isInteger(v)) {
      s = v.toString().replace('.', ',');
    }
    // Si contient le séparateur, des guillemets, ou un saut de ligne → entoure de guillemets
    if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [];
  lines.push(headers.map(h => esc(h.label)).join(sep));
  for (const row of rows) {
    lines.push(headers.map(h => esc(row[h.key])).join(sep));
  }

  const content = lines.join('\r\n');
  // Excel FR a besoin du BOM UTF-8 pour les accents
  const bom = format === 'excel-fr' ? '\uFEFF' : '';
  const blob = new Blob([bom + content], {
    type: format === 'excel-fr' ? 'text/csv;charset=utf-8' : 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, filename);
}

// ─── Format date FR ───
export function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('fr-FR');
}

export function fmtDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Format FCFA ───
export function fmtFCFA(n) {
  return (Number(n) || 0).toLocaleString('fr-FR') + ' FCFA';
}

// ─── Facture PDF (HTML imprimable) ───
// Stratégie simple : ouvre une fenêtre avec le HTML stylé, l'utilisateur fait Cmd+P → Sauvegarder en PDF.
// Pas de dépendance externe (pas de jsPDF), zéro risque de casser.
export function openInvoicePrintWindow(order, pharmacy) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) {
    alert("Le navigateur a bloqué l'ouverture. Autorise les popups pour ce site.");
    return;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  const total = Number(order.total) || subtotal;
  const commissionRate = getCachedSetting('commission', 8) / 100;
  const commission = Math.round(total * commissionRate);
  const netPharmacy = total - commission;
  const shortId = (order.id || '').slice(0, 8).toUpperCase();
  const today = new Date().toLocaleDateString('fr-FR');
  const orderDate = order.created_at ? new Date(order.created_at).toLocaleDateString('fr-FR') : '—';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture YARAM #${shortId}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 40px; color: #1A1A1A; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1F8B4C; padding-bottom: 20px; margin-bottom: 30px; }
  .logo { font-size: 28px; font-weight: 800; color: #1F8B4C; }
  .head-right { text-align: right; }
  .head-right h2 { margin: 0; font-size: 18px; }
  .head-right p { margin: 2px 0; color: #6B6B6B; font-size: 13px; }
  .sections { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
  .sec h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #6B6B6B; margin: 0 0 8px; }
  .sec p { margin: 2px 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; padding: 10px 8px; font-size: 11px; text-transform: uppercase; color: #6B6B6B; border-bottom: 2px solid #1A1A1A; }
  td { padding: 12px 8px; border-bottom: 1px solid #EEE; font-size: 13px; }
  td.num, th.num { text-align: right; }
  .totals { margin-left: auto; width: 280px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
  .totals .grand { border-top: 2px solid #1A1A1A; margin-top: 8px; padding-top: 12px; font-size: 18px; font-weight: 800; }
  .commission-block { margin-top: 30px; padding: 16px; background: #F4F4F2; border-radius: 8px; }
  .commission-block h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; color: #6B6B6B; }
  .commission-block .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; }
  .footer { margin-top: 50px; text-align: center; color: #9B9B9B; font-size: 11px; }
  .print-btn { position: fixed; top: 20px; right: 20px; padding: 12px 20px; background: #1F8B4C; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
  @media print {
    .print-btn { display: none; }
    body { padding: 20px; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">📄 Imprimer / PDF</button>

<div class="head">
  <div>
    <div class="logo">YARAM</div>
    <p style="margin: 6px 0 0; color: #6B6B6B; font-size: 13px;">Beauté & Santé · Sénégal</p>
  </div>
  <div class="head-right">
    <h2>Facture</h2>
    <p>N° ${shortId}</p>
    <p>Émise le ${today}</p>
  </div>
</div>

<div class="sections">
  <div class="sec">
    <h3>Pharmacie</h3>
    <p><strong>${pharmacy?.name || '—'}</strong></p>
    ${pharmacy?.address ? `<p>${pharmacy.address}</p>` : ''}
    <p>${pharmacy?.neighborhood ? pharmacy.neighborhood + ', ' : ''}${pharmacy?.city || ''}</p>
    ${pharmacy?.phone ? `<p>${pharmacy.phone}</p>` : ''}
  </div>
  <div class="sec">
    <h3>Commande</h3>
    <p><strong>#${shortId}</strong></p>
    <p>Passée le ${orderDate}</p>
    <p>Cliente : ${order.customer_name || '—'}</p>
    <p>Statut : ${order.status || '—'}</p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Produit</th>
      <th class="num">Qté</th>
      <th class="num">Prix unitaire</th>
      <th class="num">Total</th>
    </tr>
  </thead>
  <tbody>
    ${items.map(it => {
      const name = (it.name || '—').replace(/</g, '&lt;');
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      return `<tr>
        <td>${name}</td>
        <td class="num">${qty}</td>
        <td class="num">${price.toLocaleString('fr-FR')}</td>
        <td class="num">${(qty * price).toLocaleString('fr-FR')}</td>
      </tr>`;
    }).join('')}
  </tbody>
</table>

<div class="totals">
  <div class="row"><span>Sous-total</span><strong>${subtotal.toLocaleString('fr-FR')} FCFA</strong></div>
  <div class="row grand"><span>Total TTC</span><span>${total.toLocaleString('fr-FR')} FCFA</span></div>
</div>

<div class="commission-block">
  <h4>Détail commission YARAM</h4>
  <div class="row"><span>Commission YARAM (${(commissionRate * 100).toFixed(commissionRate * 100 % 1 === 0 ? 0 : 1)}%)</span><strong>${commission.toLocaleString('fr-FR')} FCFA</strong></div>
  <div class="row"><span>Net pour la pharmacie</span><strong>${netPharmacy.toLocaleString('fr-FR')} FCFA</strong></div>
</div>

<div class="footer">
  Document généré automatiquement · YARAM — Beauté pour la peau africaine 🇸🇳
</div>
</body>
</html>`;

  w.document.write(html);
  w.document.close();
}
