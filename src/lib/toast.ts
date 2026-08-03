// Store de toasts minimal (pub/sub au niveau module) : utilisable partout, y
// compris depuis les callbacks React Query (hors arbre React).

export type ToastType = "success" | "error" | "info";
export type ToastItem = { id: number; message: string; type: ToastType };

let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();
let seq = 0;

function emit() {
  listeners.forEach((l) => l(items));
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, type: ToastType = "info", ttl = 4500) {
  const id = ++seq;
  items = [...items, { id, message, type }];
  emit();
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

export const toastSuccess = (m: string) => toast(m, "success");
export const toastError = (m: string) => toast(m, "error");

export function subscribeToasts(l: (items: ToastItem[]) => void) {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}
