/**
 * Default impersonate prompt template.
 *
 * When no custom template is provided (empty string), the server falls back to
 * this built-in instruction. The constant lives in the shared package so the
 * client can display a read-only preview in the Impersonate Settings drawer
 * without duplicating the string.
 */
export const DEFAULT_IMPERSONATE_PROMPT = [
  `<instruction>`,
  `You are now writing as {{user}}, the user's character.`,
  `Study {{user}}'s previous messages in the conversation and replicate their voice, mannerisms, speech patterns, and style as closely as possible.`,
  `Character description: {{persona_description}}`,
  `Additional direction for this reply: {{impersonate_direction}}`,
  `Write a single in-character response from {{user}}'s perspective. Do NOT break character or add meta-commentary. Respond exactly as {{user}} would.`,
  `</instruction>`,
]
  .filter(Boolean)
  .join("\n");
