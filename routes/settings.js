const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, admin } = require('./middleware');

// Número de WhatsApp do suporte (chave 'whatsapp')
const getWa = db.prepare('SELECT value FROM settings WHERE key = ?');
const setWa = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

// Público: clientes precisam do número para o botão de suporte
router.get('/public', (req, res) => {
  res.json({ whatsapp: getWa.get('whatsapp')?.value || '' });
});

// A partir daqui: apenas admin
router.use(auth, admin);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/', (req, res) => {
  const { whatsapp } = req.body || {};
  if (whatsapp !== undefined) {
    const raw = String(whatsapp).trim();
    const clean = raw.replace(/\D/g, '');
    // Vazio = remover o canal de suporte; senão, exige DDI+DDD+número
    if (raw !== '' && !/^\d{10,13}$/.test(clean)) {
      return res.status(400).json({ error: 'Número inválido. Use DDI+DDD+número, ex.: 5511999999999' });
    }
    setWa.run('whatsapp', clean);
  }
  res.json({ ok: true });
});

module.exports = router;
