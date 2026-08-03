"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { shouldNavigateOnRowClick } from "@/lib/row-navigation";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
import { orderTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { SellerOrder } from "@/types/seller";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const PAGE_SIZE = 25;

export default function OrdersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search.trim()) params.set("search", search.trim());

  const q = useQuery({
    queryKey: ["seller-orders", page, search],
    queryFn: () => bff<SellerOrder[]>(`/seller/orders?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const rows = q.data ?? [];

  // ───────────────────────────────────────────────────────────────────────────────
  // PAGINATION SANS TOTAL — ET ON LE DIT.
  //
  // `/seller/orders` renvoie un TABLEAU, pas une enveloppe paginée : le nombre total
  // de commandes n'est pas connu du client. On en déduit seulement qu'il reste des
  // pages tant qu'on reçoit une page pleine.
  //
  // Écrire « Vous avez tout vu » sans cette information serait faux une fois sur
  // vingt-cinq — c'est exactement le défaut relevé sur la recherche de l'app acheteur
  // (§2.2), qui affiche « Vous avez vu tous les résultats » sans jamais paginer.
  // ───────────────────────────────────────────────────────────────────────────────
  const hasNext = rows.length === PAGE_SIZE;

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Commandes</h1>
        <p className="text-sm text-muted-foreground">
          {q.isLoading ? "Chargement…" : `Page ${page} — ${rows.length} commande(s) affichée(s)`}
        </p>
      </header>

      <PageNote>
        Vos commandes, et pour chacune <strong>uniquement vos lignes</strong>. Sur une commande
        partagée avec d&apos;autres vendeurs, les totaux affichés ici sont donc les vôtres — pas ce
        que l&apos;acheteur a payé au total.
      </PageNote>

      <QueryError of={q} />

      <form onSubmit={submitSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Référence ou SKU…"
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="outline">
          Rechercher
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
          >
            Effacer
          </Button>
        )}
      </form>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Référence</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Paiement</TableHead>
              <TableHead className="text-right">Votre total</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : q.isError ? (
              // Le bandeau QueryError dit déjà pourquoi ; on évite juste de laisser
              // croire à une liste vide.
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Liste non chargée.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {search ? "Aucune commande ne correspond à cette recherche." : "Aucune commande pour l'instant."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((o) => (
                // ─────────────────────────────────────────────────────────────────
                // LE LIEN EST DANS LA CELLULE, PAS SUR LA LIGNE.
                //
                // Le `onClick` du `<tr>` n'est qu'un CONFORT à la souris : il ne donne
                // ni clic milieu, ni « ouvrir dans un nouvel onglet », ni aperçu de
                // l'URL. La référence, elle, est un vrai `<a>` — d'où le clavier et
                // les lecteurs d'écran passent.
                //
                // On ne met donc NI `tabIndex` NI `aria-label` sur la ligne : un
                // `<tr>` focusable en double du lien qu'il contient force à tabuler
                // deux fois par commande, et `aria-label` sur une ligne de tableau est
                // restitué de façon erratique. Le lien fait le travail, correctement.
                // ─────────────────────────────────────────────────────────────────
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => {
                    if (shouldNavigateOnRowClick()) router.push(`/orders/${o.id}`);
                  }}
                >
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/orders/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary hover:underline"
                    >
                      CMD-{shortId(o.id).toUpperCase()}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{o.customer}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(o.createdAtUtc)}</TableCell>
                  <TableCell>
                    <Badge variant={orderTone(o.status)}>{statusLabel(o.status, "order")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral">{statusLabel(o.paymentStatus, "payment")}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatXof(o.grandTotal)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <ChevronRight className="size-4" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="size-4" /> Précédent
            </Button>
            <Button size="sm" variant="outline" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
              Suivant <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </Card>

    </div>
  );
}
