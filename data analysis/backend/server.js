// Express API. Runs locally (node backend/server.js) and on Vercel as a serverless function.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parseBuffer, ValidationError } = require('./parser');
const { analyzeDataset, buildCsvReport } = require('./analytics');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 4; // Vercel request limit is ~4.5 MB
const DATASETS = path.join(__dirname, '..', 'datasets');
const SAMPLES = {
  'multi-asset-wide': { file: 'sample_multi_asset_wide.csv', name: 'Multi-Asset Market (Wide format)',
    description: '260 weekdays of simulated prices for Stocks, Gold, Silver, Forex (EUR/USD) and Bitcoin. One column per asset.' },
  'market-stress-long': { file: 'sample_market_stress_long.csv', name: 'Market Stress Scenario (Long format)',
    description: '200 weekdays of simulated prices for the same 5 asset classes in Date, Asset, Close format, with a high-volatility stress period.' }
};

const app = express();
app.use(express.json({ limit: '4mb' }));
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },   // memory only: nothing is saved to disk
  fileFilter: (req, file, cb) => /\.(csv|xlsx|xls)$/i.test(file.originalname) ? cb(null, true)
    : cb(new ValidationError('Unsupported file type. Please upload a .csv, .xlsx or .xls file.'))
});

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));

app.get('/api/samples', (req, res) => res.json({ success: true,
  samples: Object.entries(SAMPLES).map(([id, s]) => ({ id, name: s.name, description: s.description, file: s.file })) }));

app.get('/api/samples/:id/download', (req, res, next) => {
  const s = SAMPLES[req.params.id];
  if (!s) return next(Object.assign(new ValidationError('Unknown sample dataset.'), { status: 404 }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${s.file}"`);
  res.send(fs.readFileSync(path.join(DATASETS, s.file)));
});

app.get('/api/samples/:id', (req, res, next) => {
  const s = SAMPLES[req.params.id];
  if (!s) return next(Object.assign(new ValidationError('Unknown sample dataset.'), { status: 404 }));
  const ds = parseBuffer(fs.readFileSync(path.join(DATASETS, s.file)), s.file);
  res.json({ success: true, label: s.name + ' (sample data)', dataset: ds });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) throw new ValidationError('No file received. Please choose a CSV or Excel file.');
  const ds = parseBuffer(req.file.buffer, req.file.originalname);
  res.json({ success: true, label: req.file.originalname, dataset: ds });
});

app.post('/api/analyze', (req, res) => {
  res.json({ success: true, analysis: analyzeDataset(req.body.dataset, req.body.options) });
});

app.post('/api/report/csv', (req, res) => {
  const an = analyzeDataset(req.body.dataset, req.body.options);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="risk_analysis_report.csv"');
  res.send('\ufeff' + buildCsvReport(an, req.body.label));
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));   // local development only; Vercel serves /frontend directly

app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'API endpoint not found.' }));
app.use((err, req, res, next) => {
  let status = err.status || 500, msg = err.message;
  if (err instanceof multer.MulterError) { status = 400; msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large. The limit is ${MAX_MB} MB.` : err.message; }
  else if (err.type === 'entity.parse.failed') { status = 400; msg = 'Invalid request data.'; }
  else if (err.type === 'entity.too.large') { status = 413; msg = 'Dataset is too large to analyze (limit about 4 MB).'; }
  else if (status === 500) { console.error(err); msg = 'Unexpected server error. Please try again.'; }
  res.status(status).json({ success: false, error: msg });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}
module.exports = app;
