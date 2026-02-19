/**
 * Booth Brain Types
 *
 * Chat message types, proposed actions, and tool result shapes
 * for the AI reasoning layer.
 */

export type BrainMode = 'confirm' | 'trusted';

export interface BrainConfig {
  enabled: boolean;
  model: string;
  mode: BrainMode;
  manualPath?: string;
}

export interface ChatRequest {
  requestId: string;
  text: string;
}

export interface ProposedAction {
  tool: string;
  args: Record<string, any>;
  label: string;
}

export interface ChatResponse {
  requestId: string;
  text: string;
  actions?: ProposedAction[];
}

export interface ChatExecuted {
  requestId: string;
  actions: ProposedAction[];
  results: string[];
}

export interface ChatError {
  requestId: string;
  error: string;
}

/** Tool execution result returned by tool handlers */
export interface ToolResult {
  success: boolean;
  label: string;
  detail?: string;
}
