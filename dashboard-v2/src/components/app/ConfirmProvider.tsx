import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

// Imperative confirm dialog. Call `const confirm = useConfirm()` once in a
// component, then `if (!await confirm({ title, description })) return;` before
// any destructive mutation. The provider renders a single AlertDialog and
// resolves the promise with the user's choice — call sites stay one line and
// never manage their own open/close state.
//
// Closes the "no confirm on delete/reset/wipe/restore" finding class across
// EconomyView, AiMemoryView, BackupsView, ModulesView, AutoRulesView,
// ScheduleView, DangerzoneView.

interface ConfirmOptions {
  title: string;
  description?: string;
  /** Destructive-action label (defaults to "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Keep the resolver reachable from the close handlers even if a new confirm
  // races in — stash it on a ref so we always resolve the *current* promise.
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setPending({ opts, resolve });
    });
  }, []);

  const settle = (ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setPending(null);
  };

  const open = pending !== null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(o) => { if (!o) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.opts.title ?? "Are you sure?"}</AlertDialogTitle>
            {pending?.opts.description && (
              <AlertDialogDescription>{pending.opts.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {pending?.opts.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => settle(true)}>
              {pending?.opts.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
