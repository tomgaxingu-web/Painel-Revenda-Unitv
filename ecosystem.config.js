// PM2 — mantém o painel rodando 24h e reinicia sozinho se cair
//
// Uso no servidor:
//   pm2 start ecosystem.config.js
//   pm2 startup && pm2 save     # sobe junto com o servidor após reboot
//   pm2 logs painel             # ver logs
//   pm2 restart painel          # reiniciar após atualizar o código
//
// IMPORTANTE: manter exec_mode 'fork' e instances 1 — o banco SQLite
// (better-sqlite3) não suporta múltiplos processos escrevendo no mesmo arquivo.

module.exports = {
  apps: [{
    name: 'painel',
    script: 'server.js',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
