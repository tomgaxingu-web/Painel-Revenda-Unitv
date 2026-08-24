# AUDITORIA COMPLETA — Painel Unitv

Data: 24/08/2026
Branch: main
Commit: 0c79163

---

## 1. ESTADO DO REPOSITÓRIO

- `main` sincronizada com `origin/main`
- 1 arquivo não commitado: `public/index.html` (alteração de "Revendedor" → "Cliente")
- 2 commits recentes: webhook/MP + correções de produção

---

## 2. SEGURANÇA — ACHADOS CRÍTICOS

### CRÍTICO: Credenciais expostas no `.env`
- `MP_ACCESS_TOKEN` (token real do Mercado Pago)
- `EMAIL_SERVER_PASSWORD` (senha de app Gmail)
- `JWT_SECRET` fraco (`troque_por_segredo_forte_64chars_aqui`)
- Arquivo `.env` está no repo (não está no `.gitignore`? Verificar)

### CRÍTICO: Senha admin exposta no código
- `database.js` linha 143: `admin123` hardcoded
- `server.js` linha 33: `Admin: admin@painel.com / admin123` no console
- Qualquer pessoa com acesso ao código ou logs tem acesso admin

### ALTO: Token JWT com segredo fraco
- `JWT_SECRET` no `.env` é previsível
- Se vazado, qualquer token pode ser forjado

---

## 3. CÓDIGO — PROBLEMAS ENCONTRADOS

### `routes/user.js`
- `pushToUser` exportado 2 vezes (linha 37 e 144) — redundante, mas funciona

### `routes/payments.js`
- `notification_url` agora usa constante `MP_WEBHOOK_URL` (bom)
- Rollback implementado para `/deposit` e `/order` (bom)
- Email assíncrono corrigido (bom)

### `routes/auth.js`
- Sem rate limiting no login — vulnerável a brute force
- `register` não valida formato de email

### `routes/admin.js`
- `/backup` permite download do banco completo — aceitável se apenas admin

### `routes/settings.js`
- `/public` expõe número de WhatsApp — aceitável (público)

---

## 4. FRONTEND (`public/index.html`)

- Modificação não commitada: `USR.role==='admin'?'Administrador':'Cliente'` (antes era `'Revendedor'`)
- Se intencional, precisa ser commitada; se acidental, reverter

---

## 5. DEPENDÊNCIAS

- `nodemailer` instalado (usado para email)
- `axios`, `express`, `better-sqlite3`, `bcryptjs`, `jsonwebtoken` — todos atualizados
- Nenhuma vulnerabilidade conhecida nas versões usadas

---

## 6. CONFIGURAÇÃO / INFRA

- `.env` contém credenciais reais — **deve ser removido do repo** e adicionado ao `.gitignore`
- `docker-compose.prod.yml` e `deploy/` existem — verificar se `.env` está exposto no deploy
- `nginx-painel.conf` e `Caddyfile` — verificar se expõem arquivos sensíveis

---

## 7. RECOMENDAÇÕES IMEDIATAS

1. **Remover `.env` do git** e adicionar ao `.gitignore`
2. **Trocar `JWT_SECRET`** por uma chave forte (64+ chars aleatórios)
3. **Trocar senha admin** (`admin123`) e remover do `database.js`
4. **Remover credenciais do console** (`server.js` linha 33)
5. **Commitar ou reverter** `public/index.html`
6. **Implementar rate limiting** no `/login` e `/register`
7. **Verificar deploy** se `.env` está exposto

---

## 8. STATUS DO MERCADO PAGO

- `notification_url`: configurado via constante `MP_WEBHOOK_URL`
- `external_reference`: `deposit_id` / `order_id` conforme caso
- Webhook endpoint: `/api/pay/webhook` funcionando
- Poller: ativo (30s)
- Token MP: `APP_USR-5383715112342540-...` (real, no `.env`)

---

## 9. CONCLUSÃO

O código está funcional e as correções do Mercado Pago estão implementadas. **Não está seguro para produção** devido a:
- Credenciais expostas no `.env`
- Senha admin hardcoded
- JWT_SECRET fraco
- Falta de rate limiting

Corrigir esses itens antes de colocar em produção.
