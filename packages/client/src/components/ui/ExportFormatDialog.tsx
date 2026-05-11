import { FileJson, ImageDown, Layers, X } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../../lib/utils";

export type ExportFormatChoice = "native" | "compatible" | "compatible-png";

interface ExportFormatDialogProps {
  open: boolean;
  title: string;
  description?: string;
  nativeDescription?: string;
  compatibleDescription?: string;
  pngDescription?: string;
  showPngOption?: boolean;
  onClose: () => void;
  onSelect: (format: ExportFormatChoice) => void;
}

export function ExportFormatDialog({
  open,
  title,
  description = "Choose how Marinara should package this export.",
  nativeDescription = "Keeps Marinara-specific fields, folders, metadata, and import fidelity.",
  compatibleDescription = "Uses folderless, platform-friendly JSON where possible for tools like SillyTavern and Chub.",
  pngDescription = "Chara Card V2 PNG with the avatar baked in — works in SillyTavern, Chub, and Risu.",
  showPngOption = false,
  onClose,
  onSelect,
}: ExportFormatDialogProps) {
  const options: Array<{
    id: ExportFormatChoice;
    label: string;
    icon: typeof Layers;
    description: string;
  }> = [
    { id: "native", label: "Marinara Native", icon: Layers, description: nativeDescription },
    { id: "compatible", label: "Compatible JSON", icon: FileJson, description: compatibleDescription },
    ...(showPngOption
      ? [{ id: "compatible-png" as const, label: "Compatible PNG Card", icon: ImageDown, description: pngDescription }]
      : []),
  ];

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-lg">
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{description}</p>
        <div className={cn("grid gap-2", showPngOption ? "sm:grid-cols-3" : "sm:grid-cols-2")}>

          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                className={cn(
                  "group flex min-h-[8.5rem] flex-col items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/55 p-4 text-left transition-all",
                  "hover:border-[var(--primary)]/45 hover:bg-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/35",
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--card)] text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors group-hover:text-[var(--primary)]">
                  <Icon size="1.05rem" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--foreground)]">{option.label}</span>
                  <span className="mt-1 block text-[0.6875rem] leading-relaxed text-[var(--muted-foreground)]">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="0.875rem" />
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
