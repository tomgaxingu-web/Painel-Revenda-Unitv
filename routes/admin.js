const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const db     = require('../db/database');
const { auth, admin } = require('./middleware');

// GET /api/admin/backup → baixa o backup mais recente do banco
router.get('/backup', auth, admin, (req, res) => {
  try {
    const dir = db.backupDir || path.join(path.dirname(db.dbFile || ''), 'backups');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort();
    if (!files.length) return res.status(404).json({ error: 'Nenhum backup disponível ainda.' });
    const latest = files[files.length - 1];
    res.download(path.join(dir, latest), `painel-backup-${latest}`);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao localizar backup.' });
  }
});

module.exports = router;
