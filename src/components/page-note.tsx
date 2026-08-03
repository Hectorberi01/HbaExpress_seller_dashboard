import { Card, CardContent } from "@/components/ui/card";

/**
 * Bandeau explicatif en tête de page : dit à quoi sert l'écran et signale les
 * conséquences des actions qu'on y fait (surtout celles qui touchent à l'argent
 * ou sont irréversibles). Même présentation partout — voir la page Remboursements.
 */
export function PageNote({ children }: { children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <CardContent className="p-4 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}
