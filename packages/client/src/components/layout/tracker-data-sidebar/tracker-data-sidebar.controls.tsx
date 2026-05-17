import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import { TRACKER_TEXT_MICRO } from "./tracker-data-sidebar.constants";
import { getNumberValueWidth } from "./tracker-data-sidebar.helpers";

export function FittedText({
  children,
  className,
  title,
  minScale = 0.62,
  align = "left",
}: {
  children: string;
  className?: string;
  title?: string;
  minScale?: number;
  align?: "left" | "center" | "right";
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const updateScale = () => {
      const availableWidth = container.clientWidth;
      const naturalWidth = measure.scrollWidth;
      if (availableWidth <= 0 || naturalWidth <= 0) return;

      const nextScale = Math.min(1, Math.max(minScale, (availableWidth - 1) / naturalWidth));
      setScale((previous) => (Math.abs(previous - nextScale) < 0.01 ? previous : nextScale));
    };

    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(container);
    resizeObserver.observe(measure);
    return () => resizeObserver.disconnect();
  }, [children, minScale]);

  return (
    <span
      ref={containerRef}
      title={title ?? children}
      className={cn(
        "relative flex min-w-0 max-w-full overflow-hidden whitespace-nowrap",
        align === "center" && "justify-center text-center",
        align === "right" && "justify-end text-right",
        align === "left" && "justify-start text-left",
        className,
      )}
    >
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 block w-max max-w-none whitespace-nowrap"
      >
        {children}
      </span>
      <span
        className="block min-w-0 max-w-full overflow-hidden whitespace-nowrap"
        style={scale < 0.999 ? { fontSize: `calc(1em * ${scale.toFixed(3)})` } : undefined}
      >
        {children}
      </span>
    </span>
  );
}

