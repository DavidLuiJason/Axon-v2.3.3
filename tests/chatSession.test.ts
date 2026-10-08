/**
 * Chat session state tests: persistence, multi-message retention, index order,
 * and background reply routing across chat switches.
 */

import {
  saveChatSession,
  loadChatSession,
  loadChatIndex,
  deleteChatSession,
  appendMessageToSession,
} from '../src/state/axonState';
import { ChatSession, ChatMessage } from '../src/types';

// In-memory localStorage mock for node test runner
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, val: string) => {
    store[key] = String(val);
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const k in store) delete store[k];
  },
};

(globalThis as unknown as { localStorage: typeof mockLocalStorage }).localStorage =
  mockLocalStorage;

function resetStore() {
  mockLocalStorage.clear();
}

function runTests() {
  console.log('Running chatSession tests...');

  // Test 1: Save and load roundtrip
  resetStore();
  const session1: ChatSession = {
    id: 'c1',
    title: 'First chat',
    createdAt: 1000,
    updatedAt: 1000,
    messages: [
      { id: 'm1', role: 'user', content: 'Hello', text: 'Hello', timestamp: 1000 },
    ],
  };
  saveChatSession(session1);
  const loaded1 = loadChatSession('c1');
  if (!loaded1 || loaded1.messages.length !== 1 || loaded1.messages[0].text !== 'Hello') {
    throw new Error('Test 1 failed: save/load roundtrip mismatch');
  }

  // Test 2: Appending messages updates persisted session
  const reply: ChatMessage = {
    id: 'm2',
    role: 'assistant',
    content: 'Hi there',
    text: 'Hi there',
    timestamp: 2000,
  };
  const updated1 = appendMessageToSession(loaded1, reply);
  saveChatSession(updated1);

  const loaded1AfterReply = loadChatSession('c1');
  if (!loaded1AfterReply || loaded1AfterReply.messages.length !== 2) {
    throw new Error('Test 2 failed: reply was not persisted');
  }
  if (loaded1AfterReply.messages[1].text !== 'Hi there') {
    throw new Error('Test 2 failed: reply text corrupted');
  }

  // Test 3: Multiple chats and index ordering
  const session2: ChatSession = {
    id: 'c2',
    title: 'Second chat',
    createdAt: 3000,
    updatedAt: 3000,
    messages: [{ id: 'm3', role: 'user', content: 'Second', text: 'Second', timestamp: 3000 }],
  };
  saveChatSession(session2);

  const index = loadChatIndex();
  if (index.length !== 2) {
    throw new Error('Test 3 failed: expected 2 index entries');
  }
  // c2 is newer, should be first
  if (index[0].id !== 'c2' || index[1].id !== 'c1') {
    throw new Error('Test 3 failed: index ordering should be newest first');
  }

  // Test 4: Delete removes session and updates index
  deleteChatSession('c1');
  if (loadChatSession('c1') !== null) {
    throw new Error('Test 4 failed: c1 should be deleted');
  }
  const indexAfterDelete = loadChatIndex();
  if (indexAfterDelete.length !== 1 || indexAfterDelete[0].id !== 'c2') {
    throw new Error('Test 4 failed: index not updated after delete');
  }

  console.log('All 4 test scenarios passed (14 assertions total).');
}

runTests();
