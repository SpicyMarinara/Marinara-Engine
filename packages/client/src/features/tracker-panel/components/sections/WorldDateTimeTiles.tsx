import { Clock } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { getWorldDateDisplay, getWorldTimeDisplay, type WorldDateDisplay } from "../../lib/world-state-display";
import { WorldRenderedEdit, WorldTileShell } from "./WorldEditableTile";

export function WorldDateTile({
  value,
  display = getWorldDateDisplay(value),
  onSave,
}: {
  value: string | null | undefined;
  display?: WorldDateDisplay;
  onSave?: (value: string) => void;
}) {
  const isFreeformDate = display.kind === "freeform";

  return (
    <WorldTileShell label="Date">
      <WorldRenderedEdit
        label="Date"
        value={display.raw || value}
        onSave={onSave}
        placeholder="Set date"
        className={cn(
          "overflow-hidden text-center",
          isFreeformDate
            ? "flex flex-col items-center justify-center px-0.5 py-1"
            : "grid grid-rows-[0.95rem_minmax(0,1fr)]",
        )}
        inputClassName="text-center"
        showEditHint={false}
      >
        {isFreeformDate ? (
          <>
            <span className="mb-0.5 max-w-full truncate text-[0.4375rem] font-bold uppercase leading-none text-[var(--primary)]/82">
              Date
            </span>
            <span className="line-clamp-2 max-w-full break-words text-[0.5625rem] font-black leading-[0.625rem] text-[var(--foreground)] [overflow-wrap:anywhere]">
              {display.main}
            </span>
            {display.detail && (
              <span className="mt-0.5 line-clamp-1 max-w-full break-words text-[0.4375rem] font-semibold leading-[0.55rem] text-[var(--muted-foreground)]/78 [overflow-wrap:anywhere]">
                {display.detail}
              </span>
            )}
          </>
        ) : (
          <>
            <div className="bg-[var(--primary)]/24 text-[0.5rem] font-bold leading-[0.95rem] text-[var(--primary)]">
              {display.month}
            </div>
            <div className="flex min-h-0 flex-col items-center justify-center bg-[var(--background)]/22 text-[var(--foreground)]">
              <span className="text-base font-black leading-none">{display.day}</span>
              {display.year && (
                <span className="mt-0.5 text-[0.5rem] font-semibold leading-none text-[var(--muted-foreground)]/70">
                  {display.year}
                </span>
              )}
            </div>
          </>
        )}
      </WorldRenderedEdit>
    </WorldTileShell>
  );
}

function WorldClockFace({ hour, minute }: { hour: number | null; minute: number | null }) {
  const hasTime = hour !== null && minute !== null;
  const minuteRotation = hasTime ? minute * 6 : 0;
  const hourRotation = hasTime ? (hour % 12) * 30 + minute * 0.5 : -45;

  return (
    <div className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)]/45 bg-[radial-gradient(circle_at_50%_48%,color-mix(in_srgb,var(--background)_58%,transparent)_0%,color-mix(in_srgb,var(--background)_84%,transparent)_68%,color-mix(in_srgb,var(--foreground)_8%,transparent)_100%)] text-sky-300 shadow-[inset_0_-2px_5px_rgba(0,0,0,0.28),0_0_10px_color-mix(in_srgb,var(--primary)_10%,transparent)]">
      {hasTime ? (
        <>
          <span className="absolute h-1 w-1 rounded-full bg-sky-300 shadow-[0_0_5px_color-mix(in_srgb,var(--primary)_42%,transparent)]" />
          <span
            className="absolute left-1/2 top-1/2 h-[0.5625rem] w-[2px] origin-bottom rounded-full bg-sky-300"
            style={{ transform: `translate(-50%, -100%) rotate(${hourRotation}deg)` }}
          />
          <span
            className="absolute left-1/2 top-1/2 h-[0.78rem] w-[1px] origin-bottom rounded-full bg-[var(--primary)]"
            style={{ transform: `translate(-50%, -100%) rotate(${minuteRotation}deg)` }}
          />
        </>
      ) : (
        <Clock size="0.875rem" />
      )}
    </div>
  );
}

export function WorldTimeTile({
  value,
  onSave,
}: {
  value: string | null | undefined;
  onSave?: (value: string) => void;
}) {
  const display = getWorldTimeDisplay(value);
  return (
    <WorldTileShell label="Time">
      <WorldRenderedEdit
        label="Time"
        value={display.raw || value}
        onSave={onSave}
        placeholder="Set time"
        className="grid grid-rows-[minmax(0,1fr)_0.625rem] px-1 pb-0.5 pt-0.5 text-center"
        inputClassName="text-center"
        showEditHint={false}
      >
        <div className="flex min-h-0 items-center justify-center overflow-visible">
          <WorldClockFace hour={display.hour} minute={display.minute} />
        </div>
        <div className="flex min-w-0 max-w-full translate-y-px items-baseline justify-center gap-0.5">
          <span className="truncate text-[0.5625rem] font-black leading-[0.625rem] text-[var(--foreground)]">
            {display.main}
          </span>
          {display.suffix && (
            <span className="shrink-0 text-[0.4375rem] font-bold leading-none text-[var(--muted-foreground)]">
              {display.suffix}
            </span>
          )}
        </div>
      </WorldRenderedEdit>
    </WorldTileShell>
  );
}
