#!/usr/bin/env bash
# Déploiement autonome de la console vendeur (front) par environnement.
#
#   ./deploy.sh staging up        # démarre / met à jour la console de staging
#   ./deploy.sh prod up
#   ./deploy.sh prod logs         # suit les logs
#   ./deploy.sh prod ps           # état des conteneurs
#   ./deploy.sh prod cert         # où en est le certificat Let's Encrypt
#   ./deploy.sh staging down      # arrête la pile
#
# Chaque environnement a son propre fichier .env.<env> et son propre nom de projet
# Compose (seller-console-<env>) pour éviter tout mélange.
set -euo pipefail

ENV="${1:-}"
ACTION="${2:-up}"

case "$ENV" in
  staging|prod) ;;
  *) echo "Usage: $0 {staging|prod} {up|down|logs|ps|pull|cert}"; exit 1 ;;
esac

ENV_FILE=".env.${ENV}"
PROJECT="seller-console-${ENV}"
COMPOSE="docker compose -p ${PROJECT} --env-file ${ENV_FILE} -f docker-compose.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE introuvable. Copie l'exemple :"
  echo "    cp .env.${ENV}.example ${ENV_FILE}   puis renseigne-le."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# ON REFUSE DE DÉMARRER AVEC LE SECRET D'EXEMPLE.
#
# Ce cookie porte les jetons d'accès et de rafraîchissement des vendeurs. Laissé sur
# la valeur d'exemple, il est forgeable par quiconque a lu ce dépôt. L'application
# refuse déjà de servir dans ce cas — mais elle le fait APRÈS le déploiement, dans
# ses propres journaux. Le dire ici coûte une seconde et évite un conteneur qui
# redémarre en boucle sans qu'on sache pourquoi.
# ─────────────────────────────────────────────────────────────────────────────
if grep -q '^SESSION_SECRET=CHANGE_ME' "$ENV_FILE"; then
  echo "✗ SESSION_SECRET est resté sur la valeur d'exemple dans $ENV_FILE."
  echo "    Génère-en un :  openssl rand -base64 32"
  exit 1
fi

case "$ACTION" in
  up)    $COMPOSE pull && $COMPOSE up -d && echo "✓ Console vendeur ${ENV} déployée." ;;
  pull)  $COMPOSE pull ;;
  down)  $COMPOSE down ;;
  logs)  $COMPOSE logs -f seller-console ;;
  ps)    $COMPOSE ps ;;
  # Diagnostic du certificat : dit LEQUEL est réellement servi. « TRAEFIK DEFAULT
  # CERT » signifie qu'aucun certificat n'a été émis pour ce nom — soit le routeur
  # n'existe pas, soit la validation ACME a échoué (voir `logs`).
  cert)
    host=$(grep '^CONSOLE_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)
    echo "→ Certificat présenté par ${host} :"
    openssl s_client -connect "${host}:443" -servername "${host}" </dev/null 2>/dev/null \
      | openssl x509 -noout -issuer -subject -dates
    ;;
  *)     echo "Action inconnue: $ACTION (up|down|logs|ps|pull|cert)"; exit 1 ;;
esac
