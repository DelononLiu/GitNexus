import type * as acp from '@agentclientprotocol/sdk';
import { AgentManager } from './AgentManager.js';
import { OpenCodeWikiACPClient } from './callbacks.js';
import type { AcpMessageHandler } from './types.js';

function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [acp] [' + level + '] ' + line);
}

export class AcpClient {
  private connection: acp.ClientSideConnection | null = null;
  private agentManager: AgentManager;
  private client: OpenCodeWikiACPClient | null = null;
  private _connected = false;
  private _lastError = '';
  private _cwd = '';

  get connected(): boolean {
    return this._connected;
  }

  get lastError(): string {
    return this._lastError;
  }

  constructor(cwd: string) {
    this._cwd = cwd;
    this.agentManager = new AgentManager();
  }

  async connect(): Promise<boolean> {
    try {
      const sdk = await this.loadSDK();

      const { process, input, output } = await this.agentManager.startAgent('kilo', [
        'acp', '--port', '0', '--cwd', this._cwd,
      ]);

      const stream = sdk.ndJsonStream(input, output);

      this.client = new OpenCodeWikiACPClient();
      this.connection = new sdk.ClientSideConnection(
        () => this.client!,
        stream,
      );

      const initResult = await this.connection.initialize({
        protocolVersion: sdk.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: {
          name: 'opencodewiki',
          title: 'opencodewiki',
          version: '1.0.0',
        },
      });

      this._connected = true;
      log('info', 'ACP connected', { protocolVersion: initResult.protocolVersion });
      return true;
    } catch (err) {
      this._lastError = (err as Error)?.message || String(err);
      log('error', 'ACP connection failed', { error: this._lastError });
      return false;
    }
  }

  async createSession(): Promise<string | null> {
    if (!this.connection) {
      this._lastError = 'ACP not connected';
      return null;
    }

    try {
      const result = await this.connection.newSession({
        cwd: this._cwd,
        mcpServers: [
          {
            name: 'codegraph',
            command: 'npx',
            args: ['codegraph', 'serve', '--mcp', '--no-watch', '--path', this._cwd],
            env: [],
          },
        ],
      });
      return result.sessionId;
    } catch (err) {
      this._lastError = `createSession failed: ${(err as Error)?.message || String(err)}`;
      log('error', this._lastError);
      return null;
    }
  }

  async sendPrompt(sessionId: string, text: string, handler: AcpMessageHandler): Promise<void> {
    if (!this.connection) {
      handler.onError(this._lastError || 'ACP not connected');
      return;
    }

    try {
      this.client?.setSessionHandler(sessionId, handler);

      await this.connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      });

      await this.awaitIdle(300, 60000);
      this.client?.clearSessionHandler(sessionId);

      handler.onDone('end_turn');
    } catch (err: any) {
      handler.onError(err?.message || 'ACP prompt failed');
    }
  }

  async cancel(sessionId: string): Promise<void> {
    if (!this.connection) return;
    try {
      await this.connection.cancel({ sessionId });
    } catch {}
  }

  async closeSession(sessionId: string): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.closeSession({ sessionId });
      } catch {}
    }
  }

  async dispose(): Promise<void> {
    this.client = null;
    this.connection = null;
    this.agentManager.stopAgent();
    this._connected = false;
  }

  private async awaitIdle(idleMs: number, maxMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const lastActivity = this.client?.lastActivityTime ?? 0;
      if (lastActivity > 0) {
        const inactive = Date.now() - lastActivity;
        if (inactive >= idleMs) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async loadSDK(): Promise<typeof acp> {
    return (await import('@agentclientprotocol/sdk')) as typeof acp;
  }
}
