// ──────────────────────────────────────────────
// File Browser — utilities (client)
// ──────────────────────────────────────────────
import { File, FileAudio, FileImage, FileText } from "lucide-react";
import { IMAGE_EXTS, AUDIO_EXTS, TEXT_EXTS } from "@marinara-engine/shared";
import type { TreeNode } from "../../hooks/use-game-assets";

export function isImage(ext?: string) {
  return IMAGE_EXTS.has(ext ?? "");
}

export function isAudio(ext?: string) {
  return AUDIO_EXTS.has(ext ?? "");
}

export function isEditableText(ext?: string) {
  return TEXT_EXTS.has(ext ?? "");
}

/** Returns the appropriate lucide icon component for a file extension. */
export function FileIcon({
  ext,
  className,
  size,
}: {
  ext?: string;
  className?: string;
  size?: string | number;
}) {
  if (isImage(ext)) {
    return <FileImage className={className} size={size} />;
  }
  if (isAudio(ext)) {
    return <FileAudio className={className} size={size} />;
  }
  if (isEditableText(ext)) {
    return <FileText className={className} size={size} />;
  }
  return <File className={className} size={size} />;
}

/** Recursively count files and folders inside a tree node (used for delete confirmation). */
export function countItems(node: TreeNode): number {
  if (node.type === "file") return 1;
  // Count the folder itself plus all descendants
  const self = 1;
  if (!node.children || node.children.length === 0) return self;
  return self + node.children.reduce((sum, child) => sum + countItems(child), 0);
}
