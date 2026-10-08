/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global context holding state for AXON, including active chat session,
 * settings, execution history, navigation, and persistent storage.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import {
  ChatMessage,
  ChatSession,
  ExecutionRecord,
  IntelligenceMode,
  KernelStatus,
  RecentChat,
} from '../types';
import {
  AxonScreen,
  AxonState,
  INITIAL_AXON_STATE,
  saveChatSession,
  loadChatSession,
  loadChatIndex,
  deleteChatSession,
} from './axonState';
import {
  loadPersistedGlobal,
  savePersistedGlobal,
  PERSIST_DEBOUNCE_MS,
} from './storage';
import { sendPromptToAxonBrain } from '../services/axonBrainInterface';

export const INITIAL_REFERENCE_MESSAGES: ChatMessage[] = [
  {
    id: 'ref-user-1',
    role: 'user',
    content: 'How do I build a simple Android app with Kotlin?',
    text: 'How do I build a simple Android app with Kotlin?',
    timestamp: 1714000000000,
  },
  {
    id: 'ref-assistant-1',
    role: 'assistant',
    content: `Absolutely, I can help you build a simple Android app with Kotlin. I'll show you a clean, beginner-friendly setup.`,
    text: `Absolutely, I can help you build a simple Android app with Kotlin. I'll show you a clean, beginner-friendly setup.`,
    leadParagraph: `Absolutely, I can help you build a simple Android app with Kotlin. I'll show you a clean, beginner-friendly setup.`,
    planIntro: `Here is the roadmap we will follow:`,
    planItems: [
      'Set up a new Android project with Kotlin.',
      'Configure Android Studio and your Gradle build files.',
      'Create a simple single-screen user interface.',
      'Run the application on an emulator or a connected device.',
    ],
    hasSources: true,
    suggestionPrompt: 'Would you like the full project structure next, or shall we start with the login screen?',
    timestamp: 1714000010000,
  },
];

interface SettingsState {
  intelligenceMode: IntelligenceMode;
  localComputeAllocation: number;
  dataSovereigntyLocalOnly: boolean;
  developerMode: boolean;
}

const DEFAULT_SETTINGS: SettingsState = {
  intelligenceMode: 'balanced',
  localComputeAllocation: 75,
  dataSovereigntyLocalOnly: false,
  developerMode: false,
};

interface AxonContextType {
  // Navigation & Screens
  currentScreen: AxonScreen;
  setCurrentScreen: (screen: AxonScreen) => void;

  // Tokens Modal
  isTokensModalOpen: boolean;
  setIsTokensModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // User & Model
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  userName: string;
  setUserName: (name: string) => void;

  // Chat Session
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  recents: RecentChat[];
  setRecents: React.Dispatch<React.SetStateAction<RecentChat[]>>;
  newChat: () => void;
  selectRecent: (id: string) => void;
  deleteChat: (id: string) => void;
  appendUserMessage: (text: string) => ChatMessage[];
  appendAssistantMessage: (
    assistantMessage: ChatMessage,
    baseMessages?: ChatMessage[]
  ) => void;

  // Settings & Kernel
  settings: SettingsState;
  updateSettings: (partial: Partial<SettingsState>) => void;
  kernelStatus: KernelStatus;
  history: ExecutionRecord[];
  addExecutionRecord: (record: ExecutionRecord) => void;
  clearHistory: () => void;
  isProcessing: boolean;
}

const AxonStateContext = createContext<AxonContextType | undefined>(undefined);

