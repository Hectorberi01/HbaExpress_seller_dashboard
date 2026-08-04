"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import type { GeoPoint } from "@/components/location-field";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CARTE D'AJUSTEMENT — LEAFLET NU, SANS `react-leaflet`.
 *
 * Trois décisions, toutes prises pour la même raison : réduire ce qui peut casser.
 *
 * 1. LEAFLET SEUL. `react-leaflet` ajoute une couche dont la compatibilité suit
 *    celle de React et de Next : une montée de version de l'un casse l'autre. Ici,
 *    un `useEffect` de quarante lignes suffit et ne dépend que de Leaflet.
 *
 * 2. IMPORT DYNAMIQUE. Leaflet touche `window` au chargement du module. Un import
 *    statique planterait au rendu serveur de Next. D'où le `await import()` DANS
 *    l'effet, qui ne s'exécute que côté navigateur.
 *
 * 3. REPÈRE FIXE AU CENTRE, pas un marqueur Leaflet. Outre que c'est le geste
 *    attendu — on déplace la carte sous le repère, on ne traîne pas une épingle
 *    sous son propre doigt — cela évite le défaut le plus connu de Leaflet avec
 *    un empaqueteur : les icônes de marqueur par défaut pointent vers des images
 *    introuvables, et l'on obtient un marqueur invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function MapPicker({
  value,
  onChange,
}: {
  value: GeoPoint | null;
  onChange: (p: GeoPoint) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [center, setCenter] = useState<GeoPoint>(value ?? { latitude: 6.3703, longitude: 2.3912 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !holder.current) return;

        const start = value ?? { latitude: 6.3703, longitude: 2.3912 };
        const instance = L.map(holder.current, { attributionControl: true })
          .setView([start.latitude, start.longitude], value ? 16 : 12);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(instance);

        instance.on("moveend", () => {
          const c = instance.getCenter();
          setCenter({ latitude: c.lat, longitude: c.lng });
        });

        map = instance;
      } catch {
        // Tuiles bloquées, réseau coupé, module absent : on le dit plutôt que de
        // laisser un rectangle gris. La saisie manuelle reste disponible au-dessus.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
    // Volontairement vide : la carte est créée UNE fois. La recréer à chaque
    // changement de `value` la ferait sauter sous la main de l'utilisateur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <p className="rounded-md border border-input px-3 py-4 text-center text-sm text-muted-foreground">
        Carte indisponible. Saisissez les coordonnées à la main.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={holder} className="h-64 w-full rounded-md border border-input" />
        {/* Le repère est décalé d'une demi-hauteur : sa POINTE doit tomber sur le
            centre de la carte, pas son milieu. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <MapPin className="size-8 -translate-y-4 text-destructive" strokeWidth={2.5} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {center.latitude.toFixed(6)}, {center.longitude.toFixed(6)}
        </span>
        <button
          type="button"
          onClick={() => onChange(center)}
          className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"
        >
          Utiliser ce point
        </button>
      </div>
    </div>
  );
}
