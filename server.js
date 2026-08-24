require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
// HTML sempre sem cache — evita versões antigas travadas no navegador
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// Logos das operadoras servidos direto da pasta /logos
app.use('/logos', express.static(path.join(__dirname, 'logos')));

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/pay',      require('./routes/payments'));
app.use('/api/user',     require('./routes/user'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin',    require('./routes/admin'));

// Rotas de API desconhecidas → 404 JSON (não servir o HTML do SPA)
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Painel Unitv online → http://localhost:${PORT}`);
  console.log(`   Webhook: POST /api/pay/webhook\n`);
});
