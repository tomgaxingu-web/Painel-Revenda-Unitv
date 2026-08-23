const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/database');

const sign = (id, role) => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });

router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos.' });
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    return res.status(400).json({ error: 'E-mail já cadastrado.' });
  const r = db.prepare("INSERT INTO users (name,email,password) VALUES (?,?,?)").run(name, email, bcrypt.hashSync(password, 10));
  db.prepare("INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)")
    .run(r.lastInsertRowid, '👋 Bem-vindo!', `Olá, ${name}! Sua conta foi criada com sucesso.`, 'success');
  res.json({ token: sign(r.lastInsertRowid, 'user'), user: { id: r.lastInsertRowid, name, email, role: 'user', balance: 0 } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !bcrypt.compareSync(password, u.password))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  db.prepare("INSERT INTO audit_log (user_id,action) VALUES (?,'login')").run(u.id);
  res.json({ token: sign(u.id, u.role), user: { id: u.id, name: u.name, email: u.email, role: u.role, balance: u.balance } });
});

module.exports = router;
