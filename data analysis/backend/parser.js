// Reads CSV / Excel from a memory Buffer and converts it to a standard structure.
const XLSX = require('xlsx');
const path = require('path');

class ValidationError extends Error { constructor(m) { super(m); this.status = 400; } }

function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,$€£₹%\s]/g, '');
  return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? parseFloat(s) : null;
}
function toISO(v, allowNumber) {
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number' && allowNumber && v > 20000 && v < 80000) d = new Date(Math.round((v - 25569) * 864e5)); // Excel serial
  else if (typeof v === 'string' && v.trim()) {
    const t = v.trim(), m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    d = m && +m[1] > 12 ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(t);
  }
  if (!d || isNaN(d)) return null;
  const x = new Date(d.getTime() + 12 * 36e5); // +12h avoids timezone day-shift
  const y = x.getUTCFullYear();
  return y >= 1970 && y <= 2100 ? x.toISOString().slice(0, 10) : null;
}

function parseBuffer(buf, filename) {
  let rows;
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    if (!wb.SheetNames.length) throw new Error('no sheet');
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
  } catch (e) {
    throw new ValidationError('The file could not be read. Please upload a valid, unprotected CSV or Excel (.xlsx/.xls) file.');
  }
  if (!rows.length) throw new ValidationError('The file has no data rows. The first row must contain column names, followed by records.');
  const headers = Object.keys(rows[0]).filter(h => !/^__EMPTY/.test(h));
  if (headers.length < 2) throw new ValidationError('The file needs at least 2 columns: a Date column and a price column.');

  const nonBlank = h => rows.filter(r => r[h] !== '' && r[h] != null);
  const dateRate = h => { const v = nonBlank(h); const ok = /date|time|day|period/i.test(h);
    return v.length ? v.filter(r => toISO(r[h], ok) !== null && (ok || typeof r[h] !== 'number')).length / v.length : 0; };
  const numRate = h => { const v = nonBlank(h); return v.length ? v.filter(r => toNum(r[h]) !== null).length / v.length : 0; };

  const dateCol = headers.find(h => /date|time|day|period/i.test(h) && dateRate(h) >= 0.8) || headers.find(h => dateRate(h) >= 0.8);
  if (!dateCol) throw new ValidationError('No valid Date column found. Add a column named "Date" with dates like 2024-01-31.');
  const dateNum = /date|time|day|period/i.test(dateCol);

  const assetCol = headers.find(h => h !== dateCol && /^(asset|symbol|ticker|name|instrument|security)$/i.test(h.trim()));
  const numeric = headers.filter(h => h !== dateCol && h !== assetCol && numRate(h) >= 0.8);
  if (!numeric.length) throw new ValidationError('No numeric price columns found. Each asset needs a column of prices (numbers), e.g. "Close" or "Gold".');
  const pick = list => { for (const k of list) { const f = numeric.find(h => h.trim().toLowerCase() === k); if (f) return f; } return null; };

  const groups = {}; let layout, skipped = 0;
  const add = (name, r, col) => {
    const d = toISO(r[dateCol], dateNum), p = toNum(r[col]);
    if (!d || p === null || p <= 0) { skipped++; return; }
    (groups[name] = groups[name] || []).push([d, p]);
  };
  if (assetCol) {
    const pc = pick(['adj close', 'close', 'price', 'value', 'rate', 'last']) || numeric[0];
    layout = `Long format (Date, ${assetCol}, ${pc})`;
    rows.forEach(r => { const n = String(r[assetCol]).trim(); if (n) add(n, r, pc); else skipped++; });
  } else if (pick(['close', 'adj close'])) {
    const pc = pick(['close', 'adj close']);
    layout = `Single asset (price column "${pc}")`;
    const nm = path.parse(filename || 'Asset').name.replace(/[_-]+/g, ' ').trim() || 'Asset';
    rows.forEach(r => add(nm, r, pc));
  } else {
    const cols = numeric.filter(h => !/^(open|high|low|volume|vol)$/i.test(h.trim()));
    if (!cols.length) throw new ValidationError('No usable price columns found (Open/High/Low/Volume are ignored). Add a Close or Price column.');
    layout = `Wide format (one price column per asset: ${cols.length})`;
    rows.forEach(r => cols.forEach(c => { if (r[c] === '' || r[c] == null) return; add(c, r, c); }));
  }

  const warnings = [], assets = [];
  Object.entries(groups).forEach(([name, arr]) => {
    arr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const dd = arr.filter((x, i) => i === arr.length - 1 || x[0] !== arr[i + 1][0]); // one price per date
    if (dd.length < 10) return warnings.push(`"${name}" was skipped: only ${dd.length} valid records (minimum 10).`);
    assets.push({ name, dates: dd.map(x => x[0]), prices: dd.map(x => x[1]) });
  });
  if (!assets.length) throw new ValidationError('No asset has at least 10 valid records. Check that prices are numbers greater than 0 and dates are valid.');
  if (skipped) warnings.push(`${skipped} value(s) were ignored because the date or price was missing, invalid or not above zero.`);

  const preview = rows.slice(0, 10).map(r => { const o = {}; headers.forEach(h => { const v = r[h]; o[h] = v instanceof Date ? toISO(v, false) : v; }); return o; });
  return { columns: headers, rowCount: rows.length, layout, preview, warnings, assets };
}
module.exports = { parseBuffer, ValidationError };
