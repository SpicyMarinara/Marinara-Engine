import { MapPin } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { getLocationPinColor } from "../../lib/world-state-display";
import { visibleText } from "../../lib/tracker-display";
import { WorldRenderedEdit, WorldTileShell } from "./WorldEditableTile";

export function WorldLocationPlate({
  value,
  onSave,
  className,
}: {
  value: string | null | undefined;
  onSave?: (value: string) => void;
  className?: string;
}) {
  const locationText = visibleText(value, "Set location");
  const compactLocationText = locationText.length > 34;

  return (
    <WorldTileShell label="Location" className={cn("min-h-[2.375rem]", className)}>
      <WorldRenderedEdit
        label="Location"
        value={value}
        onSave={onSave}
        placeholder="Set location"
        className="relative z-[1] grid grid-cols-[1.7rem_minmax(0,1fr)] items-center gap-1 px-1 py-1 text-left @min-[380px]:grid-cols-[1.9rem_minmax(0,1fr)] @min-[380px]:px-1.5"
        inputClassName="text-center text-[0.75rem]"
        editHintClassName="right-1 top-1"
      >
        <div className="relative flex h-full min-h-[1.625rem] w-full items-center justify-center overflow-hidden rounded-[3px] bg-[color-mix(in_srgb,var(--background)_34%,transparent)] ring-1 ring-[var(--border)]/24 @min-[380px]:min-h-[1.8rem]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.17] [background-image:radial-gradient(circle,color-mix(in_srgb,var(--foreground)_44%,transparent)_0.75px,transparent_1px)] [background-size:4px_4px]" />
          <MapPin size="0.8125rem" className={cn("relative z-[1] shrink-0 drop-shadow-sm", getLocationPinColor(value))} />
        </div>
        <span
          className={cn(
            "line-clamp-2 min-w-0 max-w-full pr-3 whitespace-normal break-words text-left font-bold text-[var(--foreground)]/92 drop-shadow-sm",
            compactLocationText ? "text-[0.625rem] leading-[0.75rem]" : "text-[0.75rem] leading-4",
          )}
        >
          {locationText}
        </span>
      </WorldRenderedEdit>
    </WorldTileShell>
  );
}