export function InlineEdit({
  value,
  onSave,
  placeholder = "Empty",
  className,
  title,
  fullPreview = false,
  scrollOnHover = false,
  showEditHint = true,
  editHintMode = "inline",
  twoLinePreview = false,
  threeLinePreview = false,
  fitPreview = false,
  fitMinScale = 0.62,
  fitAlign = "left",
}: {
  value: string | number | null | undefined;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  title?: string;
  fullPreview?: boolean;
  scrollOnHover?: boolean;
  showEditHint?: boolean;
  editHintMode?: "inline" | "overlay";
  twoLinePreview?: boolean;
  threeLinePreview?: boolean;
  fitPreview?: boolean;
  fitMinScale?: number;
  fitAlign?: "left" | "center" | "right";
}) {
  const currentValue = value === null || value === undefined ? "" : String(value);
  const previewText = currentValue || placeholder;
  const useFittedPreview = fitPreview && !fullPreview && !twoLinePreview && !threeLinePreview;
  const useHoverScroll = scrollOnHover && !useFittedPreview;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [scrollActive, setScrollActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollFieldRef = useRef<HTMLSpanElement>(null);
  const scrollMeasureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editing) setDraft(currentValue);
  }, [currentValue, editing]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    setScrollActive((previous) => (previous ? false : previous));
  }, [currentValue, useHoverScroll]);

  const measureScrollOverflow = () => {
    if (!useHoverScroll || !currentValue) return;
    const field = scrollFieldRef.current;
    const measure = scrollMeasureRef.current;
    if (!field || !measure) return;

    const nextScrollActive = measure.scrollWidth > field.clientWidth + 1;
    setScrollActive((previous) => (previous === nextScrollActive ? previous : nextScrollActive));
  };
  const resetScrollOverflow = () => {
    setScrollActive((previous) => (previous ? false : previous));
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== currentValue) onSave(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(currentValue);
            setEditing(false);
          }
        }}
        onBlur={commit}
        className={cn(
          "min-w-0 rounded-sm border border-[var(--tracker-inline-rule,var(--border))] bg-[var(--background)]/50 px-1 py-0.5 text-xs text-[color:var(--tracker-inline-foreground,var(--foreground))] outline-none transition-colors focus:border-[var(--primary)]",
          className,
        )}
        placeholder={placeholder}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      onMouseEnter={measureScrollOverflow}
      onFocus={measureScrollOverflow}
      onMouseLeave={resetScrollOverflow}
      onBlur={resetScrollOverflow}
      title={title ?? currentValue}
      className={cn(
        "group group/inline relative flex min-w-0 rounded px-0.5 text-left transition-colors hover:bg-[var(--accent)]/55",
        editHintMode === "inline" && "gap-1",
        twoLinePreview || threeLinePreview ? "items-start overflow-hidden" : "items-center",
        className,
      )}
    >
      {useHoverScroll && currentValue ? (
        <span
          ref={scrollMeasureRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 block h-0 w-max max-w-none overflow-hidden whitespace-nowrap opacity-0"
        >
          {currentValue}
        </span>
      ) : null}
      {useFittedPreview ? (
        <FittedText
          minScale={fitMinScale}
          align={fitAlign}
          className={cn(
            "flex-1",
            currentValue
              ? "text-[color:var(--tracker-inline-foreground,var(--foreground))]"
              : "italic text-[color:var(--tracker-inline-muted,var(--muted-foreground))]",
          )}
        >
          {previewText}
        </FittedText>
      ) : (
        <span
          ref={useHoverScroll ? scrollFieldRef : undefined}
          className={cn(
            "min-w-0",
            useHoverScroll
              ? cn("block overflow-hidden whitespace-nowrap", scrollActive ? "roleplay-hud-scroll-field" : "truncate")
              : threeLinePreview
                ? "line-clamp-3 flex-1 whitespace-normal break-words leading-[1.15]"
                : twoLinePreview
                  ? "line-clamp-2 flex-1 whitespace-normal break-words leading-[1.15]"
                  : fullPreview
                    ? "whitespace-nowrap leading-tight"
                    : "truncate",
            currentValue
              ? "text-[color:var(--tracker-inline-foreground,var(--foreground))]"
              : "italic text-[color:var(--tracker-inline-muted,var(--muted-foreground))]",
          )}
        >
          {useHoverScroll && currentValue && scrollActive ? (
            <span className="roleplay-hud-scroll-track">
              <span className="pr-6">{currentValue}</span>
              <span className="pr-6" aria-hidden>
                {currentValue}
              </span>
            </span>
          ) : (
            previewText
          )}
        </span>
      )}
      <Pencil
        size="0.5625rem"
        className={cn(
          "shrink-0 text-[color:var(--tracker-inline-muted,var(--muted-foreground))] opacity-0 transition-opacity group-hover/inline:opacity-60",
          (!showEditHint || fullPreview) && "hidden",
          (useHoverScroll || editHintMode === "overlay") &&
            "pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2",
        )}
      />
    </button>
  );
}

export function InlineNumber({
  value,
  onChange,
  className,
  min,
  title,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  min?: number;
  title?: string;
}) {
  const width = getNumberValueWidth(value);

  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => {
        const numeric = Number(event.target.value);
        const next = Number.isFinite(numeric) ? numeric : 0;
        onChange(min === undefined ? next : Math.max(min, next));
      }}
      title={title}
      style={{ width }}
      className={cn(
        "rounded bg-transparent px-1 py-0.5 text-right text-[0.625rem] tabular-nums text-[color:var(--tracker-inline-number,var(--tracker-inline-foreground,var(--foreground)))] outline-none transition-colors hover:bg-[var(--accent)]/45 focus:bg-[var(--background)] focus:ring-1 focus:ring-[var(--primary)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className,
      )}
    />
  );
}

export function AddRowButton({
  children,
  onClick,
  title,
  className,
}: {
  children?: ReactNode;
  onClick: () => void;
  title?: string;
  className?: string;
}) {
  const label = title ?? (typeof children === "string" ? `Add ${children}` : "Add row");
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex items-center justify-center rounded-sm bg-[var(--primary)]/8 text-[0.625rem] font-medium text-[var(--primary)] ring-1 ring-[var(--primary)]/16 transition-colors hover:bg-[var(--primary)]/14 hover:ring-[var(--primary)]/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-95",
        children ? "min-h-5 gap-1 px-1 py-0.5" : "h-4 w-4 p-0",
        className,
      )}
    >
      <Plus size={children ? "0.625rem" : "0.6875rem"} />
      {children}
    </button>
  );
}

