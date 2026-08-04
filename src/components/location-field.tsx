"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Crosshair, ExternalLink, Loader2, Map as MapIcon, X } from "lucide-react";
import { MapPicker } from "@/components/map-picker";

export type GeoPoint = { latitude: number; longitude: number };

/** Ouvre le point dans OpenStreetMap — aucune clé, aucun compte. */
export function mapUrl(p: GeoPoint): string {
  return `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * POSITION DU LIEU DE RETRAIT, DEPUIS UN NAVIGATEUR.
 *
 * Pourquoi ce champ n'est pas le même que sur mobile : un navigateur de bureau
 * n'a pas de GPS. `navigator.geolocation` s'y appuie sur le Wi-Fi et l'adresse
 * IP — précision de l'ordre de la centaine de mètres, parfois du kilomètre. Le
 * proposer sans le dire produirait des points faux que personne ne corrigerait.
 *
 * D'où trois voies, dans cet ordre :
 *   • « Ma position » — utile quand le vendeur est SUR PLACE, ce qui arrive
 *     souvent au moment d'enregistrer son entrepôt, et sur navigateur mobile où
 *     le GPS est réel ;
 *   • saisie manuelle des coordonnées — pour recopier un point relevé ailleurs ;
 *   • « Vérifier sur la carte » — pour contrôler avant d'enregistrer, plutôt que
 *     de découvrir l'erreur quand un coursier se perd.
 *
 * La carte n'est chargée QUE si le vendeur la déplie. Ce n'est pas de l'avarice :
 * Leaflet et ses tuiles ne doivent pas peser sur un formulaire que la plupart
 * rempliront sans y toucher — et la politique d'usage d'OpenStreetMap suppose
 * qu'on ne charge pas de tuiles sans raison.
 *
 * FACULTATIF. Le point de repère reste l'information de référence.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function LocationField({
  value,
  onChange,
  label = "Position (facultatif)",
}: {
  value: GeoPoint | null;
  onChange: (p: GeoPoint | null) => void;
  label?: string;
}) {
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function locate() {
    if (!("geolocation" in navigator)) {
      setNotice("Ce navigateur ne sait pas donner de position.");
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        // On annonce la précision : 1 200 m sur un poste de bureau, ce n'est pas
        // une position d'entrepôt, et le vendeur doit pouvoir en juger.
        setNotice(`Précision annoncée : environ ${Math.round(pos.coords.accuracy)} m.`);
        setLocating(false);
      },
      () => {
        setNotice("Position indisponible. Saisissez les coordonnées ou continuez sans.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  function setPart(part: "latitude" | "longitude", raw: string) {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "") {
      // Vider un champ retire la position ENTIÈRE : une coordonnée seule
      // placerait le point dans le golfe de Guinée.
      onChange(null);
      return;
    }
    if (Number.isNaN(n)) return;
    const next = { latitude: value?.latitude ?? 0, longitude: value?.longitude ?? 0, [part]: n };
    onChange(next as GeoPoint);
  }

  const outOfRange =
    value != null &&
    (Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>

      <div className="grid grid-cols-2 gap-3">
        <Input
          value={value?.latitude ?? ""}
          onChange={(e) => setPart("latitude", e.target.value)}
          placeholder="Latitude (6.3703)"
          inputMode="decimal"
        />
        <Input
          value={value?.longitude ?? ""}
          onChange={(e) => setPart("longitude", e.target.value)}
          placeholder="Longitude (2.3912)"
          inputMode="decimal"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={locate} disabled={locating}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          Ma position
        </Button>

        {value && !outOfRange && (
          <a
            href={mapUrl(value)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-3.5" /> Vérifier sur la carte
          </a>
        )}

        <Button type="button" size="sm" variant="outline" onClick={() => setShowMap((v) => !v)}>
          <MapIcon className="size-4" /> {showMap ? "Masquer la carte" : "Choisir sur la carte"}
        </Button>

        {value && (
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(null)}>
            <X className="size-4" /> Retirer
          </Button>
        )}
      </div>

      {/* Dépliée DANS LE FLUX, comme la liste des communes : une carte positionnée
          en `absolute` serait rognée par l'overflow de la boîte de dialogue. */}
      {showMap && (
        <MapPicker
          value={value}
          onChange={(p) => {
            onChange(p);
            setShowMap(false);
          }}
        />
      )}

      {outOfRange ? (
        <p className="text-xs text-destructive">
          Coordonnées hors limites. Latitude entre −90 et 90, longitude entre −180 et 180.
        </p>
      ) : notice ? (
        <p className="text-xs text-muted-foreground">{notice}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Aide le coursier à trouver votre entrepôt. Le point de repère suffit pour être servi.
        </p>
      )}
    </div>
  );
}
