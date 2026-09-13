# Déploiement autonome — Console vendeur

Cette pile fait tourner la console vendeur **seule**, sur son propre VPS, avec son
propre Traefik et son propre certificat. Elle appelle le BFF Vendeur par son URL
publique.

---

## D'abord : en as-tu besoin ?

Il existe **deux** façons de déployer cette console, et il faut en choisir une.

| | Pile principale | Cette pile |
|---|---|---|
| Où | `marketPlace/deploy/docker-compose.prod.yml`, service `seller-console` | ici |
| Traefik | celui du backend, partagé | le sien |
| Appel au BFF | réseau Docker interne (`http://bff-seller:8080`) | Internet (`https://seller.hba-express.org`) |
| Déployée par | `.github/workflows/deploy.yml` (SSH → `up -d seller-console`) | `./deploy.sh` |
| Quand | **c'est le déploiement actuel** | si le front doit vivre sur un autre serveur que le back |

**Les deux sur le même hôte ne peuvent pas coexister** : ce Traefik publie les ports
80 et 443, déjà pris par celui de la pile principale. Le conteneur refusera de
démarrer — échec immédiat et lisible, ce qui vaut mieux qu'un recouvrement silencieux.

Si tu passes à cette pile, retire le service `seller-console` de la pile principale,
sinon deux applications servent la même chose et la CI continue de redéployer celle
que tu n'utilises plus.

---

## Mise en service

```bash
cd Seller_MP_Next/deploy

cp .env.prod.example .env.prod     # puis renseigner
openssl rand -base64 32            # pour SESSION_SECRET

./deploy.sh prod up
./deploy.sh prod cert              # vérifie quel certificat est servi
```

### Avant le premier `up` : le DNS

`CONSOLE_DOMAIN` doit déjà pointer (enregistrement `A`, et `AAAA` si IPv6) vers l'IP
de **ce** serveur. Un nom sans enregistrement fait échouer l'émission de son
certificat, en silence.

Si la zone est chez Cloudflare : **nuage GRIS, définitivement**. Proxifié, Cloudflare
répond au handshake TLS à la place de Traefik et le certificat n'est jamais émis — ni
au premier déploiement, ni à aucun renouvellement, donc le site tomberait au bout de
90 jours.

---

## Trois différences avec le déploiement de la console admin

Ce dossier est calqué sur `Admin_MP_Next/deploy/`, mais trois choses ne se
transposent pas telles quelles. Elles sont signalées ici parce que ce sont exactement
les endroits où une copie mécanique casse.

**1. La sonde de santé n'utilise pas `curl`.** L'image de la console vendeur n'en
contient pas — son `Dockerfile` s'en explique, et sonde avec `node`. Recopier la
sonde de la console admin donnerait un conteneur perpétuellement « unhealthy », et un
déploiement qui échoue au bout de 150 secondes sur une panne inexistante.

**2. Le tag de production est `:latest`, pas `:prod`.** La CI de cette console pousse
`:staging`, `:latest` (production) et `:<sha>`. Celle de la console admin pousse
`:prod`. Préfère de toute façon figer un `:<sha>` : c'est le seul moyen de savoir
après coup quelle version tourne, et de revenir en arrière sans reconstruire.

**3. Le routeur Traefik s'appelle `seller-console-standalone`.** La pile principale
en déclare déjà un nommé `seller-console`. Tant que les deux vivent sur deux hôtes,
rien ne se croise — mais branchés sur un même Traefik, deux routeurs de même nom se
recouvrent et l'un disparaît sans la moindre erreur. Le cas s'est déjà produit entre
la console admin et la pile principale.

S'y ajoute une chose que cette pile fait et que celle de la console admin ne fait
pas : **les en-têtes de sécurité et la limitation de débit**. La pile principale les
applique via `edge-chain@file` ; ici il n'y a pas de provider « file », donc ils sont
déclarés en labels. Sans eux, l'écran de connexion des vendeurs serait servi sans
HSTS, sans protection contre le cadrage et sans aucune limite de débit.

---

## Le front sur `.com`, le back sur `.org`

`CONSOLE_DOMAIN` est sur `hba-express.com`, `SELLER_BFF_URL` sur `hba-express.org`.
Ce n'est pas une faute de frappe, et ça ne coûte rien — parce que **le navigateur ne
parle jamais au BFF**.

La console expose un relais côté serveur (`/api/bff/[...path]`) et c'est lui seul qui
appelle `SELLER_BFF_URL`. Il n'y a pas non plus de client SignalR dans la console : le
hub `/seller/hubs/chat` n'est utilisé que par l'application Flutter, qui est native et
n'a pas d'origine.

Conséquences :

- **Aucun CORS à ouvrir.** `SELLER_CORS_ORIGINS` côté BFF peut rester vide ; le BFF
  refuse alors toute origine, ce qui est le bon réglage et non un oubli.
- **Aucun cookie tierce partie.** `mp_seller_session` est posé par Next sur sa propre
  origine — première partie, aucune question de `SameSite`.
- **`SELLER_BFF_URL` n'est jamais exposée au navigateur**, et reste donc sur `.org`.

---

## Diagnostic

```bash
./deploy.sh prod cert      # quel certificat est servi ?
./deploy.sh prod logs      # journaux de la console
docker compose -p seller-console-prod logs -f traefik | grep -i acme
```

| Symptôme | Cause la plus probable |
|---|---|
| `unable to get local issuer certificate`, `issuer=CN=TRAEFIK DEFAULT CERT` | Aucun certificat émis : soit aucun routeur ne porte ce nom, soit ACME a échoué |
| `issuer=...Cloudflare...` | Le nuage est orange — repasse en « DNS only » |
| 404 de Traefik (avec `curl -Ik`) | `CONSOLE_DOMAIN` ne correspond pas à la règle du routeur |
| Conteneur « unhealthy » en boucle | `SELLER_BFF_URL` injoignable depuis ce VPS, ou `SESSION_SECRET` invalide |
| Traefik refuse de démarrer, port déjà utilisé | Une autre pile occupe déjà 80/443 sur cet hôte — voir plus haut |

Let's Encrypt limite à **5 validations échouées par heure** pour un même nom. Après
plusieurs tentatives, l'attente ne produit aucun message clair côté `curl` : la
réponse est dans les journaux de Traefik.
