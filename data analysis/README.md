# Multi-Asset Financial Market Volatility Risk Analysis System

A full-stack web app that analyzes the risk of Stocks, Gold, Silver, Forex and Cryptocurrency from sample or uploaded CSV / Excel datasets.

- **Frontend:** HTML, CSS, Vanilla JavaScript, Chart.js (bundled), jsPDF (bundled)
- **Backend:** Node.js + Express (runs locally and as a Vercel serverless function)
- **No database, no API key.** Uploaded files are processed in memory and never saved.

## Features
Dashboard, Upload Dataset, Sample Datasets, Asset Analysis, Risk Analysis, Asset Comparison and Reports pages.
The backend calculates **Daily Returns, Historical Volatility, Standard Deviation, Variance, Value at Risk (historical and parametric), Maximum Drawdown and Risk Level** from the data you load.
Filters: choose assets, date range and VaR confidence (90 / 95 / 99%). Reports: PDF (built in the browser) and CSV (built by the backend).

## Folder structure
```
data analysis/
├── frontend/            index.html, css/style.css, js/app.js, js/vendor/ (Chart.js, jsPDF)
├── backend/             server.js (API), parser.js (CSV/Excel validation), analytics.js (calculations)
├── datasets/            2 sample CSV files
├── package.json
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```

## Run locally
Requires Node.js 18 or newer (https://nodejs.org).
```bash
cd "data analysis"
npm install
npm start
```
Open http://localhost:3000

## Dataset formats accepted (CSV, XLSX, XLS)
A **Date** column is required, plus prices in one of these layouts:

| Layout | Example columns |
|---|---|
| Wide (one column per asset) | `Date, Stocks, Gold, Bitcoin` |
| Long | `Date, Asset, Close` |
| Single asset | `Date, Open, High, Low, Close, Volume` (asset name = file name) |

Rules: at least 10 valid positive prices per asset; max file size 4 MB. Invalid rows are ignored and reported; clear errors are shown for missing Date/price columns, empty or unsupported files.

## API endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/samples` | List sample datasets |
| GET | `/api/samples/:id` | Load and validate a sample dataset |
| GET | `/api/samples/:id/download` | Download the sample CSV |
| POST | `/api/upload` | Upload CSV/Excel (multipart, field `file`), validate and parse |
| POST | `/api/analyze` | Run the risk calculations `{dataset, options:{assets,from,to,confidence}}` |
| POST | `/api/report/csv` | Generate the CSV report |

## Calculation notes
- Daily return = P(t) / P(t-1) - 1
- Standard deviation and variance: sample statistics of daily returns
- Historical volatility = daily standard deviation x sqrt(252)
- VaR (1 day): historical = percentile of real returns; parametric = z x std dev - mean
- Maximum drawdown = largest fall from a running peak
- Risk level: LOW below 15% annual volatility, MEDIUM 15-30%, HIGH above 30%; one level higher if max drawdown is worse than -25% (edit `riskLevel()` in `backend/analytics.js`)

Sample datasets are simulated, not real market data. For education only, not financial advice.

## Upload to GitHub
```bash
cd "data analysis"
git init
git add .
git commit -m "Initial commit: Multi-Asset Financial Risk Analysis System"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```
Create the empty repository on github.com first (do not add a README there), then paste its URL above.

## Deploy to Vercel
**Option A: website (easiest)**
1. Push the project to GitHub (above).
2. Go to https://vercel.com, sign in, click **Add New > Project** and import your repository.
3. Leave all settings as they are (no build command, no output directory). `vercel.json` configures everything.
4. Click **Deploy**. Your site opens at `https://your-project.vercel.app`.

**Option B: command line**
```bash
npm install -g vercel
cd "data analysis"
vercel          # follow the prompts
vercel --prod   # publish
```

Notes: Vercel limits request bodies to about 4.5 MB, so uploads are limited to 4 MB. No environment variables are required.

## Troubleshooting
- *"Cannot reach the server"*: run `npm start` and open http://localhost:3000 (do not open index.html directly).
- *Validation error after upload*: check the Date column and that price cells are numbers.
