# `src/components/ui/charts.tsx` — pourquoi ce fichier a été retiré

Il exportait cinq graphes écrits à la main en SVG : `LineChart`, `BarChart`,
`Sparkline`, `MultiLineChart`, `DonutChart`. **Un seul était utilisé** — le donut de
« Commandes par statut », sur le tableau de bord. Les quatre autres n'étaient importés
nulle part.

Ce qui a décidé du retrait n'est pas le code mort, c'est sa palette. `CHART_COLORS`
n'avait jamais été mesurée. Passée au validateur, sur la surface claire de la console :

```
[FAIL] Plancher de chroma        « #64748b » lit comme du gris (0,041)
[FAIL] Séparation vision déficiente  #84cc16 ↔ #22c55e  ΔE 5,5 (protanopie) — seuil 8
[FAIL] Plancher vision normale   #84cc16 ↔ #22c55e  ΔE 8,0 — plancher 15
[WARN] Contraste sur la surface  4 couleurs sur 7 sous 3:1
```

La troisième ligne est la plus grave : **8,0 en vision NORMALE**. Deux verts voisins
que personne ne distingue, quelle que soit sa vue. Sur le donut, « Payée » et
« Confirmée » étaient donc deux parts de la même couleur apparente, et seule
l'infobulle les séparait.

Laisser le fichier en place aurait garanti sa réutilisation : c'est la bibliothèque
qu'on trouve en cherchant « chart » dans le dépôt.

Les graphes vivent désormais dans `src/components/charts/`, sur Recharts, avec une
palette validée déclarée dans `globals.css` (`--viz-series-*`).

Ce dossier n'est pas supprimé automatiquement : `rm` est refusé sur les dossiers
montés. À supprimer à la main.
