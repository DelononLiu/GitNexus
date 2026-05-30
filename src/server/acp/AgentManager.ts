import { spawn, ChildProcess } from 'child_process';
import { Writable, Readable } from 'stream';

export interface AgentProcess {
  process: ChildProcess;
  input: WritableStream<Uint8Array>;
  output: ReadableStream<Uint8Array>;
}

export class AgentManager {
  private process: ChildProcess | null = null;

  async startAgent(command: string, args: string[] = []): Promise<AgentProcess> {
    if (this.process) this.stopAgent();

    const agentProcess = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env },
    });

    this.process = agentProcess;

    const input = Writable.toWeb(agentProcess.stdin!) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(agentProcess.stdout!) as ReadableStream<Uint8Array>;

    agentProcess.on('exit', (code) => {
      console.error(`[acp] Agent process exited with code ${code}`);
      this.process = null;
    });

    agentProcess.on('error', (err) => {
      console.error('[acp] Agent process error:', err);
      this.process = null;
    });

    return { process: agentProcess, input, output };
  }

  stopAgent(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 3000);
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.process.exitCode === null;
  }
}
