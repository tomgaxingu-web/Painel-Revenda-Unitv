const router = require('express').Router();
const db     = require('../db/database');
const { auth, admin } = require('./middleware');

router.get('/',    auth,        (req, res) => res.json(db.getProductsFull()));
router.get('/all', auth, admin, (req, res) => res.json(db.getProductsAll()));

// Feed público de compras recentes (prova social na capa)
router.get('/feed', (req, res) => res.json(db.getRecentPurchases(8)));

router.post('/', auth, admin, (req, res) => {
  const { name, period, badge, sub_title, logo_text, logo_bg, logo_grad, logo_url, stock, tiers, sort_order } = req.body;
  if (!name || !tiers?.length) return res.status(400).json({ error: 'Dados incompletos.' });
  const r = db.prepare("INSERT INTO products (name,period,badge,sub_title,logo_text,logo_bg,logo_grad,logo_url,stock,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(name, period, badge, sub_title||'Cartão de Recarga • 16 dígitos', logo_text||'', logo_bg||'#1e0a3c', logo_grad||'', logo_url||'', parseInt(stock)||0, sort_order||0);
  tiers.forEach(t => db.prepare("INSERT INTO product_tiers (product_id,min_qty,price) VALUES (?,?,?)").run(r.lastInsertRowid, t.min_qty, t.price));
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', auth, admin, (req, res) => {
  const cur = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Produto não encontrado.' });
  // Atualização parcial: campos ausentes mantêm o valor atual (evita bind de undefined)
  const { name, period, badge, sub_title, logo_text, logo_bg, logo_grad, logo_url, stock, active, tiers, sort_order } = req.body;
  db.prepare("UPDATE products SET name=?,period=?,badge=?,sub_title=?,logo_text=?,logo_bg=?,logo_grad=?,logo_url=?,stock=?,active=?,sort_order=? WHERE id=?")
    .run(
      name      ?? cur.name,
      period    ?? cur.period,
      badge     ?? cur.badge,
      sub_title ?? cur.sub_title,
      logo_text ?? cur.logo_text,
      logo_bg   ?? cur.logo_bg,
      logo_grad ?? cur.logo_grad,
      logo_url  ?? cur.logo_url,
      stock     ?? cur.stock,
      active !== undefined ? (active ? 1 : 0) : cur.active,
      sort_order ?? cur.sort_order,
      req.params.id
    );
  if (tiers) {
    db.prepare("DELETE FROM product_tiers WHERE product_id=?").run(req.params.id);
    tiers.forEach(t => db.prepare("INSERT INTO product_tiers (product_id,min_qty,price) VALUES (?,?,?)").run(req.params.id, t.min_qty, t.price));
  }
  res.json({ ok: true });
});

router.post('/:id/codes', auth, admin, (req, res) => {
  const { codes } = req.body;
  if (!codes?.length) return res.status(400).json({ error: 'Nenhum código.' });
  let added = 0;
  const ins = db.prepare("INSERT INTO codes (product_id,code) VALUES (?,?)");
  for (const c of codes) {
    if (!db.prepare("SELECT id FROM codes WHERE code=? AND product_id=?").get(c.trim(), req.params.id)) {
      ins.run(req.params.id, c.trim()); added++;
    }
  }
  const stock = db.prepare("SELECT COUNT(*) as c FROM codes WHERE product_id=? AND used=0").get(req.params.id).c;
  db.prepare("UPDATE products SET stock=? WHERE id=?").run(stock, req.params.id);
  res.json({ message: `${added} código(s) adicionado(s).`, stock });
});

router.get('/:id/codes', auth, admin, (req, res) => {
  const { page = 1, used } = req.query;
  const limit = 100, offset = (page-1)*limit;
  let q = "SELECT * FROM codes WHERE product_id=?";
  const params = [req.params.id];
  if (used !== undefined) { q += " AND used=?"; params.push(parseInt(used)); }
  q += " ORDER BY id DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM codes WHERE product_id=?${used!==undefined?' AND used='+parseInt(used):''}`).get(req.params.id).c;
  res.json({ codes: db.prepare(q).all(...params), total, pages: Math.ceil(total/limit) });
});

module.exports = router;
