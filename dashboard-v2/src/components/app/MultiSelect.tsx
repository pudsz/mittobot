import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  name: string;
}

/**
 * Searchable multi-select (channels, roles). Replaces v1's DropdownSelect.
 * `prefix` renders "#" for channels / "@" for roles in chips and rows.
 */
export function MultiSelect({
  items,
  selected,
  onChange,
  prefix = "",
  placeholder = "Select…",
  emptyText = "Nothing found.",
}: {
  items: Item[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  prefix?: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected]
  );

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {selected.size > 0 ? `${selected.size} selected` : placeholder}
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem key={item.id} value={item.name} onSelect={() => toggle(item.id)}>
                    <Check
                      className={cn(
                        "size-4",
                        selected.has(item.id) ? "opacity-100 text-primary" : "opacity-0"
                      )}
                    />
                    {prefix}
                    {item.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedItems.map((item) => (
            <Badge key={item.id} variant="secondary" className="gap-1 pr-1">
              {prefix}
              {item.name}
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive cursor-pointer"
                aria-label={`Remove ${item.name}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
