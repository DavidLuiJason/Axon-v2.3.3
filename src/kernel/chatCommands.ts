/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chat commands: the bridge between a chat message and the execution kernel.
 * Returns a reply when the message is a known command (or the answer to a
 * follow-up question), and null when it is not, so the Brain can carry on.
 * Every reply states which task produced it and how it ended.
 */

import type { ChatMessage } from '../types';
import { getAxonEngine } from './axonEngine';
import {
  resolveCommand,
  type CountUnit,
  type PendingAsk,
} from './resolver';
import type { TaskEngine } from './taskEngine';
import type { TextCounts } from './textCount';

let pending: PendingAsk | null = null;

/** Forgets any open follow-up question. Used by tests. */
export function resetChatCommands(): void {
  pending = null;
}

export interface ChatCommandDeps {
  engine?: TaskEngine;
  now?: () => number;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeCounts(c: TextCounts, unit: CountUnit): string {
  const details =
    `Words: ${c.words}\n` +
    `Characters: ${c.characters} (${c.charactersNoSpaces} without spaces)\n` +
    `Letters: ${c.letters}\n` +
    `Lines: ${c.lines}`;
  let headline: string;
  switch (unit) {
    case 'words':
      headline = `That text has ${plural(c.words, 'word', 'words')}.`;
      break;
    case 'characters':
      headline = `That text has ${plural(c.characters, 'character', 'characters')} (${c.charactersNoSpaces} without spaces).`;
      break;
    case 'letters':
      headline = `That text has ${plural(c.letters, 'letter', 'letters')}.`;
      break;
    case 'lines':
      headline = `That text has ${plural(c.lines, 'line', 'lines')}.`;
      break;
    default:
      headline = 'Here are the counts for that text:';
  }
  return `${headline}\n\n${details}`;
}

function reply(content: string, at: number): ChatMessage {
  return {
    id: `axon-${at}`,
    role: 'assistant',
    content,
    hasSources: false,
    timestamp: at,
  };
}

export async function handleChatCommand(
  message: string,
  deps: ChatCommandDeps = {}
): Promise<ChatMessage | null> {
  const now = deps.now ?? Date.now;
  const engine = deps.engine ?? getAxonEngine();
  const at = now();

  const resolution = resolveCommand(message, pending, at);

  if (resolution.kind === 'none') {
    return null;
  }

  if (resolution.kind === 'cancel') {
    pending = null;
    return reply('Okay, cancelled. Nothing was counted.', at);
  }

  if (resolution.kind === 'ask') {
    pending = resolution.pending;
    return reply(resolution.question, at);
  }

  pending = null;
  const submitted = await engine.submit(resolution.actionId, resolution.input);
  if (!submitted.ok) {
    const why =
      submitted.reason === 'insufficient-resources'
        ? `This device cannot do that right now: ${(submitted.blockers ?? []).join('; ')}.`
        : `I could not start that (${submitted.reason}).`;
    return reply(why, at);
  }

  const done = await engine.whenDone(submitted.task.id);
  if (done.state !== 'COMPLETED') {
    return reply(
      `The count did not finish. Task ${done.id} ended ${done.state}${done.error ? `: ${done.error}` : ''}.`,
      at
    );
  }

  const counts = done.output as TextCounts;
  const ms =
    done.startedAt !== undefined && done.endedAt !== undefined
      ? Math.max(0, done.endedAt - done.startedAt)
      : 0;
  const body = describeCounts(counts, resolution.input.unit);
  return reply(`${body}\n\nRan as task ${done.id}: ${done.state} in ${ms} ms, counted from your exact text.`, at);
}
