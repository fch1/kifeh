# Kifeh كيفاه — image de production
FROM node:22-slim

# Dépendances natives (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
# Données persistantes (base SQLite + médias) : monter un volume sur /app/data et /app/uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000
USER node
CMD ["node", "server.js"]
