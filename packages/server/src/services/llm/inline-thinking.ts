const XML_THINKING_BLOCK_RE = /^(\s*)<(think|thinking|thought)>([\s\S]*?)<\/\2>/i;
const PIPE_THINKING_BLOCK_RE = /^(\s*)<\|think\|>([\s\S]*?)<\|\/think\|>/i;
const CHANNEL_THINKING_BLOCK_RE = /^(\s*)<\|channel>thought\b([\s\S]*?)<channel\|>/i;

export interface LeadingThinkingExtraction {
  content: string;
  thinking: string;
  stripped: boolean;
}

/**
 * Extract leading inline reasoning blocks that some models emit instead of
 * returning provider-native thinking channels.
 */
export function extractLeadingThinkingBlocks(text: string): LeadingThinkingExtraction {
  let remaining = text;
  let stripped = false;
  const chunks: string[] = [];

  while (true) {
    const xmlMatch = remaining.match(XML_THINKING_BLOCK_RE);
    if (xmlMatch) {
      stripped = true;
      const thinking = xmlMatch[3]?.trim();
      if (thinking) chunks.push(thinking);
      remaining = remaining.slice(xmlMatch[0].length).trimStart();
      continue;
    }

    const pipeMatch = remaining.match(PIPE_THINKING_BLOCK_RE);
    if (pipeMatch) {
      stripped = true;
      const thinking = pipeMatch[2]?.trim();
      if (thinking) chunks.push(thinking);
      remaining = remaining.slice(pipeMatch[0].length).trimStart();
      continue;
    }

    const channelMatch = remaining.match(CHANNEL_THINKING_BLOCK_RE);
    if (channelMatch) {
      stripped = true;
      const thinking = channelMatch[2]?.trim();
      if (thinking) chunks.push(thinking);
      remaining = remaining.slice(channelMatch[0].length).trimStart();
      continue;
    }

    break;
  }

  return {
    content: remaining,
    thinking: chunks.join("\n\n"),
    stripped,
  };
}