export function SectionIconButton({
  children,
  onClick,
  title,
  disabled,
  pressed,
  tone = "utility",
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  pressed?: boolean;
  tone?: "utility" | "feature";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
        tone === "feature"
          ? pressed
            ? "bg-[var(--primary)]/10 text-[var(--primary)] ring-1 ring-[var(--primary)]/18 hover:bg-[var(--primary)]/14"
            : "text-[var(--muted-foreground)]/45 hover:bg-[var(--secondary)]/65 hover:text-[var(--primary)]/86"
          : "text-[var(--muted-foreground)]/62 hover:bg-[var(--secondary)]/65 hover:text-[var(--primary)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InlineAddRow({
  onClick,
  title,
  label,
  className,
}: {
  onClick: () => void;
  title: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex min-h-5 w-full items-center gap-1 border-t border-[var(--border)]/30 px-1 py-0.5 text-left font-semibold text-[var(--foreground)]/42 transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)]",
        TRACKER_TEXT_MICRO,
        className,
      )}
    >
      <Plus size="0.625rem" className="shrink-0" />
      <span className="truncate">{label ?? title}</span>
    </button>
  );
}

export function SectionHeader({
  icon,
  title,
  badge,
  badgeTitle,
  action,
  addAction,
  className,
  collapsed = false,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  badgeTitle?: string;
  action?: ReactNode;
  addAction?: ReactNode;
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const collapsible = !!onToggle;
  const toggleTitle = `${collapsed ? "Expand" : "Collapse"} ${title}`;
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onToggle || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? !collapsed : undefined}
      title={collapsible ? toggleTitle : undefined}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex min-h-5 items-center gap-1 border-b border-[var(--border)]/42 px-1 py-0.5",
        collapsible &&
          "cursor-pointer select-none transition-colors hover:bg-[var(--accent)]/18 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/50",
        className,
      )}
    >
      {collapsible && (
        <span className="flex h-3.5 w-3 shrink-0 items-center justify-center" aria-hidden="true">
          <ChevronDown
            size="0.6875rem"
            className={cn(
              "text-[color:var(--tracker-profile-display-solid,var(--primary))] opacity-60 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
              collapsed && "-rotate-90",
            )}
          />
        </span>
      )}
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[color:var(--tracker-profile-display-solid,var(--primary))] opacity-75"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-semibold uppercase tracking-[0.08em] text-[var(--foreground)]/62",
          TRACKER_TEXT_MICRO,
        )}
      >
        {title}
      </span>
      {(badge !== undefined && badge !== null) || action || addAction ? (
        <div className="ml-0.5 flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          {badge !== undefined && badge !== null && (
            <span
              className="shrink-0 rounded-sm border border-[var(--border)]/26 bg-[var(--background)]/16 px-1 py-0.5 text-[0.5625rem] font-semibold uppercase leading-none tabular-nums text-[var(--foreground)]/62"
              title={badgeTitle}
            >
              {badge}
            </span>
          )}
          {action}
          {addAction}
        </div>
      ) : null}
    </div>
  );
}

export function TrackerReadabilityVeil({ strength = "soft" }: { strength?: "soft" | "strong" }) {
  const background =
    strength === "strong"
      ? "linear-gradient(180deg,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-strong-top,40%),transparent) 0%,color-mix(in srgb,var(--card) var(--tracker-profile-contrast-strong-mid,30%),transparent) 52%,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-strong-bottom,42%),transparent) 100%)"
      : "linear-gradient(180deg,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-soft-top,30%),transparent) 0%,color-mix(in srgb,var(--card) var(--tracker-profile-contrast-soft-mid,22%),transparent) 58%,color-mix(in srgb,var(--background) var(--tracker-profile-contrast-soft-bottom,32%),transparent) 100%)";

  return <div className="pointer-events-none absolute inset-0 z-0" style={{ background }} />;
}

export function TrackerProfileDisplayWash({ className }: { className?: string }) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0", className ?? "opacity-[0.12]")}
      style={{
        backgroundImage: "var(--tracker-profile-display-layer)",
        opacity: "var(--tracker-profile-display-opacity)",
      }}
    />
  );
}

