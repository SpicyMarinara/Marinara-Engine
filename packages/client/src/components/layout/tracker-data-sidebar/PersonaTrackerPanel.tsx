import type { ReactNode } from "react";
import { HeartPulse, Package, Sparkles, X } from "lucide-react";
import type { CharacterStat, InventoryItem, Persona } from "@marinara-engine/shared";
import { useCharacterSprites, type SpriteInfo } from "../../../hooks/use-characters";
import { cn } from "../../../lib/utils";
import type { PersonaPortraitMode } from "./tracker-data-sidebar.constants";
import {
  getPersonaAmbienceStyle,
  getPersonaInitial,
  getPersonaStatDensity,
  resolveSpriteUrl,
  visibleText,
} from "./tracker-data-sidebar.helpers";
import {
  AddRowButton,
  EmptySection,
  FittedText,
  InlineEdit,
  InlineNumber,
  SectionHeader,
  TrackerProfileDisplayWash,
  TrackerProfileEdgeHighlight,
  TrackerReadabilityVeil,
  TrackerPortraitStageBackdrop,
} from "./tracker-data-sidebar.controls";
import { StatList } from "./tracker-data-sidebar.stats";

function PersonaPortraitStage({
  persona,
  status,
  expression,
  media,
  mode,
  onSaveStatus,
}: {
  persona: Persona | null;
  status: string;
  expression: string;
  media: string | null;
  mode: PersonaPortraitMode;
  onSaveStatus: (status: string) => void;
}) {
  const personaName = visibleText(persona?.name, "Persona");
  const usingExpression = mode === "expression";

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-b-md bg-[image:var(--tracker-profile-surface)] ring-1 ring-[color-mix(in_srgb,var(--tracker-profile-rule)_58%,var(--border)_42%)] shadow-[inset_0_-16px_24px_color-mix(in_srgb,var(--background)_58%,transparent)] [background-blend-mode:var(--tracker-profile-surface-blend)] @min-[380px]:col-start-2 @min-[380px]:row-start-1",
        usingExpression ? "h-[12.25rem] self-start @min-[380px]:row-span-2 @min-[380px]:h-[13.25rem]" : "self-stretch",
      )}
    >
      <div className="relative flex h-5 shrink-0 items-center gap-1 overflow-hidden border-b border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-panel)] px-1 [background-blend-mode:var(--tracker-profile-panel-blend)]">
        <TrackerProfileDisplayWash />
        <HeartPulse size="0.6875rem" className="relative z-[1] shrink-0 text-[var(--primary)]/80" />
        <InlineEdit
          value={status}
          onSave={onSaveStatus}
          placeholder="Status"
          className="relative z-[1] h-4 w-full min-w-0 px-0 py-0 text-[0.625rem] font-semibold leading-4 text-[color-mix(in_srgb,var(--foreground)_82%,var(--primary)_18%)] hover:bg-[var(--accent)]/25"
          scrollOnHover
          showEditHint={false}
        />
        <TrackerProfileEdgeHighlight />
      </div>
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-b-md",
          usingExpression && "h-[11rem] flex-none @min-[380px]:h-[12rem]",
        )}
      >
        <TrackerPortraitStageBackdrop media={media} />
        {media ? (
          <img src={media} alt="" className="relative z-[1] h-full w-full object-cover object-top" draggable={false} />
        ) : (
          <div className="relative z-[1] flex h-full w-full items-center justify-center text-2xl font-semibold text-[var(--tracker-profile-icon)]">
            {getPersonaInitial(persona)}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-1 left-1 right-1 z-[2] h-px bg-[var(--tracker-profile-dialogue-border)]" />
      </div>
      <span className="sr-only">{usingExpression ? `${personaName}: ${expression}` : `${personaName} avatar`}</span>
    </div>
  );
}

