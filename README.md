# Painel UnitV Online

Painel de revenda com entrega automática de códigos, pagamentos PIX (Mercado Pago) e painel administrativo.

## Stack
- Node.js + Express
- SQLite (better-sqlite3)
- SPA single-file em `public/`

## Rodar localmente
```bash
npm install
npm start          # http://localhost:3000
```

## Variáveis de ambiente (.env)
| Chave | Descrição |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `JWT_SECRET` | Segredo dos tokens de sessão |
| `MP_ACCESS_TOKEN` | Token de produção do Mercado Pago |
| `DB_PATH` | Caminho do arquivo SQLite (opcional; ex.: `/data/painel.db`) |

## Deploy
- **Docker**: `docker compose up -d --build` (dev) ou `deploy/docker-compose.prod.yml` com Caddy para HTTPS
- **Railway**: deploy direto via CLI (`railway up`) ou conectado a este repositório; volume montado em `/data` com `DB_PATH=/data/painel.db`

## Webhook Mercado Pago
`POST /api/pay/webhook` — além disso, um poller interno confirma pendências a cada 30s.
