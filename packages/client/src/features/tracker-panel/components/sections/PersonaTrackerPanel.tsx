import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HeartPulse, Package, Sparkles } from "lucide-react";
import type { CharacterStat, InventoryItem, Persona } from "@marinara-engine/shared";
import type { TrackerPanelSide, TrackerPanelSizeProfile } from "../../../../stores/ui.store";
import {
  characterKeys,
  useCharacterSprites,
  useUpdatePersona,
  type SpriteInfo,
} from "../../../../hooks/use-characters";
import {
  getTrackerCardPortraitView,
  parseTrackerCardColorConfig,
  serializeTrackerCardColorConfig,
  TRACKER_CARD_COLOR_PREVIEW_BASE_FIELD,
} from "../../../../lib/tracker-card-colors";
import { cn } from "../../../../lib/utils";
import {
  TRACKER_PORTRAIT_EXPRESSION_DEFAULT_FOCUS_Y,
  TRACKER_PROFILE_PORTRAIT_FRAME_STAGE_MAX_CLASS,
  TRACKER_PROFILE_PORTRAIT_MEDIA_STAGE_REM,
  TRACKER_PROFILE_PORTRAIT_ROOMY_MEDIA_STAGE_REM,
} from "../../lib/tracker-panel.constants";
import { visibleText } from "../../lib/tracker-display";
import {
  TRACKER_PROFILE_DETAILS_SEAM_BORDER_CLASS_BY_SIDE,
  TRACKER_PROFILE_GRID_CLASS,
  TRACKER_PROFILE_GRID_CLASS_BY_PORTRAIT_SIDE,
  TRACKER_PROFILE_ORDER_CLASS_BY_SIDE,
  getOppositeTrackerProfileSide,
  getTrackerProfilePortraitSide,
} from "../../lib/tracker-profile-layout";
import { resolveSpriteUrl } from "../../lib/sprite-expressions";
import { getPersonaStatDensity } from "../../lib/tracker-stat-layout";
import { getPersonaAmbienceStyle } from "../../lib/tracker-profile-style";
import { InlineAddRow, InlineEdit } from "../controls/InlineControls";
import { TrackerProfileNameplate } from "../controls/TrackerProfileNameplate";
import {
  TRACKER_PROFILE_BODY_BOTTOM_RULE_CLASS,
  TRACKER_PROFILE_BODY_TONE_OVERLAY_CLASS,
  TRACKER_PROFILE_CARD_SURFACE_CLASS,
  TRACKER_PROFILE_EMPTY_SURFACE_CLASS,
  TRACKER_PROFILE_MATERIAL_PANEL_CLASS,
  TRACKER_PROFILE_STATUS_STRIP_CLASS,
  TrackerProfileDisplayWash,
  TrackerProfileEdgeHighlight,
  TrackerReadabilityVeil,
  TRACKER_PROFILE_SURFACE_TEXTURE_CLASS,
  TRACKER_PROFILE_SURFACE_TOP_RULE_CLASS,
} from "../controls/TrackerProfileChrome";
import { AddRowButton, SectionHeader } from "../controls/SectionControls";
import { StatList } from "../controls/StatList";
import { PersonaInventoryRow } from "./PersonaInventoryRow";
import { PersonaPortraitStage } from "./PersonaPortraitStage";

const PERSONA_COCKPIT_SHELF_CLASS =
  cn(
    "pointer-events-none absolute inset-x-0 top-5 z-0 h-[9rem] overflow-hidden border-b border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_46%,transparent)] shadow-[inset_0_10px_18px_color-mix(in_srgb,var(--background)_20%,transparent),inset_0_-12px_22px_color-mix(in_srgb,var(--background)_44%,transparent)] @min-[380px]:h-[10.5rem]",
    TRACKER_PROFILE_MATERIAL_PANEL_CLASS,
  );
const PERSONA_STAT_COLUMN_CLASS =
  "relative z-[1] flex min-w-0 flex-col overflow-hidden border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_52%,transparent)]";
