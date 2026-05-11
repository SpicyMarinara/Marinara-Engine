// ──────────────────────────────────────────────
// File Browser — shared constants (client-only)
// ──────────────────────────────────────────────
import type { ElementType } from "react";
import { Music, Image, Volume2, Wind, Smile } from "lucide-react";

/** Category folder → lucide icon used in tree + grid. */
export const CATEGORY_ICONS: Record<string, ElementType> = {
  music: Music,
  sfx: Volume2,
  ambient: Wind,
  sprites: Smile,
  backgrounds: Image,
};

/** Default folder descriptions, keyed by `selectedPath`. Empty key = root. */
export const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  "": "Game assets folder — music, sfx, ambient audio, sprites, and backgrounds",
  music: "Background music for game states: exploration, dialogue, combat, travel/rest",
  sfx: "Sound effects for UI, combat, and exploration events",
  ambient: "Environmental background audio: nature, urban, interior",
  sprites: "Character and object sprites for visual novel / game modes",
  backgrounds: "Scene backgrounds for roleplay and game modes",
};
