const DIALOGUE_QUOTE_PAIRS = [
  ['"', '"'],
  ['\u201c', '\u201d'],
  ['\u00ab', '\u00bb'],
  ['\u300c', '\u300d'],
  ['\u300e', '\u300f'],
] as const;

export const DIALOGUE_QUOTE_PATTERN_SOURCE =
  '"[^"]+"|\u201c[^\u201d]+\u201d|\u00ab[^\u00bb]+\u00bb|\u300c[^\u300d]+\u300d|\u300e[^\u300f]+\u300f';

export const DIALOGUE_QUOTE_CAPTURE_GROUP_PATTERN_SOURCE =
  '"([^"]+)"|\u201c([^\u201d]+)\u201d|\u00ab([^\u00bb]+)\u00bb|\u300c([^\u300d]+)\u300d|\u300e([^\u300f]+)\u300f';

export const HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE =
  '"[^"<>]+"|\u201c[^\u201d<>]+\u201d|\u00ab[^\u00bb<>]+\u00bb|\u300c[^\u300d<>]+\u300d|\u300e[^\u300f<>]+\u300f';

export function stripSurroundingDialogueQuotes(content: string): string {
  if (content.length < 2) return content;

  for (const [open, close] of DIALOGUE_QUOTE_PAIRS) {
    if (content.startsWith(open) && content.endsWith(close)) {
      return content.slice(open.length, content.length - close.length);
    }
  }

  return content;
}