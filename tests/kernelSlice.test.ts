/**
 * Text Counter slice tests: counting, command resolver, chat bridge, Brain hook.
 */
import { countText } from '../src/kernel/textCount';
import { resolveCommand, PENDING_TTL_MS, TEXT_QUESTION } from '../src/kernel/resolver';
import type { Resolution, PendingAsk } from '../src/kernel/resolver';
import { handleChatCommand, resetChatCommands } from '../src/kernel/chatCommands';
import { createAxonEngine } from '../src/kernel/axonEngine';
import { sendQueryToAxonBoundary } from '../src/services/axonBrainInterface';

let checks = 0;
function assert(cond: boolean, msg: string) {
  checks += 1;
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  OK: ${msg}`);
}

function run(message: string, pending: PendingAsk | null = null, now = 1000): Resolution {
  return resolveCommand(message, pending, now);
}

function runsWith(message: string, text: string, unit: string): boolean {
  const r = run(message);
  return r.kind === 'run' && r.input.text === text && r.input.unit === unit;
}

async function main() {
  console.log('=== text counter slice tests ===');

  console.log('-- countText');
  assert(JSON.stringify(countText('')) === JSON.stringify({ characters: 0, charactersNoSpaces: 0, letters: 0, words: 0, lines: 0 }), 'empty text counts as zero everywhere');
  const hello = countText('Hello brave new world');
  assert(hello.words === 4 && hello.characters === 21 && hello.charactersNoSpaces === 18 && hello.letters === 18 && hello.lines === 1, 'plain sentence counted exactly');
  assert(countText('  many   spaces   here  ').words === 3, 'extra spaces do not create words');
  assert(countText('one\ntwo\nthree').lines === 3, 'three lines');
  assert(countText('one\ntwo\n').lines === 2, 'a final line break does not add a line');
  assert(countText('\n').lines === 1, 'a lone line break is one line');
  assert(countText('a\r\nb\rc').lines === 3, 'Windows and old Mac line breaks counted');
  assert(countText('\u{1F600}\u{1F600}').characters === 2, 'an emoji counts as one character');
  assert(countText('caf\u00e9 na\u00efve').letters === 9, 'accented letters count as letters');
  assert(countText('well-known don\'t').words === 2, 'hyphenated and contracted words are single words');
  assert(countText('12 + 34 = 46').letters === 0, 'digits and symbols are not letters');

  console.log('-- resolver: commands that run');
  assert(runsWith('count words in hello brave new world', 'hello brave new world', 'words'), 'count words in <text>');
  assert(runsWith('Count the characters of Good morning', 'Good morning', 'characters'), 'count the characters of <text>, case kept');
  assert(runsWith('how many words are in the quick brown fox', 'the quick brown fox', 'words'), 'how many words are in <text>');
  assert(runsWith('how many lines in a b', 'a b', 'lines'), 'how many lines in <text>');
  assert(runsWith('please count letters in abc def', 'abc def', 'letters'), 'polite lead-in');
  assert(runsWith('can you count words in: one two', 'one two', 'words'), 'colon after in');
  assert(runsWith('count words: red green blue', 'red green blue', 'words'), 'count words: <text>');
  assert(runsWith('word count: red green', 'red green', 'words'), 'word count: <text>');
  assert(runsWith('character count of hi there', 'hi there', 'characters'), 'character count of <text>');
  assert(runsWith('count words in "quoted text here"', 'quoted text here', 'words'), 'surrounding quotes removed');
  assert(runsWith('count words in this text: alpha beta', 'alpha beta', 'words'), '"this text:" label removed');
  assert(runsWith('count words in line one\nline two', 'line one\nline two', 'words'), 'line breaks in the text are kept');
  assert(runsWith('count chars in abc', 'abc', 'characters'), 'chars shorthand');

  console.log('-- resolver: follow-up questions');
  const ask1 = run('count words');
  assert(ask1.kind === 'ask' && ask1.question === TEXT_QUESTION && ask1.pending.unit === 'words', 'count words with no text asks a question');
  const ask2 = run('how many characters are in this sentence?');
  assert(ask2.kind === 'ask' && ask2.pending.unit === 'characters', '"this sentence" is not text, so AXON asks for the text');
  const ask3 = run('word count');
  assert(ask3.kind === 'ask', 'word count with nothing after it asks');
  const pending: PendingAsk = { actionId: 'text.count', unit: 'words', askedAt: 1000 };
  const answered = run('The rain in Spain', pending, 1000 + 5000);
  assert(answered.kind === 'run' && answered.input.text === 'The rain in Spain' && answered.input.unit === 'words', 'the next message is taken as the text, with the remembered unit');
  assert(run('cancel', pending, 2000).kind === 'cancel', 'cancel closes the question');
  assert(run('Never mind', pending, 2000).kind === 'cancel', 'never mind closes the question');
  assert(run('The rain in Spain', pending, 1000 + PENDING_TTL_MS + 1).kind === 'none', 'an old question has expired');
  const override = run('count lines in x\ny', pending, 2000);
  assert(override.kind === 'run' && override.input.unit === 'lines' && override.input.text === 'x\ny', 'a new full command beats an open question');
  assert(run('cancel', null).kind === 'none', 'cancel with no open question is just a message');

  console.log('-- resolver: things that are not commands');
  for (const msg of ['hello', 'count me in', 'can you count in French?', 'how many words can you write', 'what is a word', 'count on me', 'describe axon ui', '   ', 'count']) {
    assert(run(msg).kind === 'none', `not a command: "${msg.trim() || '(blank)'}"`);
  }

  console.log('-- chat bridge on a real engine');
  {
    resetChatCommands();
    const engine = createAxonEngine();
    const r = await handleChatCommand('count words in hello brave new world', { engine });
    assert(r !== null && r.role === 'assistant', 'a command gets an assistant reply');
    assert(r!.content.startsWith('That text has 4 words.'), 'headline gives the answer');
    assert(r!.content.includes('Words: 4') && r!.content.includes('Characters: 21 (18 without spaces)'), 'detail lines included');
    assert(/Ran as task task-1: COMPLETED in \d+ ms/.test(r!.content), 'reply names the real task and how it ended');
    assert(engine.getTask('task-1')?.state === 'COMPLETED', 'the task really exists and completed');
    assert(engine.getTask('task-1')?.evidence.some((e) => e.event === 'completed') === true, 'the task carries its own evidence');
    assert(!r!.content.includes('hello brave new world'), 'the reply does not echo the text back');
  }
  {
    resetChatCommands();
    const engine = createAxonEngine();
    const a = await handleChatCommand('how many characters are in this sentence?', { engine });
    assert(a !== null && a.content === TEXT_QUESTION, 'follow-up question asked');
    assert(engine.listTasks().length === 0, 'asking a question creates no task');
    const b = await handleChatCommand('Good morning', { engine });
    assert(b !== null && b.content.startsWith('That text has 12 characters (11 without spaces).'), 'the next message is counted with the remembered unit');
    const c = await handleChatCommand('Good morning', { engine });
    assert(c === null, 'after the answer, the question is closed');
  }
  {
    resetChatCommands();
    const engine = createAxonEngine();
    await handleChatCommand('count words', { engine });
    const cancelled = await handleChatCommand('cancel', { engine });
    assert(cancelled !== null && cancelled.content.startsWith('Okay, cancelled.'), 'cancel is acknowledged');
    assert((await handleChatCommand('some words here', { engine })) === null, 'after cancel the next message is ordinary');
  }
  {
    resetChatCommands();
    let t = 5000;
    const engine = createAxonEngine();
    await handleChatCommand('count words', { engine, now: () => t });
    t += PENDING_TTL_MS + 10;
    assert((await handleChatCommand('late answer', { engine, now: () => t })) === null, 'an expired follow-up is not used');
  }
  {
    resetChatCommands();
    const engine = createAxonEngine();
    const all = await handleChatCommand('word count: a b', { engine });
    assert(all !== null && all.content.startsWith('That text has 2 words.'), 'singular and plural wording');
    const one = await handleChatCommand('count lines in single', { engine });
    assert(one !== null && one.content.startsWith('That text has 1 line.'), 'one line, not "1 lines"');
  }
  {
    resetChatCommands();
    const blocked = createAxonEngine({
      readProfile: async () => ({
        takenAt: 0,
        memoryGb: { known: true, value: 1 },
        cpuCores: { known: false },
        storageFreeBytes: { known: false },
        storageQuotaBytes: { known: false },
        batteryPercent: { known: false },
        charging: { known: false },
      }),
    });
    // text.count declares no resource needs, so even a 1 GB device runs it.
    const r = await handleChatCommand('count words in tiny old phone test', { engine: blocked });
    assert(r !== null && r.content.startsWith('That text has 4 words.'), 'a light action runs on a 1 GB device profile');
  }

  console.log('-- Brain hook');
  {
    resetChatCommands();
    const cmd = await sendQueryToAxonBoundary('count words in one two three');
    assert(cmd.content.startsWith('That text has 3 words.'), 'the Brain answers a command from the kernel');
    const normal = await sendQueryToAxonBoundary('hello there');
    assert(normal.content.includes("AXON's intelligence layer isn't online yet"), 'any other message still gets the honest foundation reply');
    const layout = await sendQueryToAxonBoundary('describe axon ui');
    assert(layout.content.includes('Chat / Web / Apps switch'), 'the layout reply is unchanged');
  }

  console.log(`=== text counter slice tests passed: ${checks} checks ===`);
}

let timer: ReturnType<typeof setTimeout> | undefined;
const watchdog = new Promise<never>((_, reject) => {
  timer = setTimeout(() => reject(new Error('FAIL: slice tests hung (a promise never settled)')), 8000);
});

Promise.race([main(), watchdog]).then(
  () => {
    clearTimeout(timer);
  },
  (err) => {
    clearTimeout(timer);
    console.error(err);
    throw err;
  }
);
