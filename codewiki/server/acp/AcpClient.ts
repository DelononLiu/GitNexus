import type * as acp from '@agentclientprotocol/sdk';
import { AgentManager } from './AgentManager.js';
import { CodeWikiACPClient } from './callbacks.js';
import type { AcpMessageHandler } from './types.js';

function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [acp] [' + level + '] ' + line);
}

export class AcpClient {
  private connection: acp.ClientSideConnection | null = null;
  private agentManager: AgentManager;
  private client: CodeWikiACPClient | null = null;
  private sessionId: string | null = null;
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

      this.client = new CodeWikiACPClient();
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
          name: 'codewiki',
          title: 'CodeWiki',
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

  async ensureSession(cwd?: string): Promise<string | null> {
    if (!this.connection) {
      this._lastError = 'ACP not connected';
      return null;
    }

    if (this.sessionId) {
      try {
        await this.connection.resumeSession({
          sessionId: this.sessionId,
          cwd: cwd ?? this._cwd,
        });
        return this.sessionId;
      } catch {
        log('warn', 'resumeSession failed, creating new session');
      }
    }

    try {
      const result = await this.connection.newSession({
        cwd: cwd ?? this._cwd,
        mcpServers: [],
      });
      this.sessionId = result.sessionId;
      return this.sessionId;
    } catch (err) {
      this._lastError = `createSession failed: ${(err as Error)?.message || String(err)}`;
      log('error', this._lastError);
      return null;
    }
  }

  private _busy = false;

  async sendPrompt(text: string, handler: AcpMessageHandler): Promise<void> {
    if (this._busy) {
      handler.onError('Another prompt is already in progress on this session');
      return;
    }

    const sid = this.sessionId;
    if (!this.connection || !sid) {
      handler.onError(this._lastError || 'ACP session not ready');
      return;
    }

    this._busy = true;
    try {
      this.client?.setSessionHandler(handler);

      const result = await this.connection.prompt({
        sessionId: sid,
        prompt: [{ type: 'text', text }],
      });

      await this.awaitIdle(300, 60000);
      this.client?.clearSessionHandler();

      handler.onDone(result.stopReason || 'end_turn');
    } catch (err: any) {
      handler.onError(err?.message || 'ACP prompt failed');
    } finally {
      this._busy = false;
    }
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    try {
      await this.connection.cancel({ sessionId: this.sessionId });
    } catch {}
  }

  async closeSession(): Promise<void> {
    if (this.connection && this.sessionId) {
      try {
        await this.connection.closeSession({ sessionId: this.sessionId });
      } catch {}
    }
    this.sessionId = null;
  }

  async dispose(): Promise<void> {
    await this.closeSession();
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
