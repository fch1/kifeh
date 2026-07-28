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
COPY scripts ./scripts

# Référentiel DFCI : donnée STATIQUE de l'application — construit DANS l'image,
# HORS du volume /app/data (un volume vide monté ne peut pas l'effacer).
RUN mkdir -p /app/reference \
    && DFCI_REFERENCE_PATH=/app/reference/dfci-france.sqlite \
       node scripts/build-dfci-reference.mjs --force
ENV DFCI_REFERENCE_PATH=/app/reference/dfci-france.sqlite

ENV NODE_ENV=production
# Données persistantes (base SQLite + médias) : monter un volume sur /app/data et /app/uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000
USER node
CMD ["node", "server.js"]
