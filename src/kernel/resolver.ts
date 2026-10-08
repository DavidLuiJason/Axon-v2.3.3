/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AXON deterministic command resolver (kernel stage K3, first version).
 * Turns a chat message into "run this action with these inputs", or asks one
 * follow-up question when an input is missing. No language intelligence: a
 * message that does not match a known phrasing is not a command.
 */

export type CountUnit = 'words' | 'characters' | 'letters' | 'lines' | 'all';

export interface PendingAsk {
  actionId: 'text.count';
  unit: CountUnit;
  askedAt: number;
}

export type Resolution =
  | { kind: 'none' }
  | { kind: 'cancel' }
  | { kind: 'run'; actionId: 'text.count'; input: { text: string; unit: CountUnit } }
  | { kind: 'ask'; actionId: 'text.count'; question: string; pending: PendingAsk };

/** How long a follow-up question stays open. */
export const PENDING_TTL_MS = 120_000;

export const TEXT_QUESTION =
  'What text should I count? Paste or type it and send it. (Say "cancel" to stop.)';

const UNIT = '(words?|characters?|chars?|letters?|lines?)';
const LEAD = '(?:please\\s+|can you\\s+|could you\\s+)?';
const FLAGS = 'i';

const PATTERNS: RegExp[] = [
  // count words in <text> / count the characters of <text>
  new RegExp(`^${LEAD}count\\s+(?:the\\s+)?${UNIT}\\s+(?:in|of)\\b\\s*([\\s\\S]*)$`, FLAGS),
  // how many words are in <text> / how many lines in <text>
  new RegExp(`^${LEAD}how\\s+many\\s+${UNIT}\\s+(?:(?:are|is|do|does)\\s+)?(?:there\\s+)?(?:in|of)\\b\\s*([\\s\\S]*)$`, FLAGS),
  // count words / count words: <text>
  new RegExp(`^${LEAD}count\\s+(?:the\\s+)?${UNIT}\\s*(?:[:\\-]\\s*([\\s\\S]*))?$`, FLAGS),
  // word count / word count: <text> / character count of <text>
  new RegExp(`^${LEAD}(word|character|char|letter|line)\\s+count\\b\\s*(?:of|in|for)?\\s*[:\\-]?\\s*([\\s\\S]*)$`, FLAGS),
];

const DEICTIC = new Set([
  'this', 'this text', 'this sentence', 'this message', 'this paragraph',
  'that', 'that text', 'the text', 'the following', 'the following text',
  'following', 'following text', 'it', 'the above', 'above',
]);

const CANCEL_WORDS = new Set(['cancel', 'stop', 'never mind', 'nevermind', 'forget it', 'no']);

function toUnit(word: string | undefined): CountUnit {
  if (!word) return 'all';
  const w = word.toLowerCase();
  if (w.startsWith('word')) return 'words';
  if (w.startsWith('char')) return 'characters';
  if (w.startsWith('letter')) return 'letters';
  if (w.startsWith('line')) return 'lines';
  return 'all';
}

function stripQuotes(text: string): string {
  const pairs: Array<[string, string]> = [['"', '"'], ["'", "'"], ['\u201c', '\u201d'], ['\u2018', '\u2019']];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Removes a leading "this text:" style label, then reports what is left. */
function cleanText(raw: string): string {
  const rest = raw.replace(/^\s*:\s*/, '');
  const withoutLabel = rest.replace(
    /^(?:this text|this|the following text|the following|the text|following text|following)\s*[:\-]\s*/i,
    ''
  );
  return stripQuotes(withoutLabel.trim());
}

function parseCommand(message: string): { unit: CountUnit; text: string | null } | null {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(message);
    if (!m) continue;
    // Every pattern has the unit word as group 1 and the text (if any) as group 2.
    const unitWord = m[1];
    const rest = m[2] ?? '';
    const cleaned = cleanText(rest);
    const isMissing = cleaned === '' || DEICTIC.has(cleaned.toLowerCase().replace(/[?.!]+$/, ''));
    return { unit: toUnit(unitWord), text: isMissing ? null : cleaned };
  }
  return null;
}

export function resolveCommand(
  message: string,
  pending: PendingAsk | null,
  now: number
): Resolution {
  const trimmed = message.trim();
  if (trimmed === '') return { kind: 'none' };

  const open = pending && now - pending.askedAt <= PENDING_TTL_MS ? pending : null;

  if (open && CANCEL_WORDS.has(trimmed.toLowerCase())) return { kind: 'cancel' };

  const parsed = parseCommand(trimmed);
  if (parsed) {
    if (parsed.text !== null) {
      return { kind: 'run', actionId: 'text.count', input: { text: parsed.text, unit: parsed.unit } };
    }
    return {
      kind: 'ask',
      actionId: 'text.count',
      question: TEXT_QUESTION,
      pending: { actionId: 'text.count', unit: parsed.unit, askedAt: now },
    };
  }

  if (open) {
    return {
      kind: 'run',
      actionId: 'text.count',
      input: { text: stripQuotes(trimmed), unit: open.unit },
    };
  }

  return { kind: 'none' };
}
