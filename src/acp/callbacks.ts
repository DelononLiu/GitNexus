import type * as acp from '@agentclientprotocol/sdk';
import type { AcpMessageHandler } from './types.js';
import type { ServerResponse } from 'http';

function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [acp] [' + level + '] ' + line);
}

export class CodeWikiACPClient implements acp.Client {
  private sessionHandlers = new Map<string, AcpMessageHandler>();
  private _lastActivityTime = 0;

  get lastActivityTime(): number {
    return this._lastActivityTime;
  }

  setSessionHandler(sessionId: string, handler: AcpMessageHandler) {
    this.sessionHandlers.set(sessionId, handler);
    this._lastActivityTime = Date.now();
  }

  clearSessionHandler(sessionId: string) {
    this.sessionHandlers.delete(sessionId);
  }

  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    return {
      outcome: {
        outcome: 'selected',
        optionId: params.options[0]?.optionId || 'allow-once',
      },
    };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this._lastActivityTime = Date.now();
    const sessionId = (params as any).sessionId;
    const handler = sessionId ? this.sessionHandlers.get(sessionId) : null;
    if (!handler) return;

    const update = params.update;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          handler.onText(update.content.text);
        }
        break;
      case 'tool_call':
        handler.onToolCall?.(
          update.toolCallId,
          update.title ?? 'tool',
          update.kind ?? 'other',
          update.status ?? 'pending',
        );
        break;
      case 'tool_call_update':
        handler.onToolCallUpdate?.(
          update.toolCallId,
          update.status ?? 'pending',
          update.content?.[0] && 'text' in update.content[0]
            ? (update.content[0] as any).text
            : undefined,
          update.title,
          update.kind,
        );
        break;
      case 'plan':
        handler.onPlan?.(update.entries);
        break;
      case 'agent_thought_chunk':
        if (update.content.type === 'text') {
          handler.onReasoning?.(update.content.text);
        }
        break;
    }
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    log('warn', 'writeTextFile called but CodeWiki is read-only', { path: params.path });
    return {};
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    log('warn', 'readTextFile called but CodeWiki session has no filesystem context', { path: params.path });
    return { content: '' };
  }
}

export function sseWrite(res: ServerResponse, data: Record<string, unknown>): void {
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}
