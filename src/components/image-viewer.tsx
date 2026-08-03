"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 1.4;

/**
 * Visionneuse plein écran pour une série d'images, avec zoom.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS LE COMPOSANT `Dialog`
 *
 * `Dialog` est calibré pour un formulaire : `max-w-md`, fond de carte, marge interne.
 * Une photo de produit y serait réduite à la taille d'une vignette — c'est-à-dire
 * exactement ce qu'on cherchait à quitter en cliquant.
 *
 * NAVIGATION SUR TOUTE LA SÉRIE, PAS SUR UNE SEULE IMAGE
 *
 * Les pièces jointes d'une conversation, comme le couple avant/après d'un détourage,
 * forment une série : on ouvre celle qu'on a cliquée, puis on parcourt les autres aux
 * flèches. Enfermer la visionneuse dans une image obligerait à fermer et rouvrir pour
 * comparer — le geste même qu'on fait quand on vérifie un contour.
 *
 * LE ZOOM PART DE « AJUSTÉ », JAMAIS AU-DELÀ
 *
 * À l'ouverture, l'image tient dans l'écran : c'est ce qu'on veut voir en premier, et
 * une visionneuse qui s'ouvre déjà agrandie oblige à reculer avant de comprendre ce
 * qu'on regarde. Le grossissement est ensuite explicite — molette, boutons, ou double
 * clic — et le déplacement à la souris ne s'active QUE lorsqu'il y a matière à
 * déplacer. Vérifier qu'un détourage n'a pas mangé une manche demande d'aller voir de
 * près : c'est précisément l'usage.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function ImageViewer({
  images,
  startIndex,
  labels,
  onClose,
}: {
  images: string[];
  /** Index de l'image cliquée. */
  startIndex: number;
  /** Légendes facultatives, dans le même ordre (« Avant », « Après »…). */
  labels?: string[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  // Distingue un déplacement d'un simple clic : sans cela, relâcher après avoir fait
  // glisser l'image déclencherait la fermeture prévue pour le clic sur le fond.
  const moved = useRef(false);

  useEffect(() => setMounted(true), []);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Rouvrir sur une autre image doit repartir de CELLE-LÀ, et à l'échelle d'origine :
  // conserver un grossissement d'une image à l'autre donne l'impression d'un bug.
  useEffect(() => {
    setIndex(startIndex);
    reset();
  }, [startIndex, reset]);

  const count = images.length;
  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex((i) => (i + delta + count) % count);
      reset();
    },
    [count, reset],
  );

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor));
      // Revenu à l'échelle 1 : on recentre, sinon l'image reste décalée hors de vue
      // sans qu'aucun déplacement ne soit possible pour la ramener.
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "+" || e.key === "=") zoomBy(STEP);
      if (e.key === "-") zoomBy(1 / STEP);
      if (e.key === "0") reset();
    };
    document.addEventListener("keydown", onKey);

    // Verrou de défilement : sans lui, la molette fait défiler la page DERRIÈRE la
    // visionneuse, et on la retrouve déplacée en refermant.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [go, onClose, reset, zoomBy]);

  // ───────────────────────────────────────────────────────────────────────────────
  // MOLETTE : ÉCOUTEUR NATIF, NON PASSIF.
  //
  // React attache `onWheel` en mode PASSIF : `preventDefault()` y est ignoré, et le
  // navigateur applique son propre zoom (Ctrl + molette) par-dessus le nôtre. Le seul
  // moyen d'empêcher cela est un écouteur natif déclaré `{ passive: false }`.
  // ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? STEP : 1 / STEP);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  if (!mounted || count === 0) return null;

  const safeIndex = Math.min(index, count - 1);
  const src = images[safeIndex];
  const label = labels?.[safeIndex];
  const zoomed = scale > MIN_SCALE;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Visionneuse d'images"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          {label && <span className="truncate text-sm font-medium">{label}</span>}
          <span className="text-sm tabular-nums opacity-70">
            {count > 1 ? `${safeIndex + 1} / ${count}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs tabular-nums opacity-70">{Math.round(scale * 100)} %</span>
          <button
            type="button"
            onClick={() => zoomBy(1 / STEP)}
            disabled={scale <= MIN_SCALE}
            aria-label="Réduire"
            title="Réduire (−)"
            className="rounded-lg p-2 transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <ZoomOut className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(STEP)}
            disabled={scale >= MAX_SCALE}
            aria-label="Agrandir"
            title="Agrandir (+)"
            className="rounded-lg p-2 transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <ZoomIn className="size-5" />
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!zoomed}
            aria-label="Ajuster à l'écran"
            title="Ajuster à l'écran (0)"
            className="rounded-lg p-2 transition-colors hover:bg-white/10 disabled:opacity-30"
          >
            <Maximize2 className="size-5" />
          </button>
          {/* Vraie ancre : un `window.open` déclenché par du code serait bloqué, et
              c'est le seul moyen de voir l'image en pleine résolution ou de l'enregistrer. */}
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            title="Ouvrir dans un nouvel onglet"
            className="rounded-lg p-2 transition-colors hover:bg-white/10"
          >
            <ExternalLink className="size-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-2 transition-colors hover:bg-white/10"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/*
        Le fond ferme au clic, l'image non : cliquer sur la photo qu'on regarde pour la
        faire disparaître serait le contraire de ce qu'on attend.

        ⚠️ `min-h-0` EST INDISPENSABLE, ce n'est pas une précaution décorative.

        Un enfant de conteneur flex a `min-height: auto` par défaut : il refuse de
        devenir plus petit que son contenu. Ce bloc s'étirait donc à la hauteur NATURELLE
        de la photo — souvent trois ou quatre fois l'écran — et `max-h-full` sur l'image,
        qui se mesure par rapport à ce parent déjà débordé, ne contraignait plus rien.
        On ne voyait que le coin supérieur gauche du cliché.

        `min-h-0` rend le bloc compressible, `overflow-hidden` cadre le zoom.
      */}
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
        onClick={() => {
          if (!moved.current) onClose();
        }}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label="Image précédente"
            className="absolute left-2 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label ?? `Image ${safeIndex + 1} sur ${count}`}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (zoomed) reset();
            else zoomBy(STEP * STEP);
          }}
          onPointerDown={(e) => {
            if (!zoomed) return;
            e.stopPropagation();
            moved.current = false;
            dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
            // Capture : le doigt ou le curseur peut sortir de l'image en la déplaçant,
            // le suivi ne doit pas s'interrompre pour autant.
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const from = dragging.current;
            if (!from) return;
            moved.current = true;
            setOffset({ x: e.clientX - from.x, y: e.clientY - from.y });
          }}
          onPointerUp={(e) => {
            dragging.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            // Réarmé au tour de boucle suivant : le `click` qui suit un déplacement
            // doit encore voir `moved` à vrai pour ne pas fermer la visionneuse.
            setTimeout(() => {
              moved.current = false;
            }, 0);
          }}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            // Pas de transition pendant le déplacement : elle transformerait un
            // glissement continu en saccades d'un dixième de seconde.
            transition: dragging.current ? "none" : "transform 120ms ease-out",
          }}
          // `h-auto w-auto` : sans eux, une image plus PETITE que la fenêtre serait
          // étirée jusqu'à remplir le bloc et perdrait en netteté. On l'ajuste vers le
          // bas, jamais au-delà de sa taille réelle — le zoom, lui, est explicite.
          className={`max-h-full max-w-full h-auto w-auto select-none object-contain ${
            zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          }`}
        />

        {count > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label="Image suivante"
            className="absolute right-2 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      <p className="px-4 pb-3 text-center text-xs text-white/50">
        Molette ou double clic pour agrandir · glisser pour déplacer · Échap pour fermer
      </p>
    </div>,
    document.body,
  );
}
