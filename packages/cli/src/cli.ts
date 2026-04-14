/**
 * Chromatopsia CLI Core
 *
 * Responsible for:
 * - TTY detection and management
 * - Signal handling (SIGINT, SIGTERM)
 * - Process lifecycle
 * - Agent Core bootstrap
 */

import { EventEmitter } from 'events';
import type { ReplOptions } from '@chromatopsia/agent';
import { run_repl } from '@chromatopsia/agent';

export type CLIEvents = 'exit' | 'error' | 'signal' | 'ready';

export interface CLIConfig {
  workingDirectory?: string;
  configPath?: string;
  debug?: boolean;
}

/**
 * TTY Context Manager
 * Detects and manages terminal interaction capabilities
 */
export class TTYContext {
  private isTTY: boolean;
  private stdin: NodeJS.ReadStream;
  private stdout: NodeJS.WriteStream;
  private stderr: NodeJS.WriteStream;

  constructor() {
    this.stdin = process.stdin;
    this.stdout = process.stdout;
    this.stderr = process.stderr;

    // Detect if we're running in an interactive terminal
    this.isTTY = this.stdin.isTTY === true && this.stdout.isTTY === true;
  }

  get isInteractive(): boolean {
    return this.isTTY;
  }

  get isPiped(): boolean {
    return !this.isTTY;
  }

  write(data: string): void {
    this.stdout.write(data);
  }

  writeLine(data: string): void {
    this.stdout.write(data + '\n');
  }

  writeError(data: string): void {
    this.stderr.write(`[error] ${data}\n`);
  }

  writeDebug(data: string, debug?: boolean): void {
    if (debug) {
      this.stderr.write(`[debug] ${data}\n`);
    }
  }
}

/**
 * Signal Handler
 * Graceful shutdown on SIGINT, SIGTERM, etc.
 */
export class SignalHandler extends EventEmitter {
  constructor(private tty: TTYContext, private debug?: boolean) {
    super();
    this.setupSignalHandlers();
  }

  private setupSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

    for (const signal of signals) {
      process.on(signal, () => {
        this.tty.writeDebug(`Received ${signal}, gracefully shutting down...`, this.debug);
        this.emit('signal', signal);
        this.cleanup();
      });
    }

    process.on('uncaughtException', (err) => {
      this.tty.writeError(`Uncaught exception: ${err.message}`);
      this.emit('error', err);
      this.cleanup();
    });

    process.on('unhandledRejection', (reason) => {
      this.tty.writeError(`Unhandled rejection: ${reason}`);
      this.emit('error', new Error(String(reason)));
      this.cleanup();
    });
  }

  async cleanup(): Promise<void> {
    this.tty.writeDebug('Cleaning up resources...', this.debug);
    process.exit(0);
  }
}

/**
 * Chromatopsia CLI
 * Bridge between TTY and Agent Core
 */
export class ChromatopsiaCLI extends EventEmitter {
  private tty: TTYContext;
  private isRunning: boolean = false;
  private config: CLIConfig;

  constructor(config: CLIConfig = {}) {
    super();
    this.config = {
      workingDirectory: process.cwd(),
      debug: false,
      ...config,
    };
    this.tty = new TTYContext();
    // SignalHandler registers global process listeners; keep reference to prevent GC
    new SignalHandler(this.tty, this.config.debug);
  }

  /**
   * Check if environment is suitable for interactive REPL
   */
  canRunInteractiveREPL(): boolean {
    if (!this.tty.isInteractive) {
      this.tty.writeError('REPL requires an interactive terminal (TTY).');
      return false;
    }
    return true;
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.tty.writeError('CLI is already running.');
      return;
    }

    this.isRunning = true;

    try {
      if (!this.canRunInteractiveREPL()) {
        process.exit(1);
      }

      this.tty.writeDebug('Starting Chromatopsia CLI...', this.config.debug);
      let streamedThisTurn = false;

      // Bootstrap Agent Core REPL
      const replOptions: ReplOptions = {
        working_dir: this.config.workingDirectory || process.cwd(),
        logLevel: this.config.debug ? 'debug' : 'error',
        on_exit: () => this.onREPLExit(),
        events: {
          onNotification: (message: string) => {
            this.tty.writeLine(`[info] ${message}`);
          },
          onError: (message: string) => {
            this.tty.writeError(message);
          },
          onDebug: (message: string) => {
            this.tty.writeDebug(message, this.config.debug);
          },
          onStreamChunk: (chunk: string) => {
            streamedThisTurn = true;
            this.tty.write(chunk);
          },
          onToolStart: (toolCall) => {
            this.tty.writeLine(`[tool] Running ${toolCall.name}...`);
          },
          onToolEnd: (toolCall, result) => {
            const status = result.success ? 'ok' : 'failed';
            this.tty.writeLine(`[tool] ${toolCall.name}: ${status}`);
            if (!result.success && result.output) {
              this.tty.writeLine(`[tool] ${toolCall.name} error: ${result.output}`);
            }
          },
          onTurnComplete: (message: string) => {
            if (!streamedThisTurn) {
              this.tty.writeLine(message);
            } else if (message && !message.endsWith('\n')) {
              this.tty.writeLine('');
            }
            streamedThisTurn = false;
          },
        },
      };

      // Run the Agent core REPL (pure library)
      const repl = await run_repl(replOptions);
      await repl.start();

      this.emit('exit', 0);
    } catch (err) {
      this.tty.writeError(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
      this.emit('error', err);
      this.emit('exit', 1);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Called when Agent Core REPL exits
   */
  private onREPLExit(): void {
    this.tty.writeDebug('REPL exited.', this.config.debug);
    this.emit('ready');
  }
}
