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

/**
 * Return the appropriate Lucide icon for a file extension.
 *
 * @param ext - Lower-case extension including dot (e.g. ".png", ".mp3")
 * @param className - Optional Tailwind class for styling
 * @param size - Optional icon size
 * @returns A Lucide icon component
 */
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

/**
 * Recursively count files and folders inside a tree node.
 *
 * Used by the delete-confirmation modal to warn how many items
 * a folder contains (including nested sub-folders).
 *
 * @param node - Tree node to count
 * @returns Total number of files + folders under this node
 */
export function countItems(node: TreeNode): number {
  if (node.type === "file") return 1;
  if (!node.children || node.children.length === 0) return 0;
  // Count each child: files are 1, folders are 1 (themselves) + their contents
  return node.children.reduce((sum, child) => {
    return sum + (child.type === "file" ? 1 : 1 + countItems(child));
  }, 0);
}
