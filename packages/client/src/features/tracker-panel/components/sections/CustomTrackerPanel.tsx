import type { ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { CustomTrackerField } from "@marinara-engine/shared";
import type { TrackerPanelSizeProfile } from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";
import { InlineEdit } from "../controls/InlineControls";
import { TrackerReadabilityVeil } from "../controls/TrackerProfileChrome";
import { AddRowButton, EmptySection, SectionHeader } from "../controls/SectionControls";

function isLongCustomField(field: CustomTrackerField): boolean {
  const name = visibleText(field.name, "");
  const value = visibleText(field.value, "");
  return name.length > 16 || value.length > 22 || (/\s/.test(value) && value.length > 14);
}

function shouldUseCustomFieldColumns(
  fields: CustomTrackerField[],
  trackerPanelSizeProfile: TrackerPanelSizeProfile,
): boolean {
  if (trackerPanelSizeProfile === "compact" || fields.length < 4) {
    return false;
  }
  return !fields.some(isLongCustomField);
}

function CustomFieldList({
  fields,
  onUpdate,
  deleteMode = false,
  trackerPanelSizeProfile,
}: {
  fields: CustomTrackerField[];
  onUpdate?: (fields: CustomTrackerField[]) => void;
  deleteMode?: boolean;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
}) {
  if (fields.length === 0 && !onUpdate) return <EmptySection>No custom stats tracked.</EmptySection>;
  const readableValues = trackerPanelSizeProfile !== "compact";
  const useFieldColumns = shouldUseCustomFieldColumns(fields, trackerPanelSizeProfile);
  const updateField = (index: number, updated: CustomTrackerField) => {
    if (!onUpdate) return;
    const next = [...fields];
    next[index] = updated;
    onUpdate(next);
  };
  const removeField = (index: number) => {
    if (!onUpdate) return;
    onUpdate(fields.filter((_, fieldIndex) => fieldIndex !== index));
  };
  return (
    <div className="group/statbox relative">
      {fields.length === 0 ? (
        <div className="px-1 py-1">
          <EmptySection>No custom stats tracked.</EmptySection>
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 border-t border-[var(--border)]/30",
            useFieldColumns && "@min-[300px]:grid-cols-2",
          )}
        >
          {fields.map((field, index) => {
            const allowWrap = readableValues && isLongCustomField(field);
            const valueText = visibleText(field.value, "");
            const valueIsLong = valueText.length > 18 || valueText.includes(" ");
            const valueAlignment = allowWrap && valueIsLong ? "text-left" : "text-right tabular-nums";
            return (
              <div
                key={`${field.name}-${index}`}
                className={cn(
                  "group/field relative grid min-h-6 grid-cols-[minmax(3rem,0.42fr)_minmax(0,1fr)] items-center gap-1 border-b border-[var(--border)]/28 px-1 py-0.5 text-[0.6875rem] leading-[0.875rem]",
                  trackerPanelSizeProfile !== "compact" && "grid-cols-[minmax(3.5rem,0.42fr)_minmax(0,1fr)]",
                  allowWrap && "min-h-8 items-start py-1 leading-[0.95rem]",
                  useFieldColumns &&
                    index % 2 === 0 &&
                    !(fields.length % 2 === 1 && index === fields.length - 1) &&
                    "@min-[300px]:border-r @min-[300px]:border-r-[var(--border)]/20",
                  useFieldColumns && fields.length % 2 === 1 && index === fields.length - 1 && "@min-[300px]:col-span-2",
                  deleteMode && "pr-5",
                )}
              >
                {onUpdate ? (
                  <InlineEdit
                    value={field.name}
                    onSave={(name) => updateField(index, { ...field, name: name || "Field" })}
                    placeholder="Field"
                    className={cn("min-w-0 px-0.5 py-0 font-medium", allowWrap && "min-h-5")}
                    editHintMode={allowWrap ? "overlay" : "inline"}
                    previewLineCount={allowWrap ? 2 : undefined}
                    scrollOnHover={!allowWrap}
                    showEditHint={false}
                  />
                ) : (
                  <span
                    className={cn(
                      "min-w-0 px-0.5 font-medium text-[var(--muted-foreground)]",
                      allowWrap ? "line-clamp-2 break-words" : "truncate",
                    )}
                  >
                    {visibleText(field.name, "Field")}
                  </span>
                )}
                {onUpdate ? (
                  <InlineEdit
                    value={field.value}
                    onSave={(value) => updateField(index, { ...field, value })}
                    placeholder="Value"
                    className={cn(
                      "min-w-0 px-0.5 py-0",
                      valueAlignment,
                      allowWrap ? "min-h-5 justify-start leading-[1.15]" : "justify-end",
                    )}
                    twoLinePreview={allowWrap}
                    editHintMode={allowWrap ? "overlay" : "inline"}
                    previewLineCount={allowWrap ? 2 : undefined}
                    scrollOnHover={!allowWrap}
                    showEditHint={false}
                  />
                ) : (
                  <span
                    className={cn(
                      "min-w-0 px-0.5 text-[var(--foreground)]",
                      valueAlignment,
                      allowWrap ? "line-clamp-2 break-words leading-[1.15]" : "truncate",
                    )}
                  >
                    {visibleText(field.value, "Empty")}
                  </span>
                )}
                {onUpdate && deleteMode && (
                  <button
                    type="button"
                    onClick={() => removeField(index)}
                    className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--background)]/85 text-[var(--destructive)] shadow-sm ring-1 ring-[var(--border)]/70 backdrop-blur-sm transition-all hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-[var(--primary)] active:scale-90"
                    title="Remove field"
                    aria-label={`Remove ${visibleText(field.name, "field")}`}
                  >
                    <X size="0.5625rem" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CustomTrackerPanel({
  fields,
  action,
  onUpdateFields,
  deleteMode,
  addMode,
  trackerPanelSizeProfile,
  collapsed = false,
  onToggleCollapsed,
}: {
  fields: CustomTrackerField[];
  action?: ReactNode;
  onUpdateFields: (fields: CustomTrackerField[]) => void;
  deleteMode: boolean;
  addMode: boolean;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  return (
    <section className="relative z-10 overflow-hidden border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_10%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
      <TrackerReadabilityVeil strength="strong" />
      <div className="relative z-10">
        <SectionHeader
          icon={<SlidersHorizontal size="0.6875rem" />}
          title="Custom Stats"
          action={action}
          addAction={
            addMode ? (
              <AddRowButton
                title="Add custom stat"
                onClick={() => onUpdateFields([...fields, { name: "New Field", value: "" }])}
                className="rounded-sm"
              />
            ) : undefined
          }
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
        />
        {!collapsed && (
          <CustomFieldList
            fields={fields}
            onUpdate={onUpdateFields}
            deleteMode={deleteMode}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
          />
        )}
      </div>
    </section>
  );
}
