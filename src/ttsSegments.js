export const DEFAULT_TTS_SEGMENT_RULES = {
  maxChars: 180, // Google Translate TTS limit ~200 chars; keep margin
  commaSoftLimit: 50,
  pauseMs: 180,
  sentenceRegex: /[^。！？；：!?;:\n]+[。！？；：!?;:\n]?/g,
  clauseRegex: /[^，、,]+[，、,]?/g,
};

function splitByLength(text, maxChars) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

/** Strip emoji and common non-speech symbols from text */
function stripEmoji(text) {
  // Remove emoji (Unicode emoji ranges + variation selectors + ZWJ sequences)
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // transport & map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')     // misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')     // dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')     // variation selectors
    .replace(/[\u{200D}]/gu, '')              // zero width joiner
    .replace(/[\u{20E3}]/gu, '')              // combining enclosing keycap
    .replace(/[\u{E0020}-\u{E007F}]/gu, '')   // tags
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // supplemental symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')   // chess symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // symbols extended-A
    .replace(/[\u{231A}-\u{231B}]/gu, '')     // watch, hourglass
    .replace(/[\u{23E9}-\u{23F3}]/gu, '')     // media controls
    .replace(/[\u{23F8}-\u{23FA}]/gu, '')     // media controls
    .replace(/[\u{25AA}-\u{25AB}]/gu, '')     // squares
    .replace(/[\u{25B6}]/gu, '')              // play
    .replace(/[\u{25C0}]/gu, '')              // reverse
    .replace(/[\u{25FB}-\u{25FE}]/gu, '')     // squares
    .replace(/\*\*|__|~~|```|`/g, '')         // markdown formatting
    .replace(/#{1,6}\s/g, '')                 // markdown headers
    .replace(/\s{2,}/g, ' ')                  // collapse whitespace
    .trim();
}

export function splitTextForTTS(text, rules = DEFAULT_TTS_SEGMENT_RULES) {
  const input = stripEmoji(String(text || '')).trim();
  if (!input) return [];

  const sentences = input.match(rules.sentenceRegex) || [input];
  const segments = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (trimmed.length <= rules.maxChars) {
      segments.push(trimmed);
      continue;
    }

    const clauses = trimmed.match(rules.clauseRegex) || [trimmed];
    let buffer = '';

    for (const clause of clauses) {
      const piece = clause.trim();
      if (!piece) continue;

      if (!buffer) {
        buffer = piece;
        continue;
      }

      if ((buffer + piece).length <= Math.max(rules.commaSoftLimit, rules.maxChars)) {
        buffer += piece;
      } else {
        if (buffer.length > rules.maxChars) {
          segments.push(...splitByLength(buffer, rules.maxChars));
        } else {
          segments.push(buffer);
        }
        buffer = piece;
      }
    }

    if (buffer) {
      if (buffer.length > rules.maxChars) {
        segments.push(...splitByLength(buffer, rules.maxChars));
      } else {
        segments.push(buffer);
      }
    }
  }

  return segments.filter(Boolean);
}
