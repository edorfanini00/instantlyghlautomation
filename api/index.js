// ── Load .env FIRST (before any other requires) ──────────
if (!process.env.VERCEL) {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
      console.log('[dev] Loaded .env file');
    }
  } catch (err) {
    console.warn('[dev] Could not load .env:', err.message);
  }
}

const express = require('express');
const config = require('./config');
const app = express();

// ── Middleware ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────
const webhookRoutes = require('./routes/webhook');
const cronRoutes = require('./routes/cron');

app.use('/api/webhook', webhookRoutes);
app.use('/api/cron', cronRoutes);

// ── Health check ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'instantly-ghl-automation',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      webhook: 'POST /api/webhook/instantly',
      dailyReport: 'GET /api/cron/daily-report',
    },
  });
});

// ── Local dev server ──────────────────────────────────────
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`\n🚀 Instantly → GHL Automation running on http://localhost:${config.port}`);
    console.log(`   Webhook:   POST http://localhost:${config.port}/api/webhook/instantly`);
    console.log(`   Report:    GET  http://localhost:${config.port}/api/cron/daily-report`);
    console.log(`   Health:    GET  http://localhost:${config.port}/\n`);
  });
}

module.exports = app;
