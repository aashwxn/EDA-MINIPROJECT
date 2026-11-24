// All financial risk calculations (done on the server from the data it receives).
const { ValidationError } = require('./parser');
const Z = { 0.9: 1.2816, 0.95: 1.6449, 0.99: 2.3263 };
const PERIODS_PER_YEAR = 252;

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const variance = a => { if (a.length < 2) return 0; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };
function percentile(sorted, p) {
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
// Risk level from annualized volatility; raised one step when max drawdown is worse than -25%.
function riskLevel(vol, mdd) {
  let l = vol < 0.15 ? 0 : vol < 0.30 ? 1 : 2;
  if (mdd <= -0.25 && l < 2) l++;
  return ['LOW', 'MEDIUM', 'HIGH'][l];
}

function analyzeAsset(name, dates, prices, conf) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) returns.push(prices[i] / prices[i - 1] - 1);        // daily returns
  const m = mean(returns), v = variance(returns), sd = Math.sqrt(v);                             // mean, variance, std dev
  const sorted = [...returns].sort((a, b) => a - b);
  const varHist = Math.max(0, -percentile(sorted, 1 - conf));                                    // historical VaR
  const varParam = Math.max(0, (Z[conf] || Z[0.95]) * sd - m);                                   // parametric (normal) VaR
  let peak = prices[0], peakI = 0, mdd = 0, ddPeak = 0, ddTrough = 0;
  const drawdown = prices.map((p, i) => {                                                        // max drawdown
    if (p > peak) { peak = p; peakI = i; }
    const d = p / peak - 1;
    if (d < mdd) { mdd = d; ddPeak = peakI; ddTrough = i; }
    return d;
  });
  const w = Math.min(20, Math.max(5, Math.floor(returns.length / 4))), rolling = [];
  for (let i = w - 1; i < returns.length; i++)
    rolling.push({ date: dates[i + 1], v: Math.sqrt(variance(returns.slice(i - w + 1, i + 1))) * Math.sqrt(PERIODS_PER_YEAR) });
  const vol = sd * Math.sqrt(PERIODS_PER_YEAR);
  return {
    name, records: prices.length, from: dates[0], to: dates[dates.length - 1],
    metrics: {
      startPrice: prices[0], endPrice: prices[prices.length - 1], totalReturn: prices[prices.length - 1] / prices[0] - 1,
      meanDailyReturn: m, annualReturn: m * PERIODS_PER_YEAR, variance: v, stdDev: sd, annualVolatility: vol,
      varHistorical: varHist, varParametric: varParam, maxDrawdown: mdd, maxDrawdownPeak: dates[ddPeak], maxDrawdownTrough: dates[ddTrough],
      bestDay: Math.max(...returns), worstDay: Math.min(...returns),
      riskLevel: riskLevel(vol, mdd), riskScore: Math.min(100, Math.round(vol / 0.6 * 100))
    },
    series: { dates, prices, returns, drawdown, rolling, rollingWindow: w }
  };
}

function checkDataset(ds) {
  if (!ds || !Array.isArray(ds.assets) || !ds.assets.length) throw new ValidationError('No dataset received. Please select a sample or upload a file first.');
  ds.assets.forEach(a => {
    if (!a || !a.name || !Array.isArray(a.dates) || !Array.isArray(a.prices) || a.dates.length !== a.prices.length)
      throw new ValidationError('The dataset format is invalid. Please upload the file again.');
  });
}

function analyzeDataset(ds, opt = {}) {
  checkDataset(ds);
  const conf = [0.9, 0.95, 0.99].includes(+opt.confidence) ? +opt.confidence : 0.95;
  const names = Array.isArray(opt.assets) && opt.assets.length ? opt.assets : ds.assets.map(a => a.name);
  const from = opt.from || '0000-01-01', to = opt.to || '9999-12-31';
  if (from > to) throw new ValidationError('The "From" date must be earlier than the "To" date.');
  const warnings = [], assets = [];
  ds.assets.filter(a => names.includes(a.name)).forEach(a => {
    const d = [], p = [];
    a.dates.forEach((x, i) => { if (x >= from && x <= to && +a.prices[i] > 0) { d.push(x); p.push(+a.prices[i]); } });
    if (p.length < 10) return warnings.push(`"${a.name}" has only ${p.length} records in the selected range (minimum 10), so it was skipped.`);
    assets.push(analyzeAsset(a.name, d, p, conf));
  });
  if (!assets.length) throw new ValidationError('No asset has enough data (10+ records) for the selected assets and date range. Widen the date range or choose other assets.');
  const vols = assets.map(a => a.metrics.annualVolatility);
  const top = key => assets.reduce((b, a) => (a.metrics[key] > b.metrics[key] ? a : b));
  return {
    options: { confidence: conf, from: opt.from || null, to: opt.to || null, periodsPerYear: PERIODS_PER_YEAR },
    warnings, assets,
    summary: {
      assetCount: assets.length, totalRecords: assets.reduce((s, a) => s + a.records, 0),
      from: assets.map(a => a.from).sort()[0], to: assets.map(a => a.to).sort().pop(),
      avgVolatility: mean(vols), highestRiskAsset: top('annualVolatility').name,
      worstDrawdownAsset: assets.reduce((b, a) => (a.metrics.maxDrawdown < b.metrics.maxDrawdown ? a : b)).name,
      worstDrawdown: Math.min(...assets.map(a => a.metrics.maxDrawdown)),
      highestVaR: Math.max(...assets.map(a => a.metrics.varHistorical)),
      riskCounts: ['LOW', 'MEDIUM', 'HIGH'].reduce((o, k) => (o[k] = assets.filter(a => a.metrics.riskLevel === k).length, o), {})
    }
  };
}

function buildCsvReport(an, label) {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"', pc = x => (x * 100).toFixed(4), L = [];
  L.push('Multi-Asset Financial Market Volatility Risk Analysis System');
  L.push('Dataset,' + q(label || 'dataset')); L.push('Generated,' + new Date().toISOString());
  L.push(`Confidence level,${an.options.confidence * 100}%`); L.push(`Annualization,${an.options.periodsPerYear} periods/year`);
  L.push(''); L.push('Asset,Records,From,To,Total Return %,Mean Daily Return %,Std Dev (daily) %,Variance,Annual Volatility %,VaR Historical %,VaR Parametric %,Max Drawdown %,Risk Level');
  an.assets.forEach(a => { const m = a.metrics;
    L.push([q(a.name), a.records, a.from, a.to, pc(m.totalReturn), pc(m.meanDailyReturn), pc(m.stdDev), m.variance.toExponential(6), pc(m.annualVolatility), pc(m.varHistorical), pc(m.varParametric), pc(m.maxDrawdown), m.riskLevel].join(',')); });
  L.push(''); L.push('Asset,Date,Price,Daily Return %,Drawdown %');
  an.assets.forEach(a => a.series.dates.forEach((d, i) =>
    L.push([q(a.name), d, a.series.prices[i], i ? pc(a.series.returns[i - 1]) : '', pc(a.series.drawdown[i])].join(','))));
  return L.join('\r\n');
}
module.exports = { analyzeDataset, buildCsvReport };
