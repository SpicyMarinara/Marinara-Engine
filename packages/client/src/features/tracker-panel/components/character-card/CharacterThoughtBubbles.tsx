import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion, type MotionProps, type Transition } from "framer-motion";
import type { TrackerPanelSide } from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";
import { InlineEdit } from "../controls/InlineControls";

type ThoughtBubbleSize = "short" | "medium" | "long";

type ThoughtTextFit = {
  fontSize: string;
  lineHeight: number;
  previewLineCount: 2 | 3 | 4 | "full";
  editMinHeightClassName: string;
  previewClassName?: string;
};
type ThoughtBubbleMotionProps = Pick<MotionProps, "initial" | "animate" | "transition">;

const THOUGHT_BUBBLE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const INLINE_THOUGHT_BUBBLE_TRANSITION: Transition = { duration: 0.2, ease: THOUGHT_BUBBLE_EASE };
const FLOATING_THOUGHT_BUBBLE_TRANSITION: Transition = { duration: 0.24, ease: THOUGHT_BUBBLE_EASE };

function getInlineThoughtBubbleMotion({
  tailOnLeft,
  featured,
  reducedMotion,
}: {
  tailOnLeft: boolean;
  featured: boolean;
  reducedMotion: boolean | null;
}): ThoughtBubbleMotionProps {
  if (reducedMotion) {
    return {
      initial: false,
      animate: { opacity: 1 },
      transition: { duration: 0 },
    };
  }

  return {
    initial: {
      opacity: 0,
      x: featured ? 0 : tailOnLeft ? -8 : 8,
      y: featured ? -5 : 3,
      scale: featured ? 0.985 : 0.97,
      filter: "blur(2px)",
    },
    animate: { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" },
    transition: INLINE_THOUGHT_BUBBLE_TRANSITION,
  };
}

function getFloatingThoughtBubbleMotion({
  outsideSide,
  reducedMotion,
}: {
  outsideSide: "left" | "right";
  reducedMotion: boolean | null;
}): ThoughtBubbleMotionProps {
  if (reducedMotion) {
    return {
      initial: false,
      animate: { opacity: 1 },
      transition: { duration: 0 },
    };
  }

  return {
    initial: {
      opacity: 0,
      x: outsideSide === "left" ? 10 : -10,
      y: -4,
      scale: 0.96,
      filter: "blur(2px)",
    },
    animate: { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" },
    transition: FLOATING_THOUGHT_BUBBLE_TRANSITION,
  };
}

function getThoughtPreviewClampClass(previewLineCount: ThoughtTextFit["previewLineCount"]) {
  if (previewLineCount === 4) return "line-clamp-4";
  if (previewLineCount === 3) return "line-clamp-3";
  if (previewLineCount === 2) return "line-clamp-2";
  return undefined;
}

function getThoughtBubbleSize(text: string): ThoughtBubbleSize {
  if (text.length <= 38) return "short";
  if (text.length <= 84) return "medium";
  return "long";
}

function getThoughtTextFit(text: string, bubbleSize: ThoughtBubbleSize): ThoughtTextFit {
  const length = text.length;

  if (bubbleSize === "short") {
    return {
      fontSize: "clamp(0.75rem, calc(0.59rem + 2.35cqw), 0.875rem)",
      lineHeight: 1.12,
      previewLineCount: "full",
      editMinHeightClassName: "min-h-6",
      previewClassName: "text-center",
    };
  }

  if (bubbleSize === "medium") {
    return {
      fontSize:
        length <= 62
          ? "clamp(0.71875rem, calc(0.55rem + 1.55cqw), 0.84375rem)"
          : "clamp(0.6875rem, calc(0.54rem + 1.25cqw), 0.78125rem)",
      lineHeight: 1.12,
      previewLineCount: "full",
      editMinHeightClassName: length <= 58 ? "min-h-8" : "min-h-[3.5rem]",
    };
  }

  if (length <= 180) {
    return {
      fontSize: "clamp(0.71875rem, calc(0.58rem + 2cqw), 0.8125rem)",
      lineHeight: 1.08,
      previewLineCount: "full",
      editMinHeightClassName: "min-h-[3.75rem]",
    };
  }

  return {
    fontSize: "clamp(0.65625rem, calc(0.54rem + 1.15cqw), 0.75rem)",
    lineHeight: 1.1,
    previewLineCount: "full",
    editMinHeightClassName: "min-h-[3.75rem]",
  };
}

function ThoughtBubble({
  value,
  onSave,
  tailSide = "left",
}: {
  value: string | null | undefined;
  onSave?: (value: string) => void;
  tailSide?: "left" | "right";
}) {
  const tailOnLeft = tailSide === "left";
  const thoughtText = visibleText(value, "Thoughts").replace(/\s+/g, " ");
  const thoughtBubbleSize = getThoughtBubbleSize(thoughtText);
  const thoughtTextFit = getThoughtTextFit(thoughtText, thoughtBubbleSize);
  const thoughtTextStyle: CSSProperties = {
    fontSize: thoughtTextFit.fontSize,
    lineHeight: thoughtTextFit.lineHeight,
  };
  const thoughtBubbleStyle: CSSProperties | undefined =
    thoughtBubbleSize === "long" ? { maxHeight: "min(22rem, calc(100vh - 1rem))" } : undefined;
  const compactThoughtBubble = thoughtBubbleSize !== "long";
  const thoughtDots = tailOnLeft
    ? ["h-1.5 w-1.5 opacity-55", "h-2 w-2 opacity-70", "h-2.5 w-2.5 opacity-85"]
    : ["h-2.5 w-2.5 opacity-85", "h-2 w-2 opacity-70", "h-1.5 w-1.5 opacity-55"];

  return (
    <div className={cn("relative flex max-w-full", tailOnLeft ? "justify-start pl-3.5" : "justify-end pr-3.5")}>
      <div
        className={cn(
          "pointer-events-none absolute top-2.5 flex items-center gap-1",
          tailOnLeft ? "left-0 -translate-x-[calc(100%-0.125rem)]" : "right-0 translate-x-[calc(100%-0.125rem)]",
        )}
      >
        {thoughtDots.map((sizeClass, index) => (
          <span
            key={sizeClass}
            className={cn(
              "animate-pulse rounded-full bg-[color-mix(in_srgb,var(--card)_82%,var(--background)_18%)] ring-1 ring-[var(--primary)]/28 shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_18%,transparent)] backdrop-blur-md",
              sizeClass,
            )}
            style={{ animationDelay: `${index * 140}ms` }}
          />
        ))}
      </div>
      <span
        className={cn(
          "pointer-events-none absolute top-[0.8125rem] z-[1] h-4 w-4 rounded-full bg-[color-mix(in_srgb,var(--card)_82%,var(--background)_18%)] ring-1 ring-[var(--primary)]/28 shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_18%,transparent)] backdrop-blur-xl",
          tailOnLeft ? "left-[0.4375rem]" : "right-[0.4375rem]",
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute top-[0.875rem] z-[1] h-3.5 w-3.5 rounded-full bg-[color-mix(in_srgb,var(--card)_82%,var(--background)_18%)] backdrop-blur-xl",
          tailOnLeft ? "left-2" : "right-2",
        )}
      />
      <div
        className={cn(
          "relative z-[2] overflow-hidden border border-[var(--primary)]/24 bg-[color-mix(in_srgb,var(--card)_86%,var(--background)_14%)] text-[var(--foreground)] shadow-[0_0_16px_color-mix(in_srgb,var(--primary)_14%,transparent),0_8px_18px_rgba(0,0,0,0.22)] backdrop-blur-xl [container-type:inline-size]",
          thoughtBubbleSize === "short" &&
            "inline-flex min-h-10 w-fit min-w-[4.5rem] max-w-[9.5rem] rounded-full px-4 py-2",
          thoughtBubbleSize === "medium" &&
            "inline-flex min-h-11 w-fit min-w-[8.5rem] max-w-[14.75rem] rounded-[1.25rem] px-4 py-2.5",
          thoughtBubbleSize === "long" && "min-h-14 w-full overflow-y-auto rounded-[1.25rem] px-4 py-3",
        )}
        style={thoughtBubbleStyle}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_46%,color-mix(in_srgb,var(--accent)_12%,transparent))]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--foreground)]/12" />
        <div
          className={cn(
            "relative z-[1]",
            compactThoughtBubble && "flex min-h-6 w-fit max-w-full items-center justify-center",
          )}
        >
          {onSave ? (
            <InlineEdit
              value={value ?? ""}
              onSave={onSave}
              placeholder="Thoughts"
              className={cn(
                "px-0 py-0 font-medium italic [--foreground:color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)] [--muted-foreground:color-mix(in_srgb,var(--muted-foreground)_82%,var(--foreground)_18%)] hover:bg-[var(--primary)]/12",
                compactThoughtBubble && "w-fit max-w-full",
                thoughtBubbleSize === "short" && "min-h-6 min-w-0 text-center",
                thoughtBubbleSize === "medium" && "min-w-0",
                thoughtBubbleSize === "long" && "min-w-0",
                thoughtTextFit.editMinHeightClassName,
              )}
              style={thoughtTextStyle}
              showEditHint={false}
              previewLineCount={thoughtTextFit.previewLineCount}
              previewClassName={thoughtTextFit.previewClassName}
              previewStyle={thoughtTextStyle}
            />
          ) : (
            <p
              className={cn(
                "break-words font-medium italic text-[color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)]",
                compactThoughtBubble && "w-fit max-w-full",
                thoughtTextFit.previewClassName,
              )}
              style={thoughtTextStyle}
            >
              {thoughtText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function InlineThoughtBubble({
  value,
  onSave,
  bubbleRef,
  className,
  surfaceClassName,
  tailSide = "right",
  variant = "default",
}: {
  value: string | null | undefined;
  onSave?: (value: string) => void;
  bubbleRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  surfaceClassName?: string;
  tailSide?: "left" | "right";
  variant?: "default" | "featured";
}) {
  const tailOnLeft = tailSide === "left";
  const thoughtText = visibleText(value, "Thoughts").replace(/\s+/g, " ");
  const thoughtTextFit = getThoughtTextFit(thoughtText, getThoughtBubbleSize(thoughtText));
  const isFeaturedVariant = variant === "featured";
  const reducedMotion = useReducedMotion();
  const previewLineCount = isFeaturedVariant ? (thoughtText.length <= 70 ? 2 : 3) : thoughtTextFit.previewLineCount;
  const thoughtTextStyle: CSSProperties = {
    fontSize: isFeaturedVariant
      ? "clamp(0.65625rem, calc(0.56rem + 0.85cqw), 0.75rem)"
      : thoughtTextFit.fontSize,
    lineHeight: isFeaturedVariant ? 1.12 : thoughtTextFit.lineHeight,
  };
  const editMinHeightClassName = isFeaturedVariant
    ? previewLineCount === 2
      ? "min-h-[1.9rem]"
      : "min-h-[2.5rem]"
    : thoughtTextFit.editMinHeightClassName;

  return (
    <motion.div
      ref={bubbleRef}
      data-component="InlineThoughtBubble"
      {...getInlineThoughtBubbleMotion({ tailOnLeft, featured: isFeaturedVariant, reducedMotion })}
      className={cn(
        "relative mx-1 mt-1 min-w-0 text-[var(--foreground)] will-change-transform [container-type:inline-size]",
        isFeaturedVariant
          ? "px-0"
          : tailOnLeft
            ? "pl-3.5 pr-0.5"
            : "pl-0.5 pr-3.5",
        className,
      )}
    >
      {!isFeaturedVariant && (
        <>
          <span
            className={cn(
              "pointer-events-none absolute z-0 rounded-full border border-[var(--primary)]/28 bg-[color-mix(in_srgb,var(--card)_72%,var(--primary)_28%)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_10%,transparent)]",
              "top-3.5 h-2.5 w-2.5",
              tailOnLeft ? "left-1.5" : "right-1.5",
            )}
          />
          <span
            className={cn(
              "pointer-events-none absolute top-[1.8rem] z-0 h-1.5 w-1.5 rounded-full border border-[var(--primary)]/24 bg-[color-mix(in_srgb,var(--card)_74%,var(--primary)_26%)]",
              tailOnLeft ? "left-0.5" : "right-0.5",
            )}
          />
        </>
      )}
      <div
        className={cn(
          "relative z-[1] min-w-0 overflow-hidden border",
          isFeaturedVariant
            ? "max-h-[3.25rem] rounded-[1.05rem] border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_24%,transparent)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--tracker-profile-surface-solid)_78%,var(--tracker-profile-display-solid)_12%)_0%,color-mix(in_srgb,var(--tracker-profile-surface-solid)_72%,var(--tracker-profile-accent-solid)_10%)_54%,color-mix(in_srgb,var(--background)_34%,var(--tracker-profile-surface-solid)_66%)_100%)] px-2.5 py-1 text-[color:var(--tracker-profile-text)] shadow-[0_3px_8px_color-mix(in_srgb,var(--background)_22%,transparent),0_0_6px_color-mix(in_srgb,var(--tracker-profile-accent-solid)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)]"
            : "rounded-[1.2rem] border-[var(--primary)]/22 bg-[color-mix(in_srgb,var(--card)_84%,var(--background)_16%)] px-2.5 py-1.5 shadow-[0_6px_12px_rgba(0,0,0,0.18),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_7%,transparent)] backdrop-blur-xl",
          surfaceClassName,
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit]",
            isFeaturedVariant
              ? "bg-[radial-gradient(circle_at_30%_18%,color-mix(in_srgb,var(--foreground)_7%,transparent),transparent_34%),radial-gradient(circle_at_88%_92%,color-mix(in_srgb,var(--tracker-profile-accent-solid)_9%,transparent),transparent_46%),linear-gradient(180deg,transparent_52%,color-mix(in_srgb,var(--background)_18%,transparent)_100%)]"
              : "bg-[radial-gradient(circle_at_28%_18%,color-mix(in_srgb,var(--foreground)_8%,transparent),transparent_38%),linear-gradient(135deg,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_52%,color-mix(in_srgb,var(--accent)_8%,transparent))]",
          )}
        />
        <div className="relative z-[1] min-w-0">
          {onSave ? (
            <InlineEdit
              value={value ?? ""}
              onSave={onSave}
              placeholder="Thoughts"
              className={cn(
                "w-full px-0 py-0 font-medium italic [--foreground:color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)] [--muted-foreground:color-mix(in_srgb,var(--muted-foreground)_82%,var(--foreground)_18%)] hover:bg-[var(--primary)]/12",
                isFeaturedVariant &&
                  "[--foreground:color-mix(in_srgb,var(--tracker-profile-text)_94%,var(--tracker-profile-accent-solid)_6%)] [--muted-foreground:color-mix(in_srgb,var(--tracker-profile-muted-text)_84%,var(--tracker-profile-text)_16%)] hover:bg-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_10%,transparent)]",
                editMinHeightClassName,
              )}
              style={thoughtTextStyle}
              showEditHint={false}
              previewLineCount={previewLineCount}
              previewClassName={thoughtTextFit.previewClassName}
              previewStyle={thoughtTextStyle}
            />
          ) : (
            <p
              className={cn(
                "break-words font-medium italic text-[color-mix(in_srgb,var(--foreground)_94%,var(--primary)_6%)]",
                isFeaturedVariant && "text-[color:var(--tracker-profile-text)]",
                getThoughtPreviewClampClass(previewLineCount),
                thoughtTextFit.previewClassName,
              )}
              style={thoughtTextStyle}
            >
              {thoughtText}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function ExternalThoughtBubble({
  anchorRef,
  value,
  onSave,
  panelSide,
  bubbleRef,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  value: string | null | undefined;
  onSave?: (value: string) => void;
  panelSide: TrackerPanelSide;
  bubbleRef?: RefObject<HTMLDivElement | null>;
}) {
  const reducedMotion = useReducedMotion();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    outsideSide: "left" | "right";
  } | null>(null);

  useLayoutEffect(() => {
    if (!value && !onSave) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setPosition((current) => (current === null ? current : null));
        return;
      }
      const rect = anchor.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setPosition((current) => (current === null ? current : null));
        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const outsideSide = panelSide === "left" ? "right" : "left";
      const overlap = 4;
      const viewportMargin = 6;
      const thoughtText = visibleText(value, "Thoughts").replace(/\s+/g, " ");
      const preferredWidth =
        thoughtText.length <= 38
          ? Math.min(220, Math.max(184, rect.width * 0.72))
          : thoughtText.length <= 84
            ? 272
            : thoughtText.length <= 180
              ? 360
              : 420;
      const outsideLaneWidth =
        outsideSide === "left"
          ? rect.left + overlap - viewportMargin
          : viewportWidth - rect.right + overlap - viewportMargin;
      const width = Math.round(
        Math.min(
          preferredWidth,
          viewportWidth - viewportMargin * 2,
          outsideLaneWidth >= 172 ? outsideLaneWidth : preferredWidth,
        ),
      );
      const desiredLeft = outsideSide === "left" ? rect.left - width + overlap : rect.right - overlap;
      const desiredTop = rect.top + Math.min(48, Math.max(28, rect.height * 0.18));
      const maxLeft = Math.max(viewportMargin, viewportWidth - width - viewportMargin);
      const maxTop = Math.max(viewportMargin, viewportHeight - 88);
      const left = Math.round(Math.max(viewportMargin, Math.min(maxLeft, desiredLeft)));
      const top = Math.round(Math.max(viewportMargin, Math.min(maxTop, desiredTop)));
      setPosition((current) =>
        current?.left === left && current.top === top && current.width === width && current.outsideSide === outsideSide
          ? current
          : { left, top, width, outsideSide },
      );
    };

    updatePosition();
    const anchor = anchorRef.current;
    const resizeObserver =
      anchor && typeof ResizeObserver !== "undefined" ? new ResizeObserver(updatePosition) : null;
    if (anchor) resizeObserver?.observe(anchor);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, onSave, panelSide, value]);

  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      ref={bubbleRef}
      data-component="ExternalThoughtBubble"
      {...getFloatingThoughtBubbleMotion({ outsideSide: position.outsideSide, reducedMotion })}
      className="pointer-events-auto fixed z-[60] drop-shadow-[0_8px_14px_rgba(0,0,0,0.24)] will-change-transform"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        transformOrigin: position.outsideSide === "left" ? "right 1.5rem" : "left 1.5rem",
      }}
    >
      <ThoughtBubble value={value} onSave={onSave} tailSide={position.outsideSide === "left" ? "right" : "left"} />
    </motion.div>,
    document.body,
  );
}
