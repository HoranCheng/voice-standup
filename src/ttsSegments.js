export const DEFAULT_TTS_SEGMENT_RULES = {
  maxChars: 120,
  commaSoftLimit: 36,
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

export function splitTextForTTS(text, rules = DEFAULT_TTS_SEGMENT_RULES) {
  const input = String(text || '').trim();
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