const PERSONA_STAT_SHELF_CLASS =
  "group/statbox relative min-h-0 min-w-0 flex-1 overflow-y-auto px-1.5 py-1.5";
const PERSONA_LOWER_DECK_CLASS =
  cn(
    "relative z-[1] order-3 col-span-2 flex flex-col gap-1 border-t border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_50%,transparent)] px-1 py-1",
    TRACKER_PROFILE_MATERIAL_PANEL_CLASS,
  );
const PERSONA_STATUS_STRIP_CLASS =
  cn(TRACKER_PROFILE_STATUS_STRIP_CLASS, "mx-0.5 items-center px-1.5 py-[0.1875rem]");
const PERSONA_INVENTORY_HEADER_CLASS =
  "relative mx-0.5 flex min-h-6 items-center gap-1 overflow-hidden px-0.5 text-[0.625rem] leading-3";
const PERSONA_INVENTORY_SHELF_CLASS =
  cn(TRACKER_PROFILE_EMPTY_SURFACE_CLASS, "min-h-0 flex-1");

interface PersonaPortraitPendingSave {
  id: string;
  portraitFocusX: number;
  portraitFocusY: number;
  portraitZoom: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSamePersonaPortraitPendingSave(
  current: PersonaPortraitPendingSave | null,
  expected: PersonaPortraitPendingSave,
) {
  return (
    current?.id === expected.id &&
    current.portraitFocusX === expected.portraitFocusX &&
    current.portraitFocusY === expected.portraitFocusY &&
    current.portraitZoom === expected.portraitZoom
  );
}

export function PersonaInventoryPanel({
  persona,
  status,
  spriteExpression,
  trackerPanelSide,
  trackerPanelSizeProfile,
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
  trackerPanelSide: TrackerPanelSide;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
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
  const queryClient = useQueryClient();
  const updatePersona = useUpdatePersona();
  const personaPortraitSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personaPortraitPendingSaveRef = useRef<PersonaPortraitPendingSave | null>(null);
  const updatePersonaMutateRef = useRef(updatePersona.mutate);
  const flushPersonaPortraitPendingSaveRef = useRef<(pendingSave: PersonaPortraitPendingSave) => void>(() => {});
  const [personaPortraitFocusOverride, setPersonaPortraitFocusOverride] = useState<{
    personaId: string;
    x: number;
    y: number;
    zoom: number;
  } | null>(null);
  const personaName = visibleText(persona?.name, "Persona");
  const personaExpression = spriteExpression?.trim() ?? "";
  const spritePersonaId = personaExpression && persona?.id ? persona.id : null;
  const { data: personaSprites } = useCharacterSprites(spritePersonaId);
  const personaSpriteUrl = personaExpression
    ? resolveSpriteUrl(personaSprites as SpriteInfo[] | undefined, personaExpression)
    : null;
  const personaPortraitMedia = personaSpriteUrl ?? persona?.avatarPath ?? null;
  const personaPortraitMediaKind = personaSpriteUrl ? "expression" : persona?.avatarPath ? "art" : null;
  const defaultPersonaPortraitFocusY =
    personaPortraitMediaKind === "expression" ? TRACKER_PORTRAIT_EXPRESSION_DEFAULT_FOCUS_Y : undefined;
  const personaTrackerCardColors = parseTrackerCardColorConfig(persona?.trackerCardColors);
  const personaTrackerCardColorsRef = useRef(personaTrackerCardColors);
  personaTrackerCardColorsRef.current = personaTrackerCardColors;
  const personaSavedPortraitFocus = getTrackerCardPortraitView(personaTrackerCardColors, {
    y: defaultPersonaPortraitFocusY,
  });
  const personaPortraitFocus =
    personaPortraitFocusOverride && personaPortraitFocusOverride.personaId === persona?.id
      ? personaPortraitFocusOverride
      : personaSavedPortraitFocus;
  const flushPersonaPortraitPendingSave = (pendingSave: PersonaPortraitPendingSave) => {
    const cachedPersonas = queryClient.getQueryData<unknown[] | undefined>(characterKeys.personas);
    const cachedPersona = Array.isArray(cachedPersonas)
      ? cachedPersonas.find((candidate) => isRecord(candidate) && candidate.id === pendingSave.id)
      : null;
    const previewBaseTrackerCardColors = isRecord(cachedPersona)
      ? cachedPersona[TRACKER_CARD_COLOR_PREVIEW_BASE_FIELD]
      : null;
    const latestTrackerCardColors = parseTrackerCardColorConfig(
      typeof previewBaseTrackerCardColors === "string"
        ? previewBaseTrackerCardColors
        : isRecord(cachedPersona)
          ? cachedPersona.trackerCardColors
          : personaTrackerCardColorsRef.current,
    );
    const trackerCardColors = serializeTrackerCardColorConfig({
      ...latestTrackerCardColors,
      portraitFocusX: pendingSave.portraitFocusX,
      portraitFocusY: pendingSave.portraitFocusY,
      portraitZoom: pendingSave.portraitZoom,
    });

    updatePersonaMutateRef.current({ id: pendingSave.id, trackerCardColors });
  };
  flushPersonaPortraitPendingSaveRef.current = flushPersonaPortraitPendingSave;
  const updatePersonaPortraitFocus =
    persona?.id && personaPortraitMediaKind
      ? (portraitFocusX: number, portraitFocusY: number, portraitZoom: number) => {
          setPersonaPortraitFocusOverride({
            personaId: persona.id,
            x: portraitFocusX,
            y: portraitFocusY,
            zoom: portraitZoom,
          });
          const pendingSave = { id: persona.id, portraitFocusX, portraitFocusY, portraitZoom };
          personaPortraitPendingSaveRef.current = pendingSave;
          if (personaPortraitSaveTimeoutRef.current) clearTimeout(personaPortraitSaveTimeoutRef.current);
          personaPortraitSaveTimeoutRef.current = setTimeout(() => {
            if (isSamePersonaPortraitPendingSave(personaPortraitPendingSaveRef.current, pendingSave)) {
              flushPersonaPortraitPendingSaveRef.current(pendingSave);
              personaPortraitPendingSaveRef.current = null;
            }
            personaPortraitSaveTimeoutRef.current = null;
          }, 180);
        }
      : undefined;
  const personaPortraitStageRem =
    trackerPanelSizeProfile === "expanded"
      ? TRACKER_PROFILE_PORTRAIT_ROOMY_MEDIA_STAGE_REM
      : TRACKER_PROFILE_PORTRAIT_MEDIA_STAGE_REM;
  const hasPersonaStats = personaStats.length > 0;
  const showInventoryInStatColumn = !hasPersonaStats;
  const hasPersonaStatBlock = hasPersonaStats || addMode || showInventoryInStatColumn;
  const personaStatDensity = getPersonaStatDensity(personaStats.length, addMode, personaPortraitStageRem);
  const fillPersonaStats = personaStatDensity === "normal" && personaStats.length >= 3;
  const useExpandedPersonaStatColumns = trackerPanelSizeProfile === "expanded" && personaStats.length >= 6;
  const personaPortraitSide = getTrackerProfilePortraitSide(trackerPanelSide);
  const personaDetailsSide = getOppositeTrackerProfileSide(personaPortraitSide);
  const renderInventoryShelf = (placement: "stat-column" | "lower-deck") => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={PERSONA_INVENTORY_HEADER_CLASS}>
        <Package
          size="0.6875rem"
          className="relative z-[1] shrink-0 text-[color-mix(in_srgb,var(--tracker-profile-label-muted-text)_42%,var(--tracker-profile-label-icon)_58%)]"
        />
        <span className="relative z-[1] min-w-0 flex-1 truncate font-semibold uppercase tracking-[0.06em] text-[color-mix(in_srgb,var(--tracker-profile-label-muted-text)_62%,var(--tracker-profile-label-text)_38%)]">
          Inventory
        </span>
        {addMode && (
          <span className="relative z-[1]">
            <AddRowButton title="Add item" onClick={onAddInventoryItem} />
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_42%,transparent),transparent)] opacity-80" />
      </div>
      <div
        className={cn(
          PERSONA_INVENTORY_SHELF_CLASS,
          inventory.length === 0
            ? "flex items-center justify-center px-1 py-2"
            : [
                "grid auto-rows-max content-start items-start gap-px overflow-y-auto p-0.5 text-left",
                placement === "stat-column"
                  ? [
                      "grid-cols-1",
                      trackerPanelSizeProfile === "expanded" && inventory.length >= 6 && "@min-[420px]:grid-cols-2",
                    ]
                  : trackerPanelSizeProfile === "expanded"
                    ? [
                        inventory.length >= 2 && "@min-[380px]:grid-cols-2",
                        inventory.length >= 9 && "@min-[380px]:grid-cols-3",
                      ]
                    : [
                        inventory.length <= 4 && "@min-[380px]:grid-cols-1",
                        inventory.length >= 9 && "@min-[380px]:grid-cols-3",
                      ],
              ],
          placement === "stat-column" && "min-h-10",
        )}
      >
        {inventory.length === 0 ? (
          <span className="relative z-[1]">Inventory empty.</span>
        ) : (
          inventory.map((item, index) => (
            <PersonaInventoryRow
              key={`${item.name}-${index}`}
              item={item}
              onUpdate={(updated) => onUpdateInventoryItem(index, updated)}
              onRemove={() => onRemoveInventoryItem(index)}
              deleteMode={deleteMode}
              fullWidth={inventory.length === 1}
            />
          ))
        )}
      </div>
    </div>
  );