export const AxonStateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Load persisted initial global slice if present
  const persisted = loadPersistedGlobal();

  const [currentScreen, setCurrentScreen] = useState<AxonScreen>(
    persisted?.currentScreen ?? INITIAL_AXON_STATE.currentScreen
  );
  const [isTokensModalOpen, setIsTokensModalOpen] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>(
    persisted?.selectedModel ?? INITIAL_AXON_STATE.selectedModel
  );
  const [userName, setUserName] = useState<string>(
    persisted?.userName ?? INITIAL_AXON_STATE.userName
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(
    persisted?.activeChatId ?? INITIAL_AXON_STATE.activeChatId
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    persisted?.messages ?? INITIAL_AXON_STATE.messages
  );
  const [recents, setRecents] = useState<RecentChat[]>(
    persisted?.recents ?? INITIAL_AXON_STATE.recents
  );

  const [settings, setSettings] = useState<SettingsState>(() => {
    try {
      const stored = localStorage.getItem('axon_settings');
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [kernelStatus] = useState<KernelStatus>({
    isOnline: true,
    isLocalReady: true,
    activeTasks: 0,
    memoryUsageMB: 124,
    batteryImpact: 'low',
    uptimeSeconds: 0,
  });

  const [history, setHistory] = useState<ExecutionRecord[]>(() => {
    try {
      const stored = localStorage.getItem('axon_exec_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Active chat ID ref for safe async closures
  const activeChatIdRef = useRef<string | null>(activeChatId);
  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // Persist GLOBAL state to storage with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      savePersistedGlobal({
        currentScreen,
        activeChatId,
        recents,
        messages,
        selectedModel,
        userName,
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentScreen, activeChatId, recents, messages, selectedModel, userName]);

  // Update Settings
  const updateSettings = useCallback((partial: Partial<SettingsState>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem('axon_settings', JSON.stringify(next));
      } catch (e) {
        console.warn('Failed to save settings', e);
      }
      return next;
    });
  }, []);

  // Execution History
  const addExecutionRecord = useCallback((record: ExecutionRecord) => {
    setHistory((prev) => {
      const next = [record, ...prev];
      try {
        localStorage.setItem('axon_exec_history', JSON.stringify(next));
      } catch (e) {
        console.warn('Failed to save history', e);
      }
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem('axon_exec_history');
    } catch (e) {
      console.warn('Failed to clear history', e);
    }
  }, []);

  // Reset or Start New Chat
  const newChat = useCallback(() => {
    setActiveChatId(null);
    setMessages([]);
    setRecents((prev) => prev.map((r) => ({ ...r, active: false })));
  }, []);

  // Select a recent chat
  const selectRecent = useCallback((id: string) => {
    const loaded = loadChatSession(id);
    setActiveChatId(id);
    if (loaded && Array.isArray(loaded.messages)) {
      setMessages(loaded.messages);
    } else {
      setRecents((prev) => {
        const found = prev.find((r) => r.id === id);
        if (found) {
          setMessages(found.messages);
        }
        return prev;
      });
    }
    setRecents((prev) =>
      prev.map((r) => ({ ...r, active: r.id === id }))
    );
  }, []);

  // Delete a chat session
  const deleteChat = useCallback((id: string) => {
    deleteChatSession(id);
    setRecents((prev) => prev.filter((r) => r.id !== id));
    if (activeChatIdRef.current === id) {
      setActiveChatId(null);
      setMessages([]);
    }
  }, []);

  // Appending user message
  const appendUserMessage = useCallback(
    (text: string): ChatMessage[] => {
      const trimmed = text.trim();
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        text: trimmed,
        timestamp: Date.now(),
      };

      const targetId = activeChatIdRef.current || `chat-${Date.now()}`;
      if (!activeChatIdRef.current) {
        setActiveChatId(targetId);
      }

      let updatedMessages: ChatMessage[] = [];
      setMessages((prev) => {
        updatedMessages = [...prev, userMsg];
        return updatedMessages;
      });

      // Update recents
      setRecents((prev) => {
        const existing = prev.find((r) => r.id === targetId);
        const title =
          existing?.title ||
          (trimmed.length > 32 ? trimmed.slice(0, 32) + '...' : trimmed || 'New Chat');
        const nextList: RecentChat[] = [
          {
            id: targetId,
            title,
            timestamp: 'Just now',
            active: true,
            messages: updatedMessages,
          },
          ...prev.filter((r) => r.id !== targetId).map((r) => ({ ...r, active: false })),
        ];
        return nextList;
      });

      // Persist session to disk
      const existingSession = loadChatSession(targetId);
      const sessionToSave: ChatSession = {
        id: targetId,
        title:
          existingSession?.title ||
          (trimmed.length > 32 ? trimmed.slice(0, 32) + '...' : trimmed || 'New Chat'),
        createdAt: existingSession?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messages: updatedMessages,
      };
      saveChatSession(sessionToSave);

      return updatedMessages;
    },
    []
  );

  // Appending assistant message
  const appendAssistantMessage = useCallback(
    (assistantMessage: ChatMessage, baseMessages?: ChatMessage[]) => {
      const normalizedReply: ChatMessage = {
        ...assistantMessage,
        content: assistantMessage.content || assistantMessage.text || '',
        text: assistantMessage.text || assistantMessage.content || '',
      };

      const targetId = activeChatIdRef.current;
      if (!targetId) return;

      // Update in-memory messages if this is still the active chat
      setMessages((prev) => {
        const base = baseMessages || prev;
        return [...base, normalizedReply];
      });

      // Persist reply to the session on disk
      const existing = loadChatSession(targetId);
      if (existing) {
        const updated: ChatSession = {
          ...existing,
          messages: [...existing.messages, normalizedReply],
          updatedAt: Date.now(),
        };
        saveChatSession(updated);
      }

      // Update recents
      setRecents((prev) =>
        prev.map((r) => {
          if (r.id === targetId) {
            return {
              ...r,
              messages: [...r.messages, normalizedReply],
              timestamp: 'Just now',
            };
          }
          return r;
        })
      );
    },
    []
  );

  const value: AxonContextType = {
    currentScreen,
    setCurrentScreen,
    isTokensModalOpen,
    setIsTokensModalOpen,
    selectedModel,
    setSelectedModel,
    userName,
    setUserName,
    activeChatId,
    setActiveChatId,
    messages,
    setMessages,
    recents,
    setRecents,
    newChat,
    selectRecent,
    deleteChat,
    appendUserMessage,
    appendAssistantMessage,
    settings,
    updateSettings,
    kernelStatus,
    history,
    addExecutionRecord,
    clearHistory,
    isProcessing,
  };

  return (
    <AxonStateContext.Provider value={value}>
      {children}
    </AxonStateContext.Provider>
  );
};

export function useAxonStateContext() {
  const ctx = useContext(AxonStateContext);
  if (!ctx) {
    throw new Error('useAxonStateContext must be used within an AxonStateProvider');
  }
  return ctx;
}

export function useTokensModal() {
  const ctx = useAxonStateContext();
  return {
    isTokensModalOpen: ctx.isTokensModalOpen,
    openTokensModal: () => ctx.setIsTokensModalOpen(true),
    closeTokensModal: () => ctx.setIsTokensModalOpen(false),
    toggleTokensModal: () => ctx.setIsTokensModalOpen((prev) => !prev),
  };
}

export function useCurrentScreen() {
  const ctx = useAxonStateContext();
  return {
    currentScreen: ctx.currentScreen,
    setCurrentScreen: ctx.setCurrentScreen,
  };
}

export function useChatSession() {
  const ctx = useAxonStateContext();
  return {
    activeChatId: ctx.activeChatId,
    messages: ctx.messages,
    recents: ctx.recents,
    newChat: ctx.newChat,
    selectRecent: ctx.selectRecent,
    deleteChat: ctx.deleteChat,
    appendUserMessage: ctx.appendUserMessage,
    appendAssistantMessage: ctx.appendAssistantMessage,
    setActiveChatId: ctx.setActiveChatId,
    setMessages: ctx.setMessages,
  };
}

export function useSelectedModel() {
  const ctx = useAxonStateContext();
  return {
    selectedModel: ctx.selectedModel,
    setSelectedModel: ctx.setSelectedModel,
  };
}

export function useUserName() {
  const ctx = useAxonStateContext();
  return {
    userName: ctx.userName,
    setUserName: ctx.setUserName,
  };
}
