const router = require('express').Router();
const axios  = require('axios');
const { v4: uuid } = require('uuid');
const db     = require('../db/database');
const { auth } = require('./middleware');

const MP  = () => process.env.MP_ACCESS_TOKEN;
const HDR = () => ({ Authorization:`Bearer ${MP()}`, 'Content-Type':'application/json', 'X-Idempotency-Key': uuid() });

async function createPixPayment(amount, description, email, name) {
  const { data } = await axios.post('https://api.mercadopago.com/v1/payments', {
    transaction_amount: parseFloat(amount),
    description,
    payment_method_id: 'pix',
    payer: { email, first_name: name }
  }, { headers: HDR() });
  return {
    id: String(data.id),
    status: data.status,
    qr_code:        data.point_of_interaction?.transaction_data?.qr_code || '',
    qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64 || '',
  };
}

// POST /api/pay/deposit
router.post('/deposit', auth, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 1) return res.status(400).json({ error: 'Valor mínimo R$ 1,00.' });
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  try {
    const pix = await createPixPayment(amount, `Depósito PanelReseller - ${user.name}`, user.email, user.name);
    const dep = db.prepare("INSERT INTO deposits (user_id,amount,mp_payment_id,mp_qr_code,mp_qr_b64) VALUES (?,?,?,?,?)")
      .run(req.user.id, amount, pix.id, pix.qr_code, pix.qr_code_base64);
    res.json({ deposit_id: dep.lastInsertRowid, ...pix });
  } catch(e) {
    console.error('MP deposit error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Erro ao gerar PIX. Verifique o token MP.' });
  }
});

// POST /api/pay/order  (PIX direto)
router.post('/order', auth, async (req, res) => {
  const { product_id, quantity } = req.body;
  if (!product_id || !quantity || quantity < 1) return res.status(400).json({ error: 'Dados inválidos.' });
  const user    = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const product = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(product_id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });
  const unit_price = db.calcPrice(product_id, quantity);
  const total      = unit_price * quantity;
  const avail      = db.prepare("SELECT COUNT(*) as c FROM codes WHERE product_id=? AND used=0").get(product_id).c;
  if (avail < quantity) return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${avail}` });
  try {
    const pix = await createPixPayment(total, `${product.name} ×${quantity}`, user.email, user.name);
    const ord = db.prepare("INSERT INTO orders (user_id,product_id,quantity,unit_price,total,status,mp_payment_id,mp_qr_code,mp_qr_b64) VALUES (?,?,?,?,?,'pending',?,?,?)")
      .run(req.user.id, product_id, quantity, unit_price, total, pix.id, pix.qr_code, pix.qr_code_base64);
    res.json({ order_id: ord.lastInsertRowid, total, unit_price, ...pix });
  } catch(e) {
    console.error('MP order error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Erro ao gerar PIX.' });
  }
});

// POST /api/pay/balance  (saldo)
router.post('/balance', auth, (req, res) => {
  const { product_id, quantity } = req.body;
  if (!product_id || !quantity || quantity < 1) return res.status(400).json({ error: 'Dados inválidos.' });
  const user    = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const product = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(product_id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });
  const unit_price = db.calcPrice(product_id, quantity);
  const total      = unit_price * quantity;
  if (user.balance < total) return res.status(400).json({ error: `Saldo insuficiente. Disponível: R$ ${user.balance.toFixed(2)}` });
  try {
    const result = db.deliverCodes(req.user.id, product_id, quantity, unit_price, total, null);
    const updated = db.prepare("SELECT balance FROM users WHERE id=?").get(req.user.id);
    res.json({ ...result, balance: updated.balance });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── CONFIRMAÇÃO DE PAGAMENTOS ─────────────────────────────────
async function fetchMP(id) {
  const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${id}`, { headers: HDR() });
  return data;
}

const creditDeposit = db.transaction((dep) => {
  db.prepare("UPDATE deposits SET status='paid',paid_at=datetime('now','localtime') WHERE id=?").run(dep.id);
  db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(dep.amount, dep.user_id);
});

// Liquida depósito ou pedido pendente pelo ID do pagamento MP (idempotente)
function settlePayment(mpId) {
  mpId = String(mpId).replace(/\D/g, '');
  const dep = db.prepare("SELECT * FROM deposits WHERE mp_payment_id=? AND status='pending'").get(mpId);
  if (dep) {
    creditDeposit(dep);
    db.prepare("INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)")
      .run(dep.user_id, '💰 Depósito aprovado', `R$ ${Number(dep.amount).toFixed(2)} adicionado ao seu saldo.`, 'success');
    console.log(`✅ [settle] Depósito #${dep.id} aprovado R$${dep.amount}`);
    return 'deposit';
  }
  const ord = db.prepare("SELECT * FROM orders WHERE mp_payment_id=? AND status='pending'").get(mpId);
  if (ord) {
    try { db.deliverCodes(ord.user_id, ord.product_id, ord.quantity, ord.unit_price, ord.total, ord.id); }
    catch (e) { console.error('[settle] deliverCodes error:', e.message); return null; }
    console.log(`✅ [settle] Pedido #${ord.id} aprovado`);
    return 'order';
  }
  return null;
}

// Poller no servidor: confirma pendências mesmo SEM webhook público
const hasRealToken = () => !!process.env.MP_ACCESS_TOKEN && !/SEU-TOKEN/i.test(process.env.MP_ACCESS_TOKEN);
async function pollPending() {
  if (!hasRealToken()) return;
  try {
    const rows = [
      ...db.prepare("SELECT mp_payment_id FROM orders WHERE status='pending' AND mp_payment_id IS NOT NULL AND created_at >= datetime('now','-2 hours')").all(),
      ...db.prepare("SELECT mp_payment_id FROM deposits WHERE status='pending' AND mp_payment_id IS NOT NULL AND created_at >= datetime('now','-2 hours')").all(),
    ];
    const ids = [...new Set(rows.map(r => String(r.mp_payment_id)))];
    for (const id of ids) {
      try {
        const pay = await fetchMP(id);
        if (pay.status === 'approved') settlePayment(id);
      } catch {}
    }
  } catch (e) { console.error('[poller] error:', e.message); }
}
setInterval(pollPending, 30000);

// POST /api/pay/webhook  (requer URL pública; local fica coberto pelo poller)
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const { type, data } = req.body;
  if (type !== 'payment' || !data?.id) return;
  try {
    const pay = await fetchMP(data.id);
    if (pay.status === 'approved') settlePayment(String(data.id));
  } catch (e) { console.error('Webhook error:', e.message); }
});

// GET /api/pay/check/:mp_id  (polling do frontend durante o checkout)
router.get('/check/:mp_id', auth, async (req, res) => {
  const mpId = String(req.params.mp_id).replace(/\D/g, '');
  try {
    const pay = await fetchMP(mpId);
    if (pay.status === 'approved') settlePayment(mpId);
    const user = db.prepare("SELECT balance FROM users WHERE id=?").get(req.user.id);
    const unread = db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND read=0").get(req.user.id).c;
    res.json({ status: pay.status, balance: user.balance, unread });
  } catch(e) { res.status(500).json({ error: 'Erro ao verificar pagamento.' }); }
});

module.exports = router;
