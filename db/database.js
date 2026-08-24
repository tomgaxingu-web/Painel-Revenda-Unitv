const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'painel.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');

// ── SCHEMA ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    UNIQUE NOT NULL,
    password   TEXT    NOT NULL,
    balance    REAL    DEFAULT 0,
    role       TEXT    DEFAULT 'user',
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    period     TEXT NOT NULL,
    badge      TEXT NOT NULL,
    sub_title  TEXT DEFAULT 'Cartão de Recarga • 16 dígitos',
    logo_text  TEXT,
    logo_bg    TEXT DEFAULT '#1e0a3c',
    logo_grad  TEXT DEFAULT '',
    stock      INTEGER DEFAULT 0,
    active     INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS product_tiers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    min_qty    INTEGER NOT NULL,
    price      REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    code       TEXT    NOT NULL,
    used       INTEGER DEFAULT 0,
    order_id   INTEGER,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    product_id     INTEGER NOT NULL REFERENCES products(id),
    quantity       INTEGER NOT NULL,
    unit_price     REAL    NOT NULL,
    total          REAL    NOT NULL,
    status         TEXT    DEFAULT 'pending',
    payment_method TEXT    DEFAULT 'pix',
    mp_payment_id  TEXT,
    mp_qr_code     TEXT,
    mp_qr_b64      TEXT,
    created_at     TEXT    DEFAULT (datetime('now','localtime')),
    paid_at        TEXT
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    amount        REAL    NOT NULL,
    status        TEXT    DEFAULT 'pending',
    mp_payment_id TEXT,
    mp_qr_code    TEXT,
    mp_qr_b64     TEXT,
    created_at    TEXT    DEFAULT (datetime('now','localtime')),
    paid_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    type       TEXT    DEFAULT 'info',
    read       INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT    NOT NULL,
    detail     TEXT,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_codes_product  ON codes(product_id, used);
  CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id, read);
  CREATE INDEX IF NOT EXISTS idx_orders_mp      ON orders(mp_payment_id);
  CREATE INDEX IF NOT EXISTS idx_deposits_mp    ON deposits(mp_payment_id);
