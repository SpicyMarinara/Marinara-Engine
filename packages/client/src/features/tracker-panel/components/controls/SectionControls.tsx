import { type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { TRACKER_TEXT_MICRO } from "../../lib/tracker-panel.constants";

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
        children ? "min-h-6 gap-1 px-1.5 py-0.5" : "h-6 min-h-6 w-6 min-w-6 p-0",
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
        "flex h-6 min-h-6 w-6 min-w-6 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
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
  const mainClassName = cn(
    "flex min-w-0 flex-1 items-center gap-1 self-stretch rounded-sm px-0 text-left",
    collapsible &&
      "cursor-pointer select-none transition-colors hover:bg-[var(--accent)]/18 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)]/50",
  );
  const mainContent = (
    <>
      {collapsible && (
        <span className="flex h-3.5 w-3 shrink-0 items-center justify-center" aria-hidden="true">
          <ChevronDown
            size="0.6875rem"
            className={cn(
              "text-[color:var(--tracker-profile-icon,var(--primary))] opacity-60 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
              collapsed && "-rotate-90",
            )}
          />
        </span>
      )}
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[color:var(--tracker-profile-icon,var(--primary))] opacity-75"
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
    </>
  );

  return (
    <div
      className={cn(
        "relative flex min-h-7 items-center gap-1 border-b border-[var(--border)]/42 px-1 py-0.5",
        className,
      )}
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          title={toggleTitle}
          onClick={onToggle}
          className={mainClassName}
        >
          {mainContent}
        </button>
      ) : (
        <div className={mainClassName}>{mainContent}</div>
      )}
      {(badge !== undefined && badge !== null) || action || addAction ? (
        <div className="ml-0.5 flex min-h-6 shrink-0 items-center gap-0.5">
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

export function EmptySection({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-[color-mix(in_srgb,var(--tracker-inline-rule,var(--border))_38%,transparent)] px-1 py-1 text-center text-[0.6875rem] text-[color-mix(in_srgb,var(--tracker-inline-muted,var(--muted-foreground))_66%,transparent)]">
      {children}
    </div>
  );
}
