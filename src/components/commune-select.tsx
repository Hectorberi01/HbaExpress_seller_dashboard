"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, ChevronDown, X } from "lucide-react";

export type Commune = {
  code: string;
  name: string;
  departmentCode: string;
  departmentName: string;
};

type GeoResponse = {
  countryCode: string;
  dialingCode: string;
  phoneLength: number;
  communes: Commune[];
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LE RÉFÉRENTIEL VIENT DU SERVEUR, PAS D'UNE CONSTANTE LOCALE.
 *
 * Quatre surfaces ont besoin des 77 communes. Recopiée dans chacune, la liste
 * diverge à la première correction d'orthographe — et une commune que la console
 * propose mais que le serveur refuse produit une erreur incompréhensible pour le
 * vendeur. Le serveur reste l'unique autorité : ce qu'il liste est exactement ce
 * qu'il accepte.
 *
 * `staleTime: Infinity` : le découpage administratif n'a pas bougé depuis 1999.
 * La route est de toute façon mise en cache 24 h côté serveur.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function useCommunes() {
  return useQuery({
    queryKey: ["geo-communes"],
    queryFn: () => bff<GeoResponse>("/seller/geo/communes"),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Replie une chaîne pour la recherche : minuscules, sans accent, ponctuation
 * aplatie. Permet de trouver « Sèmè-Podji » en tapant « seme podji ».
 *
 * Ici `normalize("NFD")` est fiable — contrairement au serveur, où
 * `InvariantGlobalization` le rend inopérant. Le navigateur n'a pas ce mode.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SÉLECTEUR DE COMMUNE — LISTE INTÉGRÉE AU FLUX, PAS UN `<select>` NATIF.
 *
 * La version précédente utilisait un `<select>` avec l'attribut `size`. Avec 77
 * options, le navigateur ouvrait une liste système gigantesque qui DÉBORDAIT de
 * la boîte de dialogue et recouvrait la page entière — impossible à styler,
 * impossible à contenir. Et la recherche vivait dans un champ séparé du choix :
 * on tapait à un endroit, on cliquait à un autre.
 *
 * Ici, un seul champ. La liste s'ouvre EN DESSOUS, dans le flux normal, avec une
 * hauteur bornée et son propre défilement. Deux conséquences :
 *
 *   • Aucun risque de rognage. Une liste positionnée en `absolute` serait coupée
 *     par le `overflow` de la boîte de dialogue, ou passerait dessous à cause
 *     d'un `z-index` — la guerre habituelle. Dans le flux, la question ne se pose
 *     pas : le dialogue s'agrandit ou défile, et la liste reste dedans.
 *   • Le contenu situé dessous est poussé vers le bas à l'ouverture. C'est le prix
 *     assumé de la robustesse, et dans une boîte de dialogue il est faible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function CommuneSelect({
  value,
  onChange,
  label = "Commune",
  required = false,
  disabled = false,
}: {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { data, isLoading, isError } = useCommunes();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const communes = useMemo(() => data?.communes ?? [], [data]);
  const selected = useMemo(() => communes.find((c) => c.code === value), [communes, value]);

  const shown = useMemo(() => {
    const q = foldForSearch(filter);
    if (!q) return communes;
    return communes.filter((c) => foldForSearch(`${c.name} ${c.code} ${c.departmentName}`).includes(q));
  }, [communes, filter]);

  // Fermeture au clic extérieur et à Échap. Sans cela, la liste resterait ouverte
  // et pousserait le reste du formulaire indéfiniment.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function pick(code: string) {
    onChange(code);
    setFilter("");
    setOpen(false);
  }

  if (isError) {
    return (
      <div className="space-y-1.5">
        <Label>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        <p className="text-sm text-destructive">Liste des communes indisponible. Rechargez la page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>

      <div className="relative">
        <Input
          value={open ? filter : selected ? `${selected.name} · ${selected.departmentName}` : ""}
          onChange={(e) => {
            setFilter(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={isLoading ? "Chargement…" : "Rechercher une commune (Cotonou, Parakou…)"}
          disabled={disabled || isLoading}
          className="pr-16"
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
        />

        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {/* Effacer : sans ce bouton, revenir sur « aucune commune » imposerait de
              vider un champ qui affiche un libellé, pas une saisie. */}
          {selected && !open && !disabled && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Effacer la commune"
            >
              <X className="size-3.5" />
            </button>
          )}
          <ChevronDown className="size-4 text-muted-foreground" />
        </div>
      </div>

      {open && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-input bg-background">
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Aucune commune ne correspond.
              <br />
              La livraison n&apos;est possible qu&apos;au Bénin.
            </p>
          ) : (
            <ul role="listbox">
              {shown.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.code === value}
                    onClick={() => pick(c.code)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                      c.code === value ? "bg-muted font-semibold" : ""
                    }`}
                  >
                    <span>
                      {c.name}
                      <span className="ml-1.5 text-xs text-muted-foreground">{c.departmentName}</span>
                    </span>
                    {c.code === value && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
