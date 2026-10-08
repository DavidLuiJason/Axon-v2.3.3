/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single active chat session, with an in-memory index of saved chats.
 * Chats are saved on change and reloaded when opened.
 */

import { ChatMessage, ChatSession, RecentChat } from '../types';

export type AxonScreen =
  | 'chat'
  | 'axon-source'
  | 'interface-capture'
  | 'axon-tools'
  | 'axon-build'
  | 'background-proof';

export interface GlobalState {
  currentScreen: AxonScreen;
  activeChatId: string | null;
  recents: RecentChat[];
  messages: ChatMessage[];
  selectedModel: string;
  userName: string;
}

export interface ChatSessionMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

export interface AxonState extends GlobalState {
  isTokensModalOpen: boolean;
  currentChatId?: string | null;
  chatList?: ChatSessionMetadata[];
}

export const INITIAL_AXON_STATE: AxonState = {
  currentScreen: 'chat',
  activeChatId: null,
  recents: [],
  messages: [],
  selectedModel: 'gemini-1.5-flash',
  userName: 'David',
  isTokensModalOpen: false,
  currentChatId: null,
  chatList: [],
};

const CHATS_STORAGE_KEY_PREFIX = 'axon_chat_session_';
const CHAT_INDEX_KEY = 'axon_chat_index';

export function getChatStorageKey(chatId: string): string {
  return `${CHATS_STORAGE_KEY_PREFIX}${chatId}`;
}

export function saveChatSession(session: ChatSession): void {
  try {
    const raw = JSON.stringify(session);
    localStorage.setItem(getChatStorageKey(session.id), raw);
    updateChatIndex(session);
  } catch (e) {
    console.error('Failed to save chat session', e);
  }
}

export function loadChatSession(chatId: string): ChatSession | null {
  try {
    const raw = localStorage.getItem(getChatStorageKey(chatId));
    if (!raw) return null;
    return JSON.parse(raw) as ChatSession;
  } catch (e) {
    console.error('Failed to load chat session', e);
    return null;
  }
}

export function deleteChatSession(chatId: string): void {
  try {
    localStorage.removeItem(getChatStorageKey(chatId));
    const index = loadChatIndex();
    const updated = index.filter((item) => item.id !== chatId);
    localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to delete chat session', e);
  }
}

export function loadChatIndex(): ChatSessionMetadata[] {
  try {
    const raw = localStorage.getItem(CHAT_INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSessionMetadata[];
  } catch (e) {
    console.error('Failed to load chat index', e);
    return [];
  }
}

function updateChatIndex(session: ChatSession): void {
  try {
    const index = loadChatIndex();
    const existingIndex = index.findIndex((item) => item.id === session.id);
    const firstUserMsg = session.messages.find((m: ChatMessage) => m.role === 'user');
    const lastMsg = session.messages[session.messages.length - 1];

    const userText = firstUserMsg ? (firstUserMsg.content || firstUserMsg.text || '') : '';
    const lastText = lastMsg ? (lastMsg.content || lastMsg.text || '') : '';

    const title =
      session.title ||
      (userText
        ? userText.slice(0, 30) + (userText.length > 30 ? '...' : '')
        : 'New Chat');

    const preview = lastText ? lastText.slice(0, 60) : '';

    const metadata: ChatSessionMetadata = {
      id: session.id,
      title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt || Date.now(),
      preview,
    };

    if (existingIndex >= 0) {
      index[existingIndex] = metadata;
    } else {
      index.unshift(metadata);
    }

    index.sort((a, b) => b.updatedAt - a.updatedAt);
    localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.error('Failed to update chat index', e);
  }
}

/**
 * Pure helper for tests and callers that need to append a message to a session.
 * Keeps timestamps and message array consistent.
 */
export function appendMessageToSession(
  session: ChatSession,
  message: ChatMessage
): ChatSession {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: Math.max(session.updatedAt || 0, message.timestamp || Date.now()),
  };
}