  useEffect(() => {
    setPersonaPortraitFocusOverride(null);
  }, [persona?.id, persona?.trackerCardColors]);

  useEffect(() => {
    updatePersonaMutateRef.current = updatePersona.mutate;
  }, [updatePersona.mutate]);

  useEffect(
    () => () => {
      if (personaPortraitSaveTimeoutRef.current) clearTimeout(personaPortraitSaveTimeoutRef.current);
      const pendingSave = personaPortraitPendingSaveRef.current;
      personaPortraitPendingSaveRef.current = null;
      if (pendingSave) flushPersonaPortraitPendingSaveRef.current(pendingSave);
    },
    [],
  );

  return (
    <div className="relative z-10 overflow-hidden border-b border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--card)_5%,transparent)] shadow-inner transition-colors duration-200">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]" />

      <SectionHeader
        icon={<Sparkles size="0.6875rem" />}
        title="Persona"
        action={action}
        className="bg-[color-mix(in_srgb,var(--background)_86%,var(--card)_14%)] [--primary:var(--sidebar-accent-foreground)] [--tracker-profile-icon:var(--sidebar-accent-foreground)]"
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />

      {!collapsed && (
        <div className="relative px-1 pb-1 @min-[380px]:pb-1.5">
          <div
            className={TRACKER_PROFILE_CARD_SURFACE_CLASS}
            style={getPersonaAmbienceStyle(persona, { paintBackground: false })}
          >
            <div className={TRACKER_PROFILE_BODY_TONE_OVERLAY_CLASS} />
            <TrackerReadabilityVeil strength="strong" />
            <TrackerProfileDisplayWash />
            <div className={TRACKER_PROFILE_BODY_BOTTOM_RULE_CLASS} />
            <div
              className={cn(
                TRACKER_PROFILE_GRID_CLASS,
                "@min-[380px]:grid-rows-[auto_minmax(0,1fr)]",
                TRACKER_PROFILE_GRID_CLASS_BY_PORTRAIT_SIDE[personaPortraitSide],
              )}
            >
              <TrackerProfileNameplate placeholder="Persona" value={persona?.name} />
              <div aria-hidden="true" className={PERSONA_COCKPIT_SHELF_CLASS}>
                <div className={TRACKER_PROFILE_SURFACE_TEXTURE_CLASS} />
                <div className={TRACKER_PROFILE_SURFACE_TOP_RULE_CLASS} />
              </div>

              {hasPersonaStatBlock && (
                <div
                  className={cn(
                    PERSONA_STAT_COLUMN_CLASS,
                    TRACKER_PROFILE_PORTRAIT_FRAME_STAGE_MAX_CLASS,
                    TRACKER_PROFILE_ORDER_CLASS_BY_SIDE[personaDetailsSide],
                  )}
                >
                  <div
                    className={cn(
                      PERSONA_STAT_SHELF_CLASS,
                      (fillPersonaStats || showInventoryInStatColumn) && "flex flex-col",
                      TRACKER_PROFILE_DETAILS_SEAM_BORDER_CLASS_BY_SIDE[personaDetailsSide],
                    )}
                  >
                    {showInventoryInStatColumn ? (
                      <div className="flex min-h-0 flex-1 flex-col gap-1">
                        {addMode && (
                          <InlineAddRow
                            onClick={onAddPersonaStat}
                            title="Add stat"
                            className="shrink-0 rounded-[5px] border border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_32%,transparent)] bg-[image:var(--tracker-profile-field-material)] [background-blend-mode:var(--tracker-profile-field-material-blend)]"
                          />
                        )}
                        {renderInventoryShelf("stat-column")}
                      </div>
                    ) : (
                      <StatList
                        stats={personaStats}
                        onUpdate={onUpdatePersonaStats}
                        onAdd={onAddPersonaStat}
                        nameMode="truncate"
                        deleteMode={deleteMode}
                        addMode={addMode}
                        density={personaStatDensity}
                        fillAvailable={fillPersonaStats}
                        wideColumns={useExpandedPersonaStatColumns}
                        fillWideColumns={useExpandedPersonaStatColumns}
                        visualTone="instrument"
                      />
                    )}
                  </div>
                </div>
              )}
              <PersonaPortraitStage
                persona={persona}
                media={personaPortraitMedia}
                mediaKind={personaPortraitMediaKind}
                defaultPortraitFocusY={defaultPersonaPortraitFocusY}
                portraitFocusX={personaPortraitFocus.x}
                portraitFocusY={personaPortraitFocus.y}
                portraitZoom={personaPortraitFocus.zoom}
                side={personaPortraitSide}
                onPortraitFocusChange={updatePersonaPortraitFocus}
              />

              <div className={PERSONA_LOWER_DECK_CLASS}>
                <div className={PERSONA_STATUS_STRIP_CLASS}>
                  <HeartPulse
                    size="0.75rem"
                    className="relative z-[1] mt-0.5 shrink-0 text-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_72%,var(--tracker-profile-text)_28%)]"
                  />
                  <InlineEdit
                    value={status}
                    onSave={onSaveStatus}
                    placeholder="Status"
                    className={cn(
                      "relative z-[1] min-h-5 flex-1 rounded-[2px] px-0.5 py-0 text-[0.6875rem] font-medium leading-[0.875rem] text-[color-mix(in_srgb,var(--tracker-profile-text)_86%,var(--primary)_14%)] hover:bg-[var(--accent)]/18",
                      trackerPanelSizeProfile === "compact" && "h-5",
                    )}
                    title={`${personaName} status`}
                    scrollOnHover={trackerPanelSizeProfile === "compact"}
                    previewLineCount={trackerPanelSizeProfile === "compact" ? undefined : 2}
                    showEditHint={false}
                  />
                </div>
                {!showInventoryInStatColumn && renderInventoryShelf("lower-deck")}
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
