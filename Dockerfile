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
# AUCUN secret n'est passé au build, et c'est volontaire.
#
# `SESSION_SECRET` et `SELLER_BFF_URL` ne sont lus qu'à L'EXÉCUTION (côté serveur
# Next, jamais côté navigateur). Les injecter ici les figerait dans une couche de
# l'image — donc dans le registre, donc lisibles par quiconque peut tirer l'image.
# ---------------------------------------------------------------------------
# LES VARIABLES `NEXT_PUBLIC_*` SONT L'EXCEPTION, ET ELLE EST OBLIGATOIRE.
#
# Next les SUBSTITUE DANS LE CODE au moment du `next build` : elles n'existent plus
# comme variables à l'exécution, seulement comme littéraux dans le paquet envoyé au
# navigateur. Les poser uniquement dans le compose n'a donc STRICTEMENT AUCUN EFFET —
# le bouton « Activer les notifications » répondrait « pas encore configurées », sans
# rien dans les journaux pour l'expliquer.
#
# Ce n'est pas une fuite : ces valeurs sont publiques par construction (elles partent
# dans le JavaScript de chaque page et dans le service worker). Ce sont des
# identifiants de projet Firebase, pas des secrets. Le secret de la messagerie est le
# compte de service, et il reste côté serveur, monté sur le VPS du backend.
#
# À passer en `--build-arg` (ou `args:` du compose de build, ou `build-args:` du
# workflow GitHub). Laissées vides, le push est simplement DÉSACTIVÉ, proprement.
# ---------------------------------------------------------------------------
ARG NEXT_PUBLIC_FIREBASE_API_KEY=""
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="hbaexpress-8b056.firebaseapp.com"
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID="hbaexpress-8b056"
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="hbaexpress-8b056.firebasestorage.app"
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="191660803638"
ARG NEXT_PUBLIC_FIREBASE_APP_ID="1:191660803638:web:96d0c7632c24f138727a97"
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="G-XV8KKP65KS"
ARG NEXT_PUBLIC_FIREBASE_VAPID_KEY="BJyKgIAtijWhmZT7E75Cg1da26x0SDMGCICUsfRlxsxHL97ndAr_B8D_5gEnvH3ZMUh_u8BoqcrmuuKMrNmHy_A"
ARG NEXT_PUBLIC_FIREBASE_ANALYTICS="true"

ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=$NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID \
    NEXT_PUBLIC_FIREBASE_VAPID_KEY=$NEXT_PUBLIC_FIREBASE_VAPID_KEY \
    NEXT_PUBLIC_FIREBASE_ANALYTICS=$NEXT_PUBLIC_FIREBASE_ANALYTICS

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
