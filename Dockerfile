FROM node:22-slim

WORKDIR /app

# Ferramentas de build (fallback caso o binário pré-compilado do better-sqlite3 não baixe)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Dependências primeiro (cache de camadas)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Código da aplicação
COPY server.js ./
COPY routes ./routes
COPY db/database.js ./db/database.js
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