export function TrackerProfileEdgeHighlight({
  className,
  strength = "soft",
  showBottom = true,
}: {
  className?: string;
  strength?: "soft" | "strong";
  showBottom?: boolean;
}) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", className)}>
      <div
        className={cn(
          "absolute inset-0 rounded-[inherit] ring-1 ring-inset shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent),0_0_10px_var(--tracker-profile-dialogue-glow)]",
          strength === "strong"
            ? "ring-[var(--tracker-profile-rule)]"
            : "ring-[color-mix(in_srgb,var(--tracker-profile-rule)_72%,transparent)]",
        )}
      />
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-px bg-[image:var(--tracker-profile-accent-layer)]",
          strength === "strong" ? "opacity-80" : "opacity-55",
        )}
      />
      {showBottom && (
        <div className="absolute inset-x-0 bottom-0 h-px bg-[image:var(--tracker-profile-accent-layer)] opacity-35" />
      )}
    </div>
  );
}

export function TrackerPortraitStageBackdrop({ media, className }: { media?: string | null; className?: string }) {
  const boxLayerStyle = {
    backgroundImage: "var(--tracker-profile-box-layer)",
    opacity: "var(--tracker-profile-tint-opacity, 0.12)",
  } as CSSProperties;
  const mediaEchoStyle = {
    filter:
      "blur(var(--tracker-profile-portrait-media-blur, 1.25rem)) saturate(var(--tracker-profile-portrait-media-saturate, 1.18))",
    maskImage: "radial-gradient(ellipse at 50% 48%, black 0%, black 56%, transparent 82%)",
    opacity: "var(--tracker-profile-portrait-media-opacity, 0.18)",
    WebkitMaskImage: "radial-gradient(ellipse at 50% 48%, black 0%, black 56%, transparent 82%)",
  } as CSSProperties;
  const sideMaskStyle = {
    maskImage: "linear-gradient(180deg, black 0%, black 62%, transparent 100%)",
    opacity: "var(--tracker-profile-portrait-side-mask-opacity, 1)",
    WebkitMaskImage: "linear-gradient(180deg, black 0%, black 62%, transparent 100%)",
  } as CSSProperties;
  const lightStyle = {
    backgroundImage: "var(--tracker-profile-portrait-light)",
    opacity: "var(--tracker-profile-portrait-light-opacity, 0.7)",
  } as CSSProperties;
  const rimStyle = {
    backgroundImage: "var(--tracker-profile-portrait-rim)",
    opacity: "var(--tracker-profile-portrait-rim-opacity, 0.52)",
  } as CSSProperties;
  const bottomGlowStyle = {
    opacity: "var(--tracker-profile-portrait-bottom-glow-opacity, 0.75)",
  } as CSSProperties;
  const bottomRuleStyle = {
    opacity: "var(--tracker-profile-portrait-bottom-rule-opacity, 0.75)",
  } as CSSProperties;

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]", className)}>
      <div className="absolute inset-0 bg-[image:var(--tracker-profile-portrait-base)]" />
      <div className="absolute inset-0" style={boxLayerStyle} />
      {media ? (
        <img
          src={media}
          alt=""
          aria-hidden="true"
          className="absolute inset-[-10%] h-[120%] w-[120%] object-cover object-center"
          style={mediaEchoStyle}
          draggable={false}
        />
      ) : null}
      <div className="absolute inset-0" style={lightStyle} />
      <div className="absolute inset-0 bg-[image:var(--tracker-profile-portrait-veil)]" />
      <div
        className="absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_60%,transparent),transparent)]"
        style={sideMaskStyle}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(270deg,color-mix(in_srgb,var(--background)_60%,transparent),transparent)]"
        style={sideMaskStyle}
      />
      <div
        className="absolute inset-x-2 bottom-0 h-1/2 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--tracker-profile-dialogue)_16%,transparent),transparent_72%)]"
        style={bottomGlowStyle}
      />
      <div className="absolute inset-0" style={rimStyle} />
      <div
        className="absolute inset-x-3 bottom-2 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue)_48%,transparent),transparent)]"
        style={bottomRuleStyle}
      />
    </div>
  );
}

export function EmptySection({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-[var(--tracker-inline-rule,var(--border))] px-1 py-1 text-center text-[0.6875rem] text-[color:var(--tracker-inline-muted,var(--muted-foreground))]">
      {children}
    </div>
  );
}
