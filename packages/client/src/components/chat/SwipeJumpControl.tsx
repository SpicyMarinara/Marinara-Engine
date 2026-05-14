import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

interface SwipeJumpControlProps {
  messageId: string;
  activeSwipeIndex: number;
  swipeCount: number;
  onSetActiveSwipe: (index: number) => void;
  className?: string;
  buttonClassName?: string;
  inputClassName?: string;
  iconSize?: string;
}

export function SwipeJumpControl({
  messageId,
  activeSwipeIndex,
  swipeCount,
  onSetActiveSwipe,
  className,
  buttonClassName,
  inputClassName,
  iconSize = "0.75rem",
}: SwipeJumpControlProps) {
  const [inputValue, setInputValue] = useState(() => String(activeSwipeIndex + 1));

  useEffect(() => {
    setInputValue(String(activeSwipeIndex + 1));
  }, [activeSwipeIndex]);

  if (swipeCount <= 1) return null;

  const inputId = `swipe-jump-${messageId}`;

  const setSwipeByDisplayIndex = (displayIndex: number) => {
    const nextIndex = Math.min(Math.max(displayIndex, 1), swipeCount) - 1;
    setInputValue(String(nextIndex + 1));
    if (nextIndex !== activeSwipeIndex) {
      onSetActiveSwipe(nextIndex);
    }
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    const displayIndex = Number.parseInt(value, 10);
    if (Number.isNaN(displayIndex) || displayIndex < 1 || displayIndex > swipeCount) return;
    setSwipeByDisplayIndex(displayIndex);
  };

  return (
    <div className={cn("mari-message-swipes flex items-center gap-1.5", className)}>
      <button
        type="button"
        className={buttonClassName}
        onClick={(event) => {
          event.stopPropagation();
          setSwipeByDisplayIndex(activeSwipeIndex);
        }}
        disabled={activeSwipeIndex <= 0}
        aria-label="Previous swipe"
        title="Previous swipe"
      >
        <ChevronLeft size={iconSize} />
      </button>
      <label className="sr-only" htmlFor={inputId}>
        Jump to swipe
      </label>
      <input
        id={inputId}
        type="number"
        min={1}
        max={swipeCount}
        inputMode="numeric"
        value={inputValue}
        onChange={(event) => handleInputChange(event.target.value)}
        onBlur={() => setSwipeByDisplayIndex(Number.parseInt(inputValue, 10) || activeSwipeIndex + 1)}
        onClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          "h-[1.625rem] w-[3.25rem] rounded border border-[var(--border)] bg-[var(--background)]/70 px-1 text-center tabular-nums text-[0.75rem] outline-none transition-colors focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/40",
          inputClassName,
        )}
        aria-label={`Jump to swipe, 1 through ${swipeCount}`}
        title={`Jump to swipe 1-${swipeCount}`}
      />
      <span className="tabular-nums">/{swipeCount}</span>
      <button
        type="button"
        className={buttonClassName}
        onClick={(event) => {
          event.stopPropagation();
          setSwipeByDisplayIndex(activeSwipeIndex + 2);
        }}
        disabled={activeSwipeIndex >= swipeCount - 1}
        aria-label="Next swipe"
        title="Next swipe"
      >
        <ChevronRight size={iconSize} />
      </button>
    </div>
  );
}