`);

// ── MIGRATION: logo_url (imagem do produto) ───────────────────
if (!db.prepare("PRAGMA table_info(products)").all().some(c => c.name === 'logo_url')) {
  db.exec("ALTER TABLE products ADD COLUMN logo_url TEXT");
}

// ── MIGRATION: mp_payment_id gravado como float ("175327726436.0")
// quebrava o casamento no webhook/poller/check. Normaliza para dígitos.
db.exec("UPDATE orders   SET mp_payment_id = REPLACE(CAST(mp_payment_id AS TEXT),'.0','') WHERE mp_payment_id LIKE '%.0'");
db.exec("UPDATE deposits SET mp_payment_id = REPLACE(CAST(mp_payment_id AS TEXT),'.0','') WHERE mp_payment_id LIKE '%.0'");

// Backfill: associa as imagens da pasta /logos aos produtos existentes
const LOGO_MAP = [
  ['TV Express', '/logos/tvexpress.png'],
  ['FlixxCine',  '/logos/flixxcine.png'],
  ['Redplay',    '/logos/redplay.jpg'],
  ['UniTV',      '/logos/unitv.png'],
  ['YouCine',    '/logos/youcine.jpg'],
];
const updLogo = db.prepare("UPDATE products SET logo_url=? WHERE name LIKE ? AND (logo_url IS NULL OR logo_url='')");
LOGO_MAP.forEach(([name, url]) => updLogo.run(url, `%${name}%`));

// ── SEED ADMIN ────────────────────────────────────────────────
if (!db.prepare("SELECT id FROM users WHERE email='admin@painel.com'").get()) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')")
    .run('Administrador', 'admin@painel.com', hash);
}

// ── SEED PRODUTOS ─────────────────────────────────────────────
if (!db.prepare("SELECT COUNT(*) as c FROM products").get().c) {
  const ins  = db.prepare("INSERT INTO products (name,period,badge,logo_text,logo_bg,logo_grad,logo_url,stock,sort_order) VALUES (?,?,?,?,?,?,?,?,?)");
  const insT = db.prepare("INSERT INTO product_tiers (product_id,min_qty,price) VALUES (?,?,?)");
  const insC = db.prepare("INSERT INTO codes (product_id,code) VALUES (?,?)");

  const seed = [
    { name:'UniTV Mensal',       period:'30 Dias',  badge:'MENSAL', logo:'U',     img:'/logos/unitv.png',     bg:'#0a1f3a', grad:'linear-gradient(135deg,#0d3060,#0a1f3a)', stock:620, tiers:[[1,12],[5,11],[10,10],[50,9]] },
    { name:'UniTV Anual',        period:'365 Dias', badge:'ANUAL',  logo:'U',     img:'/logos/unitv.png',     bg:'#0a1f3a', grad:'linear-gradient(135deg,#0d3060,#0a1f3a)', stock:140, tiers:[[1,69],[5,63],[10,58]] },
    { name:'TV Express Mensal',  period:'30 Dias',  badge:'MENSAL', logo:'TV+',   img:'/logos/tvexpress.png', bg:'#0f1f3d', grad:'linear-gradient(135deg,#1a3a6b,#0d2447)', stock:480, tiers:[[1,15],[5,13],[10,12],[50,10]] },
    { name:'TV Express Anual',   period:'365 Dias', badge:'ANUAL',  logo:'TV+',   img:'/logos/tvexpress.png', bg:'#0f1f3d', grad:'linear-gradient(135deg,#1a3a6b,#0d2447)', stock:165, tiers:[[1,130],[5,110],[10,90]] },
    { name:'FlixxCine Mensal',   period:'30 Dias',  badge:'MENSAL', logo:'FLIXX', img:'/logos/flixxcine.png', bg:'#2d1a00', grad:'linear-gradient(135deg,#5c3600,#2d1a00)', stock:342, tiers:[[1,12],[5,10.5],[10,9.5],[50,9]] },
    { name:'FlixxCine Anual',    period:'365 Dias', badge:'ANUAL',  logo:'FLIXX', img:'/logos/flixxcine.png', bg:'#2d1a00', grad:'linear-gradient(135deg,#5c3600,#2d1a00)', stock:210, tiers:[[1,62],[5,55],[10,50]] },
    { name:'Redplay Anual',      period:'365 Dias', badge:'ANUAL',  logo:'▶',     img:'/logos/redplay.jpg',   bg:'#3a0a0a', grad:'linear-gradient(135deg,#6b1414,#3a0a0a)', stock:150, tiers:[[1,130],[5,110],[10,90]] },
    { name:'YouCine Mensal',     period:'30 Dias',  badge:'MENSAL', logo:'YC',    img:'/logos/youcine.jpg',   bg:'#1a0a2e', grad:'linear-gradient(135deg,#3d1a6b,#1a0a2e)', stock:415, tiers:[[1,14.5],[5,13],[10,12],[50,10.5]] },
    { name:'YouCine Anual',      period:'365 Dias', badge:'ANUAL',  logo:'YC',    img:'/logos/youcine.jpg',   bg:'#1a0a2e', grad:'linear-gradient(135deg,#3d1a6b,#1a0a2e)', stock:180, tiers:[[1,55],[5,50],[10,45]] },
    { name:'AlphaPlay Mensal',   period:'30 Dias',  badge:'MENSAL', logo:'AP',    img:'/logos/alphaplay.jpg', bg:'#101028', grad:'linear-gradient(135deg,#232350,#101028)', stock:0, tiers:[[1,12],[5,10.5],[10,9.5]] },
    { name:'NexaTV Mensal',      period:'30 Dias',  badge:'MENSAL', logo:'NX',    img:'/logos/nexatv.webp',   bg:'#0d1f1a', grad:'linear-gradient(135deg,#16443a,#0d1f1a)', stock:0, tiers:[[1,12],[5,11],[10,10]] },
    { name:'NexoCine Mensal',    period:'30 Dias',  badge:'MENSAL', logo:'NC',    img:'/logos/nexocine.webp', bg:'#20102a', grad:'linear-gradient(135deg,#3a1c4a,#20102a)', stock:0, tiers:[[1,13],[5,11.5],[10,10.5]] },
    { name:'UniCine Mensal',     period:'30 Dias',  badge:'MENSAL', logo:'UC',    img:'/logos/unicine.webp',  bg:'#0a1a2e', grad:'linear-gradient(135deg,#123456,#0a1a2e)', stock:0, tiers:[[1,14],[5,12.5],[10,11]] },
  ];

  seed.forEach((p, i) => {
    const r = ins.run(p.name, p.period, p.badge, p.logo, p.bg, p.grad, p.img, p.stock, i);
    p.tiers.forEach(([q, v]) => insT.run(r.lastInsertRowid, q, v));
    for (let j = 0; j < 10; j++) {
      const code = Array.from({length:16}, ()=>Math.floor(Math.random()*10)).join('');
      insC.run(r.lastInsertRowid, code);
    }
  });
}

// ── HELPERS ───────────────────────────────────────────────────
db.getProductsFull = () => {
  const prods = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY sort_order,id").all();
  const tiers = db.prepare("SELECT * FROM product_tiers ORDER BY product_id,min_qty").all();
  return prods.map(p => ({ ...p, tiers: tiers.filter(t => t.product_id === p.id) }));
};

db.getProductsAll = () => {
  const prods = db.prepare("SELECT * FROM products ORDER BY sort_order,id").all();
  const tiers = db.prepare("SELECT * FROM product_tiers ORDER BY product_id,min_qty").all();
  return prods.map(p => ({ ...p, tiers: tiers.filter(t => t.product_id === p.id) }));
};

db.calcPrice = (productId, qty) => {
  const tiers = db.prepare("SELECT * FROM product_tiers WHERE product_id=? ORDER BY min_qty DESC").all(productId);
  for (const t of tiers) if (qty >= t.min_qty) return t.price;
  return tiers[tiers.length - 1]?.price || 0;
};

db.deliverCodes = db.transaction((userId, productId, qty, unitPrice, total, orderId) => {
  const codes = db.prepare("SELECT * FROM codes WHERE product_id=? AND used=0 LIMIT ?").all(productId, qty);
  if (codes.length < qty) throw new Error(`Estoque insuficiente. Disponível: ${codes.length}`);

  let oid = orderId;
  if (!oid) {
    oid = db.prepare(
      "INSERT INTO orders (user_id,product_id,quantity,unit_price,total,status,payment_method,paid_at) VALUES (?,?,?,?,?,'paid','balance',datetime('now','localtime'))"
    ).run(userId, productId, qty, unitPrice, total).lastInsertRowid;
  } else {
    db.prepare("UPDATE orders SET status='paid',paid_at=datetime('now','localtime') WHERE id=?").run(oid);
  }

  const upd = db.prepare("UPDATE codes SET used=1,order_id=? WHERE id=?");
  codes.forEach(c => upd.run(oid, c.id));

  const avail = db.prepare("SELECT COUNT(*) as c FROM codes WHERE product_id=? AND used=0").get(productId).c;
  db.prepare("UPDATE products SET stock=? WHERE id=?").run(avail, productId);

  if (!orderId) db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(total, userId);

  db.prepare("INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)")
    .run(userId, '✅ Compra confirmada', `${qty}× código(s) entregue(s). Confira em Meus Códigos.`, 'success');

  db.prepare("INSERT INTO audit_log (user_id,action,detail) VALUES (?,?,?)")
    .run(userId, 'order_paid', JSON.stringify({ order_id: oid, product_id: productId, qty, total }));

  return { orderId: oid, codes: codes.map(c => c.code) };
});

db.getStats = () => ({
  totalUsers:    db.prepare("SELECT COUNT(*) as c FROM users WHERE role='user'").get().c,
  totalOrders:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='paid'").get().c,
  totalRevenue:  db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='paid'").get().s,
  pendingOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").get().c,
  totalCodes:    db.prepare("SELECT COUNT(*) as c FROM codes").get().c,
  usedCodes:     db.prepare("SELECT COUNT(*) as c FROM codes WHERE used=1").get().c,
  todayRevenue:  db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='paid' AND date(paid_at)=date('now','localtime')").get().s,
  todayOrders:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='paid' AND date(paid_at)=date('now','localtime')").get().c,
});

db.getSalesChart = () => {
  return db.prepare(`
    SELECT date(paid_at) as day, COUNT(*) as orders, SUM(total) as revenue
    FROM orders WHERE status='paid' AND paid_at >= datetime('now','-30 days','localtime')
    GROUP BY date(paid_at) ORDER BY day
  `).all();
};

// Dashboard admin completo — agrega TODOS os produtos
db.getDashboard = () => {
  const kpi = {
    todayRevenue:  db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='paid' AND date(paid_at)=date('now','localtime')").get().s,
    monthRevenue:  db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='paid' AND strftime('%Y-%m',paid_at)=strftime('%Y-%m','now','localtime')").get().s,
    totalRevenue:  db.prepare("SELECT COALESCE(SUM(total),0) as s FROM orders WHERE status='paid'").get().s,
    todayOrders:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='paid' AND date(paid_at)=date('now','localtime')").get().c,
    monthOrders:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='paid' AND strftime('%Y-%m',paid_at)=strftime('%Y-%m','now','localtime')").get().c,
    totalOrders:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='paid'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").get().c,
    totalUsers:    db.prepare("SELECT COUNT(*) as c FROM users WHERE role='user'").get().c,
    newUsersMonth: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='user' AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')").get().c,
    stockTotal:    db.prepare("SELECT COALESCE(SUM(stock),0) as s FROM products WHERE active=1").get().s,
    usedCodes:     db.prepare("SELECT COUNT(*) as c FROM codes WHERE used=1").get().c,
    totalCodes:    db.prepare("SELECT COUNT(*) as c FROM codes").get().c,
  };
  const perProduct = db.prepare(`
    SELECT p.id, p.name, p.logo_url, p.stock,
           COALESCE(SUM(o.quantity),0) AS sold_qty,
           COALESCE(SUM(o.total),0)    AS revenue
    FROM products p
    LEFT JOIN orders o ON o.product_id = p.id AND o.status='paid'
    GROUP BY p.id
    ORDER BY revenue DESC, sold_qty DESC
  `).all();
  const recentOrders = db.prepare(`
    SELECT o.id, o.quantity, o.total, o.status, o.created_at,
           u.name AS user_name, p.name AS product_name
    FROM orders o
    JOIN users u    ON u.id = o.user_id
    JOIN products p ON p.id = o.product_id
    ORDER BY o.id DESC LIMIT 8
  `).all();
  return { ...kpi, perProduct, recentOrders };
};

// Compras recentes para o feed público da capa (nome mascarado por privacidade)
db.getRecentPurchases = (limit = 8) => {
  const rows = db.prepare(`
    SELECT o.quantity, o.paid_at, p.name AS product_name, p.logo_url, u.name AS user_name
    FROM orders o
    JOIN users u    ON u.id = o.user_id
    JOIN products p ON p.id = o.product_id
    WHERE o.status='paid'
    ORDER BY o.paid_at DESC, o.id DESC
    LIMIT ?
  `).all(limit);
  return rows.map(r => {
    const parts = String(r.user_name || '').trim().split(/\s+/);
    const masked = parts[0] + (parts.length > 1 ? ' ' + parts[parts.length - 1][0].toUpperCase() + '.' : '');
    return { user: masked, product: r.product_name, logo_url: r.logo_url, qty: r.quantity, paid_at: r.paid_at };
  });
};

module.exports = db;
