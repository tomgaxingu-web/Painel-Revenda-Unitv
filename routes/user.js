const router = require('express').Router();
const db     = require('../db/database');
const { auth, admin } = require('./middleware');

// SSE clients map
const sseClients = new Map();

// GET /api/user/events  — Server-Sent Events para notificações em tempo real
router.get('/events', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const uid = req.user.id;
  if (!sseClients.has(uid)) sseClients.set(uid, new Set());
  sseClients.get(uid).add(res);

  // Enviar contagem de não lidas imediatamente
  const unread = db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read=0").get(uid).c;
  res.write(`data: ${JSON.stringify({ type: 'unread', count: unread })}\n\n`);

  // Heartbeat
  const hb = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients.get(uid)?.delete(res);
    if (!sseClients.get(uid)?.size) sseClients.delete(uid);
  });
});

// Função para push de eventos
function pushToUser(userId, event) {
  sseClients.get(userId)?.forEach(res => res.write(`data: ${JSON.stringify(event)}\n\n`));
}
module.exports.pushToUser = pushToUser;

// GET /api/user/me
router.get('/me', auth, (req, res) => {
  const u = db.prepare("SELECT id,name,email,balance,role,created_at FROM users WHERE id=?").get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const unread = db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read=0").get(req.user.id).c;
  res.json({ ...u, unread });
});

// GET /api/user/orders
router.get('/orders', auth, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, p.name as product_name, p.period, p.badge, p.logo_text, p.logo_bg, p.logo_url
    FROM orders o JOIN products p ON p.id=o.product_id
    WHERE o.user_id=? ORDER BY o.id DESC
  `).all(req.user.id);
  res.json(orders);
});

// GET /api/user/codes
router.get('/codes', auth, (req, res) => {
  const codes = db.prepare(`
    SELECT c.code, c.created_at, o.id as order_id, o.paid_at,
           p.name as product_name, p.period, p.badge, p.logo_text, p.logo_bg, p.logo_url,
           o.quantity, o.unit_price
    FROM codes c
    JOIN orders o ON o.id=c.order_id
    JOIN products p ON p.id=o.product_id
    WHERE o.user_id=? AND o.status='paid'
    ORDER BY c.id DESC
  `).all(req.user.id);
  res.json(codes);
});

// GET /api/user/deposits
router.get('/deposits', auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC").all(req.user.id));
});

// GET /api/user/notifications
router.get('/notifications', auth, (req, res) => {
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30").all(req.user.id);
  res.json(notifs);
});

// POST /api/user/notifications/read
router.post('/notifications/read', auth, (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").run(req.user.id);
  res.json({ ok: true });
});

// ── TICKETS ─────────────────────────────────────────────────────
router.post('/tickets', auth, (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Assunto e mensagem são obrigatórios.' });
  db.prepare("INSERT INTO tickets (user_id,subject,message,status) VALUES (?,?,?,?)")
    .run(req.user.id, subject, message, 'aberto');
  res.json({ ok: true, id: db.lastInsertRowid });
});

router.get('/tickets', auth, (req, res) => {
  const tickets = db.prepare("SELECT * FROM tickets WHERE user_id=? ORDER BY created_at DESC").all(req.user.id);
  res.json(tickets);
});

// ── ADMIN ─────────────────────────────────────────────────────

router.get('/admin/stats', auth, admin, (req, res) => res.json(db.getStats()));

router.get('/admin/chart', auth, admin, (req, res) => res.json(db.getSalesChart()));

router.get('/admin/dashboard', auth, admin, (req, res) => res.json(db.getDashboard()));

router.get('/admin/users', auth, admin, (req, res) => {
  const users = db.prepare(`
    SELECT u.*, 
      (SELECT COUNT(*) FROM orders WHERE user_id=u.id AND status='paid') as total_orders,
      (SELECT COALESCE(SUM(total),0) FROM orders WHERE user_id=u.id AND status='paid') as total_spent
    FROM users u ORDER BY u.id DESC
  `).all();
  res.json(users);
});

router.put('/admin/users/:id/balance', auth, admin, (req, res) => {
  const { amount } = req.body;
  if (amount === undefined) return res.status(400).json({ error: 'Informe valor.' });
  db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(parseFloat(amount), req.params.id);
  db.prepare("INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)")
    .run(req.params.id, '💰 Saldo ajustado', `Seu saldo foi ajustado em R$ ${parseFloat(amount).toFixed(2)}.`, amount > 0 ? 'success' : 'info');
  const u = db.prepare("SELECT balance FROM users WHERE id=?").get(req.params.id);
  res.json({ balance: u.balance });
});

router.get('/admin/orders', auth, admin, (req, res) => {
  const { page = 1, status } = req.query;
  const limit = 50, offset = (page - 1) * limit;
  let q = `SELECT o.*, u.name as user_name, u.email, p.name as product_name, p.badge
         FROM orders o JOIN users u ON u.id=o.user_id JOIN products p ON p.id=o.product_id`;
  const params = [];
  if (status) { q += ' WHERE o.status=?'; params.push(status); }
  q += ' ORDER BY o.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  res.json(db.prepare(q).all(...params));
});

module.exports = router;
module.exports.pushToUser = pushToUser;