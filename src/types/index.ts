/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  badge?: string;
  description: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  text?: string;
  leadParagraph?: string;
  planIntro?: string;
  planItems?: string[];
  hasSources?: boolean;
  suggestionPrompt?: string;
  timestamp: number;
}

export interface RecentChat {
  id: string;
  title: string;
  timestamp: string;
  active?: boolean;
  messages: ChatMessage[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type ViewMode = 'welcome' | 'conversation';

export type AxonMode = 'chat' | 'web' | 'apps';

export type IntelligenceMode = 'speed' | 'balanced' | 'deep' | 'local';

export interface ExecutionRecord {
  id: string;
  title: string;
  timestamp: number;
  status: 'completed' | 'failed' | 'cancelled';
  durationMs?: number;
  actionId?: string;
}

export interface KernelStatus {
  isOnline: boolean;
  isLocalReady: boolean;
  activeTasks: number;
  memoryUsageMB: number;
  batteryImpact: 'low' | 'medium' | 'high';
  uptimeSeconds: number;
}
