// ──────────────────────────────────────────────
// File Browser — shared constants (client-only)
// ──────────────────────────────────────────────
import type { ElementType } from "react";
import { Music, Image, Volume2, Wind, Smile } from "lucide-react";

/**
 * Map of category folder names to Lucide icons.
 *
 * Used in the sidebar tree and grid/list views to give each
 * top-level category (music, sfx, ambient, sprites, backgrounds)
 * a distinct visual identity.
 */
export const CATEGORY_ICONS: Record<string, ElementType> = {
  music: Music,
  sfx: Volume2,
  ambient: Wind,
  sprites: Smile,
  backgrounds: Image,
};

/**
 * Default folder descriptions keyed by relative path.
 *
 * The empty-string key represents the root "Game Assets" folder.
 * These are shown as editable hints when a folder has no custom
 * description stored in `meta.json`.
 */
export const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  "": "Game assets folder — music, sfx, ambient audio, sprites, and backgrounds",
  music: "Background music for game states: exploration, dialogue, combat, travel/rest",
  sfx: "Sound effects for UI, combat, and exploration events",
  ambient: "Environmental background audio: nature, urban, interior",
  sprites: "Character and object sprites for visual novel / game modes",
  backgrounds: "Scene backgrounds for roleplay and game modes",
};
