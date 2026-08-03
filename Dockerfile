# ---------------------------------------------------------------------------
# Console Vendeur (Next.js 14) — image de production « standalone ».
#
# Construite et poussée par .github/workflows/deploy.yml ; consommée par le
# service `seller-console` des compose staging et prod du dépôt backend.
#
# Build local :  docker build -t ghcr.io/hectorberi01/seller-console:staging .
# ---------------------------------------------------------------------------

# 1) Dépendances — couche mise en cache tant que package*.json ne bouge pas.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# 2) Build.
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# ⚠️ AUCUN secret n'est passé au build, et c'est volontaire.
#
# `SESSION_SECRET` et `SELLER_BFF_URL` ne sont lus qu'à L'EXÉCUTION (côté serveur
# Next, jamais côté navigateur). Les injecter ici les figerait dans une couche de
# l'image — donc dans le registre, donc lisibles par quiconque peut tirer l'image.
RUN npm run build

# 3) Exécution — sortie standalone, image minimale.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Utilisateur non privilégié : le processus Next n'a aucune raison d'être root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Sonde SANS curl : `node` est déjà là, l'installer serait une dépendance de plus
# (et une surface de plus) pour une requête HTTP de trois lignes.
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=20s \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
