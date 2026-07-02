import { AnimatePresence, motion } from "motion/react";
import { Loader2, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sticky "you have unsaved changes" bar. Render it once at the bottom of a
 * page; it slides in whenever `dirty` is true.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onReset?: () => void;
}) {
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={{ y: 64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 64, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="sticky bottom-4 z-30 mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-lg border border-border bg-popover/95 px-4 py-2.5 shadow-lg backdrop-blur"
        >
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
          <div className="flex items-center gap-2">
            {onReset && (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
                <Undo2 /> Reset
              </Button>
            )}
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
