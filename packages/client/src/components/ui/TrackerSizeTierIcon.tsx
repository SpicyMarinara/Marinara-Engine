import type { TrackerPanelSizeProfile } from "../../stores/ui.store";
import { cn } from "../../lib/utils";

const TRACKER_PANEL_SIZE_RING_COUNTS: Record<TrackerPanelSizeProfile, number> = {
  compact: 1,
  standard: 2,
  expanded: 3,
};

const TRACKER_SIZE_TIER_RINGS = [
  { className: "inset-[0.4375rem]", tier: 1 },
  { className: "inset-[0.25rem]", tier: 2 },
  { className: "inset-[0.0625rem]", tier: 3 },
];

export function TrackerSizeTierIcon({ sizeProfile }: { sizeProfile: TrackerPanelSizeProfile }) {
  const activeRingCount = TRACKER_PANEL_SIZE_RING_COUNTS[sizeProfile];

  return (
    <span aria-hidden="true" className="relative block h-[0.875rem] w-[0.875rem]">
      {TRACKER_SIZE_TIER_RINGS.map((ring) => {
        const isActive = ring.tier <= activeRingCount;
        return (
          <span
            key={ring.tier}
            className={cn(
              "absolute rounded-full border transition-[border-color,box-shadow,opacity] duration-150",
              ring.className,
              isActive
                ? "border-[var(--primary)] opacity-100 shadow-[0_0_5px_color-mix(in_srgb,var(--primary)_34%,transparent)]"
                : "border-current opacity-28",
            )}
          />
        );
      })}
    </span>
  );
}
