const path = require('path');
const express = require('express');
const config = require('../config');

function createApp({ bot } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  if (bot && config.useWebhook) {
    const { webhookCallback } = require('grammy');
    app.post(config.webhookPath, express.json(), webhookCallback(bot, 'express', {
      secretToken: config.webhookSecret || undefined,
      // Uzoq ishlovlar (AI javobi) Telegram'ni kuttirmasin: 200 qaytariladi, ishlov davom etadi
      onTimeout: 'return',
      timeoutMilliseconds: 9000,
    }));
  }

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // 🪪 Muxlislik kartasi rasmi (Telegram Stories uni shu manzildan yuklab oladi). Manzil imzolangan.
  app.get('/card/:file', async (req, res, next) => {
    try {
      const fancard = require('../services/fancard');
      const tgId = fancard.verifyImagePath(req.params.file);
      if (!tgId) return res.status(404).end();
      const png = await fancard.renderPng(tgId);
      if (!png) return res.status(404).end();
      res.set('Cache-Control', 'public, max-age=300');
      return res.type('png').send(png);
    } catch (e) { return next(e); }
  });

  app.use('/api/admin', require('./admin'));
  app.use('/api', require('./api'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));
  // Mini App — /app manzilida (SPEC 1.3), web admin — /admin
  app.get('/app/translit.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, '..', 'i18n', 'translit.js')));
  app.get('/', (req, res) => res.redirect(302, '/app/'));
  app.use(express.static(path.join(__dirname, '..', '..', 'public'), { extensions: ['html'], maxAge: '5m', redirect: true }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    if (err && err.status === 404) return res.status(404).end();
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) return res.status(err.status || 400).json({ error: 'bad_request' });
    console.error('[web]', err);
    return res.status(500).json({ error: 'server_error' });
  });

  return app;
}

module.exports = { createApp };
