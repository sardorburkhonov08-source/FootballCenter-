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
    app.post('/tg-webhook', express.json(), webhookCallback(bot, 'express', { secretToken: config.webhookSecret || undefined }));
  }

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use('/api/admin', require('./admin'));
  app.use('/api', require('./api'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));
  app.get('/js/translit.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, '..', 'i18n', 'translit.js')));
  app.use(express.static(path.join(__dirname, '..', '..', 'public'), { extensions: ['html'], maxAge: '5m' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    if (err && err.status === 404) return res.status(404).end();
    console.error('[web]', err);
    return res.status(500).json({ error: 'server_error' });
  });

  return app;
}

module.exports = { createApp };
