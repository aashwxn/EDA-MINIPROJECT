/* Frontend: talks to the backend through /api endpoints. All calculations are done by the backend. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { dataset: null, label: '', analysis: null, asset: null, charts: {} };
const COLORS = ['#0b2a5b', '#1d4ed8', '#0891b2', '#d97706', '#dc2626', '#7c3aed', '#059669', '#db2777'];
const RISK_COLOR = { LOW: '#15803d', MEDIUM: '#d97706', HIGH: '#dc2626' };
const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';
const num = (x, d = 2) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const price = x => num(x, Math.abs(x) < 10 ? 4 : 2);
const badge = l => `<span class="badge ${l}">${l}</span>`;
const ANALYSIS_PAGES = ['dashboard', 'asset', 'risk', 'compare', 'reports'];

/* ---------- UI helpers ---------- */
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3500);
}
function busy(on, text) { $('#loader').hidden = !on; if (text) $('#loaderText').textContent = text; }
async function api(path, opts, text) {
  busy(true, text || 'Working...');
  try {
    const r = await fetch('/api' + path, opts);
    const isJson = (r.headers.get('content-type') || '').includes('json');
    if (!isJson) { if (!r.ok) throw new Error('Server error (' + r.status + '). Make sure the backend is running.'); return r; }
    const j = await r.json();
    if (!r.ok || j.success === false) throw new Error(j.error || 'Request failed.');
    return j;
  } catch (e) {
    throw new Error(e instanceof TypeError ? 'Cannot reach the server. Please check your connection and that the backend is running.' : e.message);
  } finally { busy(false); }
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function table(heads, rows, numFrom = 1) {
  return `<table><thead><tr>${heads.map((h, i) => `<th class="${i >= numFrom ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(r => `<tr>${r.map((c, i) => `<td class="${i >= numFrom ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
}
const card = (label, value, sub, cls) => `<div class="sc"><span>${label}</span><b class="${cls || ''}">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const signCls = x => (x < 0 ? 'neg' : 'pos');

/* ---------- navigation ---------- */
function navTo(p) { if (location.hash === '#' + p) go(); else location.hash = '#' + p; }
function go() {
  let p = location.hash.slice(1); if (!['dashboard', 'upload', 'samples', 'asset', 'risk', 'compare', 'reports'].includes(p)) p = 'dashboard';
  $$('.page').forEach(e => e.hidden = e.id !== p);
  $$('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === p));
  $('#filterbar').hidden = !(S.dataset && ['dashboard', 'asset', 'risk', 'compare'].includes(p));
  $('#nav').classList.remove('open');
  if (ANALYSIS_PAGES.includes(p)) {
    const sec = $('#' + p), has = !!S.analysis;
    $('[data-content]', sec).hidden = !has; $('[data-empty]', sec).hidden = has;
    if (!has) $('[data-empty]', sec).innerHTML = S.dataset
      ? `<div class="empty"><p>Dataset <b>${esc(S.label)}</b> is loaded but not analyzed yet.</p><button class="btn primary" onclick="runAnalysis(true)">Analyze Dataset</button></div>`
      : `<div class="empty"><p>No dataset loaded yet. Choose a sample dataset or upload your own file to begin.</p><a class="btn primary" href="#samples">Sample Datasets</a><a class="btn" href="#upload">Upload Dataset</a></div>`;
    else ({ dashboard: renderDashboard, asset: renderAsset, risk: renderRisk, compare: renderCompare, reports: renderReports })[p]();
  }
  if (p === 'samples') loadSamples();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', go);
$('#menuBtn').onclick = () => $('#nav').classList.toggle('open');

/* ---------- charts ---------- */
function chart(id, type, labels, datasets, o = {}) {
  S.charts[id]?.destroy();
  S.charts[id] = new Chart($('#' + id), {
    type, data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: datasets.length > 1 || !!o.legend } },
      scales: o.scales || { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { title: { display: !!o.y, text: o.y || '' }, ticks: o.fmt ? { callback: o.fmt } : {} } }
    }
  });
}
const line = (label, data, color, fill) => ({ label, data, borderColor: color, backgroundColor: color + '22', borderWidth: 2, pointRadius: 0, tension: .15, fill: !!fill, spanGaps: true });
const bar = (label, data, color) => ({ label, data, backgroundColor: color });
function normalized(assets) {
  const labels = [...new Set(assets.flatMap(a => a.series.dates))].sort();
  return { labels, datasets: assets.map((a, i) => {
    const m = Object.fromEntries(a.series.dates.map((d, k) => [d, a.series.prices[k] / a.series.prices[0] * 100]));
    return line(a.name, labels.map(d => m[d] ?? null), COLORS[i % COLORS.length]);
  }) };
}
const volBars = assets => bar('Annualized volatility', assets.map(a => a.metrics.annualVolatility * 100), assets.map(a => RISK_COLOR[a.metrics.riskLevel]));

/* ---------- samples ---------- */
async function loadSamples() {
  if ($('#sampleList').children.length) return;
  try {
    const j = await api('/samples', null, 'Loading samples...');
    $('#sampleList').innerHTML = j.samples.map(s => `<div class="card"><h3>${esc(s.name)}</h3><span class="tag">Sample data (simulated)</span>
      <p class="muted">${esc(s.description)}</p><p class="small muted">File: ${esc(s.file)}</p>
      <div class="row gap wrapbtn"><button class="btn primary" data-use="${s.id}">Use This Dataset</button>
      <a class="btn" href="/api/samples/${s.id}/download" download>Download CSV</a></div></div>`).join('');
    $$('[data-use]').forEach(b => b.onclick = () => useSample(b.dataset.use));
  } catch (e) { toast(e.message, true); }
}
async function useSample(id) {
  try { const j = await api('/samples/' + id, null, 'Loading dataset...'); setDataset(j.dataset, j.label, true); toast('Sample dataset loaded. Review the preview, then click Analyze Dataset.'); }
  catch (e) { toast(e.message, true); }
}

/* ---------- upload ---------- */
const drop = $('#drop'), fileInput = $('#fileInput');
$('#btnBrowse').onclick = () => fileInput.click();
$('#btnAnother').onclick = $('#btnNew').onclick = () => { navTo('upload'); fileInput.click(); };
drop.onclick = e => { if (e.target === drop || e.target.tagName === 'P') fileInput.click(); };
drop.onkeydown = e => { if (e.key === 'Enter') fileInput.click(); };
fileInput.onchange = () => uploadFile(fileInput.files[0]);
['dragenter', 'dragover'].forEach(v => drop.addEventListener(v, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(v => drop.addEventListener(v, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => uploadFile(e.dataTransfer.files[0]));

function uploadError(msg) { const a = $('#alert'); a.textContent = msg; a.hidden = false; toast(msg, true); }
async function uploadFile(file) {
  $('#alert').hidden = true;
  if (!file) return;
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) return uploadError('Unsupported file type. Please upload a .csv, .xlsx or .xls file.');
  if (file.size === 0) return uploadError('The file is empty.');
  if (file.size > 4 * 1024 * 1024) return uploadError('File is too large. The limit is 4 MB.');
  const fd = new FormData(); fd.append('file', file);
  try {
    const j = await api('/upload', { method: 'POST', body: fd }, 'Validating and reading file...');
    setDataset(j.dataset, j.label, false); toast('File uploaded and validated successfully.');
  } catch (e) { uploadError(e.message); }
  fileInput.value = '';
}
function setDataset(ds, label, sample) {
  S.dataset = ds; S.label = label; S.analysis = null; S.asset = null;
  $('#dsName').textContent = label;
  const names = ds.assets.map(a => a.name);
  $('#assetChecks').innerHTML = names.map(n => `<label><input type="checkbox" value="${esc(n)}" checked> ${esc(n)}</label>`).join('');
  $$('#assetChecks input').forEach(c => c.onchange = updateAssetSummary); updateAssetSummary();
  const all = ds.assets.flatMap(a => a.dates).sort();
  $('#fFrom').min = $('#fTo').min = all[0]; $('#fFrom').max = $('#fTo').max = all[all.length - 1];
  $('#fFrom').value = $('#fTo').value = ''; $('#fConf').value = '0.95';
  $('#pvTitle').textContent = 'Data preview: ' + label;
  $('#pvTag').textContent = sample ? 'Sample data (not real market data)' : 'Uploaded file';
  $('#pvInfo').textContent = `${ds.rowCount.toLocaleString()} rows | ${ds.assets.length} asset(s): ${names.join(', ')} | ${ds.layout} | ${all[0]} to ${all[all.length - 1]}`;
  $('#pvWarn').innerHTML = ds.warnings.map(w => `<div class="alert warn">${esc(w)}</div>`).join('');
  $('#pvTable').innerHTML = table(ds.columns, ds.preview.map(r => ds.columns.map(c => esc(r[c] === '' ? '-' : r[c]))), 99);
  $('#preview').hidden = false; $('#alert').hidden = true;
  navTo('upload');
}
function updateAssetSummary() { const t = $$('#assetChecks input').length, c = $$('#assetChecks input:checked').length; $('#assetSummary').textContent = `Assets (${c}/${t})`; }

/* ---------- analysis ---------- */
function options() {
  return { assets: $$('#assetChecks input:checked').map(c => c.value), from: $('#fFrom').value || null, to: $('#fTo').value || null, confidence: +$('#fConf').value };
}
async function runAnalysis(goDash) {
  if (!S.dataset) return toast('Please load a dataset first.', true);
  const o = options();
  if (!o.assets.length) return toast('Select at least one asset.', true);
  if (o.from && o.to && o.from > o.to) return toast('"From" date must be earlier than "To" date.', true);
  try {
    const j = await api('/analyze', post({ dataset: { assets: S.dataset.assets }, options: o }), 'Analyzing dataset...');
    S.analysis = j.analysis;
    if (!S.analysis.assets.some(a => a.name === S.asset)) S.asset = S.analysis.assets[0].name;
    j.analysis.warnings.forEach(w => toast(w, true));
    toast('Analysis completed successfully.');
    if (goDash === true) navTo('dashboard'); else go();
  } catch (e) { toast(e.message, true); }
}
$('#btnAnalyze').onclick = () => runAnalysis(true);
$('#btnApply').onclick = () => runAnalysis(false);
$('#btnClear').onclick = () => {
  $$('#assetChecks input').forEach(c => c.checked = true); updateAssetSummary();
  $('#fFrom').value = $('#fTo').value = ''; $('#fConf').value = '0.95'; runAnalysis(false);
};
function resetAll() {
  S.dataset = S.analysis = S.asset = null; $('#preview').hidden = true; $('#alert').hidden = true; $('#filterbar').hidden = true;
  Object.values(S.charts).forEach(c => c.destroy()); S.charts = {}; toast('Reset complete.'); navTo('dashboard');
}
$('#btnReset').onclick = resetAll;

/* ---------- pages ---------- */
function renderDashboard() {
  const a = S.analysis, s = a.summary;
  $('#dCards').innerHTML = [
    card('Assets analyzed', s.assetCount, `LOW ${s.riskCounts.LOW} | MEDIUM ${s.riskCounts.MEDIUM} | HIGH ${s.riskCounts.HIGH}`),
    card('Total records', s.totalRecords.toLocaleString(), `${s.from} to ${s.to}`),
    card('Average volatility', pct(s.avgVolatility), 'annualized'),
    card('Most volatile asset', esc(s.highestRiskAsset)),
    card(`Highest VaR (${a.options.confidence * 100}%)`, pct(s.highestVaR), '1-day historical'),
    card('Worst max drawdown', pct(s.worstDrawdown), esc(s.worstDrawdownAsset), 'neg')].join('');
  $('#dRisk').innerHTML = a.assets.map(x => { const m = x.metrics; return `<div class="rk"><div class="t"><b>${esc(x.name)}</b>${badge(m.riskLevel)}</div>
    <div class="meter"><i style="width:${m.riskScore}%;background:${RISK_COLOR[m.riskLevel]}"></i></div>
    <dl><dt>Annual volatility</dt><dd>${pct(m.annualVolatility)}</dd><dt>VaR (1 day)</dt><dd>${pct(m.varHistorical)}</dd><dt>Max drawdown</dt><dd>${pct(m.maxDrawdown)}</dd></dl></div>`; }).join('');
  chart('chVol', 'bar', a.assets.map(x => x.name), [volBars(a.assets)], { y: 'Volatility %', fmt: v => v + '%' });
  const n = normalized(a.assets); chart('chNorm', 'line', n.labels, n.datasets, { y: 'Index' });
}
function assetSelect(id) {
  const sel = $('#' + id); sel.innerHTML = S.analysis.assets.map(x => `<option ${x.name === S.asset ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  sel.onchange = () => { S.asset = sel.value; go(); };
}
const cur = () => S.analysis.assets.find(x => x.name === S.asset) || S.analysis.assets[0];
function renderAsset() {
  assetSelect('assetSel'); const x = cur(), m = x.metrics, se = x.series, c = S.analysis.options.confidence * 100;
  $('#aBadge').innerHTML = badge(m.riskLevel) + ` <span class="muted small">${x.records} records, ${x.from} to ${x.to}</span>`;
  $('#aCards').innerHTML = [
    card('Total return', pct(m.totalReturn), `${price(m.startPrice)} to ${price(m.endPrice)}`, signCls(m.totalReturn)),
    card('Mean daily return', pct(m.meanDailyReturn, 4)), card('Standard deviation', pct(m.stdDev, 3), 'daily returns'),
    card('Variance', m.variance.toExponential(3), 'daily returns'), card('Historical volatility', pct(m.annualVolatility), 'annualized (x sqrt 252)'),
    card(`VaR ${c}% (historical)`, pct(m.varHistorical), '1-day loss'), card(`VaR ${c}% (parametric)`, pct(m.varParametric), '1-day loss'),
    card('Maximum drawdown', pct(m.maxDrawdown), `${m.maxDrawdownPeak} to ${m.maxDrawdownTrough}`, 'neg'),
    card('Best / worst day', `${pct(m.bestDay)} / ${pct(m.worstDay)}`), card('Risk level', badge(m.riskLevel), `score ${m.riskScore}/100`)].join('');
  chart('chPrice', 'line', se.dates, [line('Price', se.prices, '#0b2a5b', true)], { y: 'Price' });
  chart('chRet', 'bar', se.dates.slice(1), [bar('Daily return %', se.returns.map(r => r * 100), se.returns.map(r => r >= 0 ? '#16a34a' : '#dc2626'))], { y: 'Return %' });
  chart('chRoll', 'line', se.rolling.map(r => r.date), [line(`${se.rollingWindow}-day volatility %`, se.rolling.map(r => r.v * 100), '#1d4ed8', true)], { y: 'Volatility %' });
  chart('chDD', 'line', se.dates, [line('Drawdown %', se.drawdown.map(d => d * 100), '#dc2626', true)], { y: 'Drawdown %' });
  const idx = se.dates.map((_, i) => i).slice(-40).reverse();
  $('#aTable').innerHTML = table(['Date', 'Price', 'Daily return', 'Drawdown'], idx.map(i => [se.dates[i], price(se.prices[i]),
    i ? `<span style="color:${se.returns[i - 1] < 0 ? '#dc2626' : '#15803d'}">${pct(se.returns[i - 1])}</span>` : '-', pct(se.drawdown[i])]));
}
function renderRisk() {
  const a = S.analysis, c = a.options.confidence * 100; $('#varTitle').textContent = `Value at Risk (1 day, ${c}% confidence)`;
  $('#rTable').innerHTML = table(['Asset', 'Risk level', 'Risk meter', 'Annual volatility', 'VaR historical', 'VaR parametric', 'Max drawdown'],
    a.assets.map(x => { const m = x.metrics; return [esc(x.name), badge(m.riskLevel), `<div class="meter"><i style="width:${m.riskScore}%;background:${RISK_COLOR[m.riskLevel]}"></i></div>`,
      pct(m.annualVolatility), pct(m.varHistorical), pct(m.varParametric), pct(m.maxDrawdown)]; }), 4);
  const names = a.assets.map(x => x.name);
  chart('chVar', 'bar', names, [bar('Historical VaR %', a.assets.map(x => x.metrics.varHistorical * 100), '#0b2a5b'), bar('Parametric VaR %', a.assets.map(x => x.metrics.varParametric * 100), '#60a5fa')], { y: 'Loss %' });
  chart('chMdd', 'bar', names, [bar('Max drawdown %', a.assets.map(x => x.metrics.maxDrawdown * 100), '#dc2626')], { y: 'Drawdown %' });
  assetSelect('riskSel');
  const r = cur().series.returns.map(v => v * 100), bins = 20, mn = Math.min(...r), w = (Math.max(...r) - mn) / bins || 1e-9, cnt = Array(bins).fill(0);
  r.forEach(v => cnt[Math.min(bins - 1, Math.floor((v - mn) / w))]++);
  chart('chHist', 'bar', cnt.map((_, i) => (mn + w * (i + .5)).toFixed(1) + '%'), [bar('Number of days', cnt, '#1d4ed8')], { y: 'Days' });
}
function renderCompare() {
  const a = S.analysis;
  $('#cTable').innerHTML = table(['Asset', 'Records', 'Total return', 'Annual return', 'Annual volatility', 'Std dev (daily)', 'VaR historical', 'Max drawdown', 'Risk'],
    a.assets.map(x => { const m = x.metrics; return [esc(x.name), x.records, pct(m.totalReturn), pct(m.annualReturn), pct(m.annualVolatility), pct(m.stdDev, 3), pct(m.varHistorical), pct(m.maxDrawdown), badge(m.riskLevel)]; }));
  const n = normalized(a.assets); chart('chCmpNorm', 'line', n.labels, n.datasets, { y: 'Index' });
  chart('chCmpVol', 'bar', a.assets.map(x => x.name), [volBars(a.assets)], { y: 'Volatility %' });
  S.charts.chCmpSc?.destroy();
  S.charts.chCmpSc = new Chart($('#chCmpSc'), { type: 'scatter',
    data: { datasets: a.assets.map((x, i) => ({ label: x.name, data: [{ x: x.metrics.annualVolatility * 100, y: x.metrics.annualReturn * 100 }], backgroundColor: COLORS[i % COLORS.length], pointRadius: 8 })) },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Annual volatility %' } }, y: { title: { display: true, text: 'Annual return %' } } } } });
}
function renderReports() {
  const a = S.analysis, s = a.summary, o = a.options;
  $('#rSummary').innerHTML = `<p><b>Dataset:</b> ${esc(S.label)}<br><b>Assets:</b> ${a.assets.map(x => esc(x.name)).join(', ')}<br><b>Period:</b> ${s.from} to ${s.to}<br>
    <b>VaR confidence:</b> ${o.confidence * 100}%<br><b>Average volatility:</b> ${pct(s.avgVolatility)}<br>
    <b>Risk levels:</b> LOW ${s.riskCounts.LOW}, MEDIUM ${s.riskCounts.MEDIUM}, HIGH ${s.riskCounts.HIGH}</p>`;
}

/* ---------- reports ---------- */
function save(blob, name) { const u = document.createElement('a'); u.href = URL.createObjectURL(blob); u.download = name; document.body.appendChild(u); u.click(); u.remove(); setTimeout(() => URL.revokeObjectURL(u.href), 1000); }
$('#btnCsv').onclick = async () => {
  try {
    const r = await api('/report/csv', post({ dataset: { assets: S.dataset.assets }, options: options(), label: S.label }), 'Generating CSV report...');
    save(await r.blob(), 'risk_analysis_report.csv'); toast('CSV report downloaded.');
  } catch (e) { toast(e.message, true); }
};
function chartImage(type, labels, datasets, yTitle) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 380;
  const white = { id: 'w', beforeDraw(ch) { ch.ctx.save(); ch.ctx.fillStyle = '#fff'; ch.ctx.fillRect(0, 0, ch.width, ch.height); ch.ctx.restore(); } };
  const ch = new Chart(c, { type, data: { labels, datasets }, plugins: [white], options: { responsive: false, animation: false, devicePixelRatio: 1,
    plugins: { legend: { display: datasets.length > 1 } }, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: yTitle } } } } });
  const img = c.toDataURL('image/png'); ch.destroy(); return img;
}
$('#btnPdf').onclick = () => {
  try {
    busy(true, 'Building PDF...');
    const { jsPDF } = window.jspdf, doc = new jsPDF('p', 'pt', 'a4'), a = S.analysis, s = a.summary, W = 595, M = 40; let y;
    doc.setFillColor(11, 42, 91); doc.rect(0, 0, W, 64, 'F'); doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('Multi-Asset Financial Market Volatility Risk Analysis', M, 30); doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text('Analysis Report', M, 49);
    doc.setTextColor(30); y = 90;
    [`Dataset: ${S.label}`, `Period: ${s.from} to ${s.to}  |  Records: ${s.totalRecords}`, `VaR confidence: ${a.options.confidence * 100}%  |  Generated: ${new Date().toLocaleString()}`,
      `Average annualized volatility: ${pct(s.avgVolatility)}  |  Most volatile: ${s.highestRiskAsset}`].forEach(t => { doc.text(t, M, y); y += 15; });
    y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Risk summary by asset', M, y); y += 6; doc.setFontSize(8.5);
    const heads = ['Asset', 'Ann. Vol', 'Std Dev', 'Variance', 'VaR Hist', 'VaR Param', 'Max DD', 'Risk'], xs = [M, 140, 200, 255, 325, 385, 445, 510];
    y += 14; doc.setFillColor(227, 236, 250); doc.rect(M - 4, y - 10, W - 2 * M + 8, 15, 'F'); heads.forEach((h, i) => doc.text(h, xs[i], y));
    doc.setFont('helvetica', 'normal');
    a.assets.forEach(x => { const m = x.metrics; y += 16;
      [x.name.slice(0, 18), pct(m.annualVolatility), pct(m.stdDev, 3), m.variance.toExponential(2), pct(m.varHistorical), pct(m.varParametric), pct(m.maxDrawdown), m.riskLevel].forEach((t, i) => doc.text(String(t), xs[i], y)); });
    const n = normalized(a.assets); y += 24;
    const add = (title, img) => { if (y + 215 > 800) { doc.addPage(); y = 50; } doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(title, M, y); doc.addImage(img, 'PNG', M, y + 6, W - 2 * M, (W - 2 * M) * 380 / 900); y += (W - 2 * M) * 380 / 900 + 28; };
    add('Normalized price (start = 100)', chartImage('line', n.labels, n.datasets.map(d => ({ ...d, fill: false })), 'Index'));
    add('Annualized volatility by asset (%)', chartImage('bar', a.assets.map(x => x.name), [volBars(a.assets)], 'Volatility %'));
    add('Maximum drawdown by asset (%)', chartImage('bar', a.assets.map(x => x.name), [bar('Max drawdown %', a.assets.map(x => x.metrics.maxDrawdown * 100), '#dc2626')], 'Drawdown %'));
    doc.setFontSize(8); doc.setTextColor(110); doc.text('Sample datasets are simulated. For education only, not financial advice.', M, 825);
    doc.save('risk_analysis_report.pdf'); toast('PDF report downloaded.');
  } catch (e) { toast('Could not create the PDF: ' + e.message, true); } finally { busy(false); }
};

go();
