export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { bffFetch, bffRefresh, isExpired } from "@/lib/bff";
import { clearSession, getSession, setSession } from "@/lib/session";

/** État de session pour le client : jamais de jeton, seulement le nécessaire à l'UI. */
export async function GET() {
  let session = getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  if (isExpired(session)) {
    const next = await bffRefresh(session);
    if (!next) {
      clearSession();
      return NextResponse.json({ authenticated: false });
    }
    setSession(next);
    session = next;
  }

  return NextResponse.json({ authenticated: true, name: session.name, email: session.email });
}

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * RESYNCHRONISATION DU NOM AFFICHÉ, APRÈS UNE MODIFICATION DU PROFIL.
 *
 * Le nom du bandeau latéral ne vient PAS d'une requête d'écran : il est posé dans le
 * cookie de session au moment de la connexion (`sessionFromTokens`, dérivé des claims
 * `given_name`/`family_name`), puis lu par le layout serveur. Deux conséquences que
 * l'on avait sous les yeux sans les relier :
 *
 *   - enregistrer « Mon compte » n'y changeait rien, puisque la mutation n'invalide
 *     qu'une clé React Query côté client ;
 *   - un `router.refresh()` seul n'y aurait rien changé non plus : le layout relit le
 *     MÊME cookie, qui porte toujours l'ancien nom ;
 *   - et un rafraîchissement de jeton non plus — `bffRefresh` reconduit délibérément
 *     `name` et `email` de la session précédente (voir sa note).
 *
 * Le vendeur voyait donc son ancien nom jusqu'à sa prochaine CONNEXION.
 *
 * On réécrit donc la partie affichage du cookie à partir de ce que le serveur dit du
 * compte — jamais à partir de ce que le client envoie : cette route n'a pas de corps,
 * et va relire `/seller/account/me` avec le jeton de la session. Un client ne peut pas
 * se choisir un nom d'affichage par ici.
 *
 * En cas d'échec, on ne touche PAS au cookie : mieux vaut un nom périmé qu'une session
 * amputée de son identité d'affichage — mais la réponse porte alors
 * `resynchronise: false`, pour que l'appelant le dise au vendeur au lieu de le taire.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
export async function POST() {
  let session = getSession();
  if (!session) {
    return NextResponse.json({ resynchronise: false, sessionExpired: true }, { status: 401 });
  }

  if (isExpired(session)) {
    const next = await bffRefresh(session);
    if (!next) {
      clearSession();
      return NextResponse.json({ resynchronise: false, sessionExpired: true }, { status: 401 });
    }
    setSession(next);
    session = next;
  }

  let res = await bffFetch("/seller/account/me", session.accessToken);

  // ───────────────────────────────────────────────────────────────────────────────
  // UN 401 SE REJOUE APRÈS RAFRAÎCHISSEMENT, COMME PARTOUT AILLEURS.
  //
  // `isExpired` ne regarde que la date inscrite dans le cookie : un jeton RÉVOQUÉ
  // entre-temps (mot de passe changé depuis un autre appareil, session fermée) la
  // passe sans encombre. Sans ce rejeu, une session parfaitement RÉCUPÉRABLE — il
  // suffisait de rafraîchir — repartait en « nom non réaligné », et le cookie mort
  // restait en place jusqu'au prochain appel passant par le proxy.
  // ───────────────────────────────────────────────────────────────────────────────
  if (res.status === 401) {
    const next = await bffRefresh(session);
    if (!next) {
      clearSession();
      return NextResponse.json({ resynchronise: false, sessionExpired: true }, { status: 401 });
    }
    setSession(next);
    session = next;
    res = await bffFetch("/seller/account/me", session.accessToken);
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // ÉCHEC = ON NE TOUCHE À RIEN, ET ON LE DIT.
  //
  // `resynchronise: false` n'est pas une formalité : l'appelant s'en sert pour
  // prévenir le vendeur que le menu gardera l'ancien nom. Un échec muet ramenait
  // exactement le défaut que cette route corrige, sans que personne ne puisse le
  // voir ni réessayer — le bouton « Enregistrer » redevient inactif dès que le
  // formulaire est à jour.
  // ───────────────────────────────────────────────────────────────────────────────
  if (!res.ok) {
    return NextResponse.json({ resynchronise: false, name: session.name, email: session.email });
  }

  const me = (await res.json().catch(() => null)) as
    | { firstName?: string; lastName?: string; email?: string }
    | null;

  // FORME INATTENDUE : on ne réécrit pas. Un objet vide — ou un contrat qui aurait
  // bougé, ce même endpoint exposant déjà deux formes voisines (`SellerAccountMe` à
  // plat et `SellerMe` imbriqué) — passerait le seul test de nullité, et le repli
  // `|| email` remplacerait DURABLEMENT le nom du vendeur par son adresse : le cookie
  // survit aux rafraîchissements de jeton, qui reconduisent `name` tel quel.
  const prenom = (me?.firstName ?? "").trim();
  const nom = (me?.lastName ?? "").trim();
  if (!prenom && !nom) {
    return NextResponse.json({ resynchronise: false, name: session.name, email: session.email });
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // PAS TOUT À FAIT LA MÊME EXPRESSION QU'À LA CONNEXION, ET C'EST VOULU.
  //
  // `sessionFromTokens` compose `` `${given} ${family}`.trim() || email || "Vendeur" ``.
  // Les replis y sont indispensables : un jeton peut arriver sans ces claims. Ici,
  // l'absence des deux noms ne se replie PAS — elle refuse d'écrire (garde ci-dessus),
  // parce qu'un repli sur l'e-mail serait DURABLE : le cookie survit aux
  // rafraîchissements de jeton, qui reconduisent `name` tel quel.
  //
  // Les deux chemins produisent donc la même chaîne dans tous les cas atteignables —
  // `User.UpdateProfile` refuse un prénom ou un nom vide — mais par deux voies
  // différentes. Déplacer ou assouplir la garde rouvrirait l'écart : c'est ici qu'il
  // faudrait alors remettre les replis.
  // ───────────────────────────────────────────────────────────────────────────────
  const email = me?.email ?? session.email;
  const name = `${prenom} ${nom}`.trim();

  setSession({ ...session, name, email });
  return NextResponse.json({ resynchronise: true, name, email });
}
