import { Hash } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Channel } from "@/lib/types";

const NONE = "__none__";

/** Single-channel picker. Empty value = "None". */
export function ChannelSelect({
  value,
  onChange,
  channels,
  placeholder = "Select a channel…",
  allowNone = true,
}: {
  value: string;
  onChange: (id: string) => void;
  channels: Channel[];
  placeholder?: string;
  allowNone?: boolean;
}) {
  return (
    <Select
      value={value || (allowNone ? NONE : "")}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">None</span>
          </SelectItem>
        )}
        {channels.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="inline-flex items-center gap-1.5">
              <Hash className="size-3.5 text-muted-foreground" />
              {c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