export function PersonaInventoryPanel({
  persona,
  status,
  spriteExpression,
  personaStats,
  inventory,
  action,
  onSaveStatus,
  onUpdatePersonaStats,
  onAddPersonaStat,
  onAddInventoryItem,
  onUpdateInventoryItem,
  onRemoveInventoryItem,
  deleteMode,
  addMode,
  collapsed = false,
  onToggleCollapsed,
}: {
  persona: Persona | null;
  status: string;
  spriteExpression?: string;
  personaStats: CharacterStat[];
  inventory: InventoryItem[];
  action?: ReactNode;
  onSaveStatus: (status: string) => void;
  onUpdatePersonaStats: (stats: CharacterStat[]) => void;
  onAddPersonaStat: () => void;
  onAddInventoryItem: () => void;
  onUpdateInventoryItem: (index: number, item: InventoryItem) => void;
  onRemoveInventoryItem: (index: number) => void;
  deleteMode: boolean;
  addMode: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const personaName = visibleText(persona?.name, "Persona");
  const personaExpression = spriteExpression?.trim() ?? "";
  const spritePersonaId = personaExpression && persona?.id ? persona.id : null;
  const { data: personaSprites } = useCharacterSprites(spritePersonaId);
  const personaSpriteUrl = personaExpression
    ? resolveSpriteUrl(personaSprites as SpriteInfo[] | undefined, personaExpression)
    : null;
  const personaPortraitMode: PersonaPortraitMode = personaSpriteUrl ? "expression" : "avatar";
  const personaPortraitMedia = personaSpriteUrl ?? persona?.avatarPath ?? null;
  const personaStatDensity = getPersonaStatDensity(personaStats.length, personaPortraitMode, addMode);
  const fillPersonaStats = personaStatDensity === "normal" && personaStats.length >= 3;

  return (
    <div className="relative z-10 overflow-hidden border-b border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--card)_5%,transparent)] shadow-inner transition-colors duration-200">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]" />

      <SectionHeader
        icon={<Sparkles size="0.6875rem" />}
        title="Persona"
        action={action}
        className="bg-[color-mix(in_srgb,var(--background)_86%,var(--card)_14%)] [--primary:var(--sidebar-accent-foreground)] [--tracker-profile-display-solid:var(--sidebar-accent-foreground)]"
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />

      {!collapsed && (
        <div className="relative pb-1 @min-[380px]:px-1 @min-[380px]:pb-1.5">
          <div
            className="relative overflow-hidden rounded-md border border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-surface)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)] [background-blend-mode:var(--tracker-profile-surface-blend)]"
            style={getPersonaAmbienceStyle(persona, { paintBackground: false })}
          >
            <TrackerReadabilityVeil strength="strong" />
            <div className="relative z-[1] grid grid-cols-[minmax(0,1fr)_clamp(5.75rem,42cqw,7.35rem)] @min-[380px]:grid-cols-[minmax(0,1fr)_9rem] @min-[380px]:grid-rows-[auto_minmax(0,1fr)]">
              <div
                className={cn(
                  "min-w-0 border-r border-[var(--tracker-profile-rule)]",
                  fillPersonaStats && "flex flex-col",
                )}
              >
                <div className="relative flex min-h-5 items-center justify-center overflow-hidden border-b border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-panel-strong)] px-1.5 py-0 [background-blend-mode:var(--tracker-profile-panel-strong-blend)]">
                  <TrackerProfileDisplayWash />
                  <FittedText
                    className="relative z-[1] w-full text-sm font-semibold leading-5 text-[color:var(--tracker-profile-text)]"
                    title={personaName}
                    align="center"
                    minScale={0.58}
                  >
                    {personaName}
                  </FittedText>
                  <TrackerProfileEdgeHighlight />
                </div>

                <div
                  className={cn(
                    "group/statbox relative min-w-0 px-1 py-1",
                    fillPersonaStats && "flex min-h-0 flex-1 flex-col @min-[380px]:flex-none",
                  )}
                >
                  <StatList
                    stats={personaStats}
                    onUpdate={onUpdatePersonaStats}
                    onAdd={onAddPersonaStat}
                    nameMode="truncate"
                    deleteMode={deleteMode}
                    addMode={addMode}
                    density={personaStatDensity}
                    fillAvailable={fillPersonaStats}
                    wideColumns={personaStats.length >= 4}
                  />
                </div>
              </div>
              <PersonaPortraitStage
                persona={persona}
                status={status}
                expression={personaExpression}
                media={personaPortraitMedia}
                mode={personaPortraitMode}
                onSaveStatus={onSaveStatus}
              />

              <div
                className={cn(
                  "col-span-2 border-t border-[var(--tracker-profile-rule)] px-1 pb-1 pt-0.5",
                  personaPortraitMode === "expression" &&
                    "@min-[380px]:col-span-1 @min-[380px]:col-start-1 @min-[380px]:row-start-2 @min-[380px]:border-r @min-[380px]:border-r-[var(--tracker-profile-rule)]",
                )}
              >
                <div className="flex min-h-0 min-w-0 flex-col @min-[380px]:h-full">
                  <div className="relative flex h-5 items-center gap-1 overflow-hidden bg-[image:var(--tracker-profile-panel)] px-0.5 text-[0.6875rem] leading-[0.875rem] [background-blend-mode:var(--tracker-profile-panel-blend)]">
                    <TrackerProfileDisplayWash className="[mask-image:linear-gradient(90deg,transparent_0%,black_13%,black_87%,transparent_100%)]" />
                    <Package size="0.75rem" className="relative z-[1] shrink-0 text-[var(--primary)]/78" />
                    <span className="relative z-[1] min-w-0 flex-1 truncate font-medium text-[color-mix(in_srgb,var(--tracker-profile-text)_78%,var(--primary)_22%)]">
                      Inventory
                    </span>
                    {addMode && (
                      <span className="relative z-[1]">
                        <AddRowButton title="Add item" onClick={onAddInventoryItem} />
                      </span>
                    )}
                    <TrackerProfileEdgeHighlight className="opacity-55 [mask-image:linear-gradient(90deg,transparent_0%,black_12%,black_88%,transparent_100%)]" />
                  </div>
                  {inventory.length === 0 ? (
                    <div className="min-h-0 flex-1 px-0.5 py-1">
                      <EmptySection>Inventory empty.</EmptySection>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "grid min-h-0 flex-1 auto-rows-max content-start items-start grid-cols-2 gap-px overflow-y-auto pt-0.5",
                        inventory.length <= 4 && "@min-[380px]:grid-cols-1",
                        inventory.length >= 9 && "@min-[380px]:grid-cols-3",
                      )}
                    >
                      {inventory.map((item, index) => (
                        <CompactInventoryRow
                          key={`${item.name}-${index}`}
                          item={item}
                          onUpdate={(updated) => onUpdateInventoryItem(index, updated)}
                          onRemove={() => onRemoveInventoryItem(index)}
                          deleteMode={deleteMode}
                          fullWidth={inventory.length === 1}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <TrackerProfileEdgeHighlight
              strength="strong"
              showBottom={false}
              className="[mask-image:linear-gradient(180deg,black_0%,black_78%,transparent_100%)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CompactInventoryRow({
  item,
  onUpdate,
  onRemove,
  deleteMode,
  fullWidth = false,
}: {
  item: InventoryItem;
  onUpdate: (item: InventoryItem) => void;
  onRemove: () => void;
  deleteMode: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 rounded-[2px] border border-[var(--tracker-profile-slot-rule)] bg-[image:var(--tracker-profile-slot-surface)] px-1 py-px shadow-[inset_0_1px_2px_var(--tracker-profile-slot-shadow)] [background-blend-mode:var(--tracker-profile-slot-surface-blend)]",
        fullWidth && "col-span-full",
        deleteMode && "pr-5",
      )}
    >
      <div className="grid min-h-4 grid-cols-[minmax(0,1fr)_max-content] items-center gap-0.5">
        <InlineEdit
          value={item.name}
          onSave={(name) => onUpdate({ ...item, name: name || "Item" })}
          className="h-4 w-full min-w-0 px-0.5 py-0 text-[0.625rem] font-medium leading-4 text-[color:var(--tracker-profile-text)] hover:bg-[var(--accent)]/25"
          placeholder="Item"
          title={visibleText(item.name, "Item")}
          scrollOnHover
          showEditHint={false}
        />
        <div className="flex h-4 min-w-0 items-center justify-end">
          <InlineNumber
            value={item.quantity}
            onChange={(quantity) => onUpdate({ ...item, quantity })}
            min={0}
            className="justify-self-end px-0 text-right text-[0.625rem] leading-4 text-[color:var(--tracker-profile-number-text)] hover:bg-transparent focus:bg-transparent focus:ring-0"
            title={`${item.name} quantity`}
          />
        </div>
      </div>
      {deleteMode && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
          title={`Remove ${item.name}`}
          aria-label={`Remove ${item.name}`}
        >
          <X size="0.65rem" />
        </button>
      )}
    </div>
  );
}
