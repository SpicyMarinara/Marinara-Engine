// ──────────────────────────────────────────────
// Modal: Import Persona (JSON / Marinara export)
// ──────────────────────────────────────────────
import { useState, useRef } from "react";
import { Modal } from "../ui/Modal";
import { Download, FileJson, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { characterKeys } from "../../hooks/use-characters";
import { api } from "../../lib/api-client";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportPersonaModal({ open, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [results, setResults] = useState<Array<{ filename: string; success: boolean; message: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const qc = useQueryClient();

  const isZipFile = async (file: File): Promise<boolean> => {
    if (file.size < 4) return false;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x50 && head[1] === 0x4b;
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setStatus("loading");
    setResults([]);

    const nextResults: Array<{ filename: string; success: boolean; message: string }> = [];
    for (const file of files) {
      try {
        // Marinara native packages are .marinara files (zip with data.json +
        // avatar binary). Detect via the zip signature so a renamed file
        // still works.
        if (await isZipFile(file)) {
          const form = new FormData();
          form.append("file", file, file.name);
          form.append(
            "timestampOverrides",
            JSON.stringify({ createdAt: file.lastModified, updatedAt: file.lastModified }),
          );
          const data = await api.upload<{ success: boolean; name?: string; error?: string }>(
            "/import/marinara-package",
            form,
          );
          nextResults.push({
            filename: file.name,
            success: data.success,
            message: data.success ? `Imported "${data.name ?? file.name}"` : (data.error ?? "Import failed"),
          });
          continue;
        }

        const text = await file.text();
        const json = JSON.parse(text) as Record<string, unknown>;

        const isMarinaraEnvelope =
          json.version === 1 && typeof json.type === "string" && (json.type as string).startsWith("marinara_");

        if (isMarinaraEnvelope) {
          const data = await api.post<{ success: boolean; name?: string; error?: string }>("/import/marinara", {
            ...json,
            timestampOverrides: {
              createdAt: file.lastModified,
              updatedAt: file.lastModified,
            },
          });
          nextResults.push({
            filename: file.name,
            success: data.success,
            message: data.success ? `Imported "${data.name ?? file.name}"` : (data.error ?? "Import failed"),
          });
          continue;
        }

        const name = typeof json.name === "string" ? json.name : "Imported Persona";
        const data = await api.post<{ id?: string; error?: string }>("/characters/personas", {
          name,
          description: json.description ?? "",
          personality: json.personality ?? "",
          scenario: json.scenario ?? "",
          backstory: json.backstory ?? "",
          appearance: json.appearance ?? "",
          comment: json.comment ?? "",
          tags: json.tags ?? undefined,
          createdAt: file.lastModified,
          updatedAt: file.lastModified,
        });
        nextResults.push({
          filename: file.name,
          success: !!data.id,
          message: data.id ? `Imported "${name}"` : (data.error ?? "Import failed"),
        });
      } catch (err) {
        nextResults.push({
          filename: file.name,
          success: false,
          message: err instanceof Error ? err.message : "Failed to parse file",
        });
      }
    }

    setResults(nextResults);
    setStatus("done");
    if (nextResults.some((result) => result.success)) {
      qc.invalidateQueries({ queryKey: characterKeys.personas });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const reset = () => {
    setStatus("idle");
    setResults([]);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import Persona"
    >
      <div className="flex flex-col gap-4">
        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
            dragOver
              ? "border-[var(--primary)] bg-[var(--primary)]/10"
              : "border-[var(--border)] hover:border-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50"
          }`}
        >
          <Download
            size="2rem"
            className={`transition-colors ${dragOver ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
          />
          <div className="text-center">
            <p className="text-sm font-medium">Drop one or more files here or click to browse</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Supports JSON and Marinara persona exports</p>
          </div>
          <div className="flex gap-2">
            <span className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]">
              <FileJson size="0.75rem" /> .json
            </span>
            <span className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]">
              <FileJson size="0.75rem" /> .marinara
            </span>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.marinara"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        {/* Status */}
        {status === "loading" && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] p-3 text-xs">
            <Loader2 size="0.875rem" className="animate-spin text-[var(--primary)]" />
            Importing...
          </div>
        )}
        {status === "done" && results.length > 0 && (
          <div className="flex flex-col gap-2">
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-xs ${
                results.some((result) => result.success)
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-[var(--destructive)]/10 text-[var(--destructive)]"
              }`}
            >
              {results.some((result) => result.success) ? <CheckCircle size="0.875rem" /> : <XCircle size="0.875rem" />}
              {results.filter((result) => result.success).length} succeeded,{" "}
              {results.filter((result) => !result.success).length} failed
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border)]">
              {results.map((result) => (
                <div
                  key={`${result.filename}-${result.message}`}
                  className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-2 text-xs last:border-b-0"
                >
                  {result.success ? (
                    <CheckCircle size="0.8125rem" className="mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle size="0.8125rem" className="mt-0.5 shrink-0 text-[var(--destructive)]" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">{result.filename}</div>
                    <div className="text-[var(--muted-foreground)]">{result.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end border-t border-[var(--border)] pt-3">
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
