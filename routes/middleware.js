const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  // Aceita token via header Authorization OU query string (necessário p/ EventSource/SSE)
  const h = req.headers['authorization'];
  const q = req.query?.token;
  const raw = h ? h.replace('Bearer ', '') : (typeof q === 'string' && q ? q : null);
  if (!raw) return res.status(401).json({ error: 'Sem token.' });
  try { req.user = jwt.verify(raw, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido.' }); }
}

function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
  next();
}

module.exports = { auth, admin };
