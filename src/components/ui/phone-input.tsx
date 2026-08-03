"use client";

import { Input } from "@/components/ui/input";
import {
  BENIN_DIALING_CODE,
  BENIN_LOCAL_LENGTH,
  isCompletePhone,
} from "@/lib/phone";

/**
 * Champ téléphone béninois : indicatif figé, dix chiffres à saisir.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * L'INDICATIF N'EST PAS UN CHAMP DE SAISIE.
 *
 * Il est affiché, collé à gauche, et non modifiable. Le laisser taper produisait trois
 * variantes du même numéro — « +229… », « 00229… », « 229… » — pour un préfixe qui ne
 * change jamais. Le serveur normalise, certes, mais un vendeur qui recopie son numéro
 * depuis son téléphone avec l'indicatif se retrouvait avec « +229 » deux fois.
 *
 * LA SAISIE EST FILTRÉE, PAS SEULEMENT VALIDÉE.
 *
 * Tout ce qui n'est pas un chiffre est retiré à la frappe, et la longueur est bornée à
 * dix. Coller « +229 01 97 00 00 00 » depuis un carnet d'adresses fonctionne donc :
 * l'indicatif recopié est absorbé, les espaces disparaissent. Refuser le collage aurait
 * été le comportement le plus agaçant pour le geste le plus courant.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function PhoneInput({
  id,
  value,
  onChange,
  required,
  showError,
  hint,
}: {
  id: string;
  /** Partie LOCALE uniquement (dix chiffres), sans indicatif. */
  value: string;
  onChange: (local: string) => void;
  required?: boolean;
  /** Affiche l'erreur même si le champ n'a pas été touché (après une tentative d'envoi). */
  showError?: boolean;
  hint?: string;
}) {
  const empty = value.length === 0;
  const invalid = !empty && !isCompletePhone(value);
  const missing = required && empty && showError;

  function handle(raw: string) {
    let digits = raw.replace(/\D/g, "");
    // Un indicatif recopié dans le champ est absorbé, pas rejeté.
    if (digits.startsWith("229") && digits.length > BENIN_LOCAL_LENGTH) {
      digits = digits.slice(3);
    }
    onChange(digits.slice(0, BENIN_LOCAL_LENGTH));
  }

  return (
    <>
      <div className="flex">
        <span
          className="flex h-9 shrink-0 items-center rounded-l-xl bg-muted px-3 text-sm text-muted-foreground"
          aria-hidden
        >
          {BENIN_DIALING_CODE}
        </span>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          // Lu par les technologies d'assistance : le préfixe visuel, lui, est
          // `aria-hidden` — un lecteur d'écran annoncerait sinon « plus deux cent
          // vingt-neuf » comme s'il faisait partie de la saisie attendue.
          aria-label={`Téléphone, ${BENIN_LOCAL_LENGTH} chiffres après ${BENIN_DIALING_CODE}`}
          aria-invalid={invalid || missing}
          value={value}
          onChange={(e) => handle(e.target.value)}
          placeholder="0197000000"
          className="rounded-l-none"
        />
      </div>
      {invalid || missing ? (
        <p className="text-xs text-destructive">
          {missing
            ? "Le téléphone est obligatoire."
            : `${BENIN_LOCAL_LENGTH} chiffres attendus après ${BENIN_DIALING_CODE} — il en manque ${
                BENIN_LOCAL_LENGTH - value.length
              }.`}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </>
  );
}
