// ──────────────────────────────────────────────
// Prompt Service — Public exports
// ──────────────────────────────────────────────
export { assemblePrompt, type AssemblerInput, type AssemblerOutput } from "./assembler.js";
export { wrapContent, wrapGroup } from "./format-engine.js";
export { expandMarker, type MarkerContext, type ExpandedMarker } from "./marker-expander.js";
export {
  buildPromptMacroContext,
  collectCharacterDepthPromptEntries,
  resolveMacrosWithVariableSnapshot,
  resolveCharacterMacroData,
  type CharacterMacroData,
  type MacroResolutionTransaction,
  type PromptDepthEntry,
} from "./macro-context.js";
export { mergeAdjacentMessages, squashLeadingSystemMessages } from "./merger.js";
export { getCharacterDescriptionWithExtensions } from "./character-description-extensions.js";
