import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Liste déroulante — un `<select>` natif, habillé au thème.
 *
 * Pas de menu reconstruit en div : sur mobile, le natif ouvre le sélecteur du système
 * (roulette iOS, liste plein écran Android), il se navigue au clavier sans une ligne
 * de JavaScript et il est lu correctement par les lecteurs d'écran. Une réimplémentation
 * perdrait les trois pour gagner une flèche mieux dessinée.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "nm-input flex h-9 w-full appearance-none rounded-xl bg-background px-3.5 py-1 text-sm text-foreground transition-shadow focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export { Select };
