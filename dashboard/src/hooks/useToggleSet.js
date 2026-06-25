import { useState, useCallback } from "react";

/**
 * Hook for managing a Set of selected IDs with a toggle function.
 *
 * Returns [selected, toggle, setSelected] where toggle(id) adds/removes an ID.
 *
 * @param {string[]|Set} [initial] - Initial selected IDs
 * @returns {[Set, (id: string) => void, React.Dispatch<React.SetStateAction<Set>>]}
 */
export default function useToggleSet(initial = []) {
  const [selected, setSelected] = useState(() => new Set(initial));

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return [selected, toggle, setSelected];
}
