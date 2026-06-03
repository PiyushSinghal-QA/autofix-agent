import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  combined: string;
  durationMs: number;
}

export interface RunOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Directories prepended to PATH so hoisted .bin shims resolve in worktrees. */
  prependPath?: string[];
}

/** Build an env whose PATH (case-insensitive on Windows) is prefixed with extra dirs. */
function envWithPath(extra: string[] = [], overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  if (extra.length) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[key] = [...extra, env[key] || ''].join(delimiter);
  }
  return env;
}

/**
 * Spawns a command and fully captures stdout/stderr. Never rejects — failures
 * are reported via `ok`/`exitCode` so callers can branch instead of try/catch.
 */
export function runCommand(command: string, args: string[], cwd: string, opts: RunOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let combined = '';

    // On Windows npm/npx/nest are .cmd shims that need a shell. Fold args into a
    // single command string (instead of passing an args array with shell:true)
    // to avoid Node's "args with shell" deprecation warning.
    const env = envWithPath(opts.prependPath, opts.env);
    const onWindows = process.platform === 'win32';
    const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a);
    const child = onWindows
      ? spawn([command, ...args.map(quote)].join(' '), [], { cwd, env, shell: true })
      : spawn(command, args, { cwd, env, shell: false });

    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;

    child.stdout?.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      combined += s;
    });
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      combined += s;
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, stdout, stderr, combined, durationMs: Date.now() - start });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const msg = `\n[spawn error] ${String(err)}`;
      resolve({ ok: false, exitCode: null, stdout, stderr: stderr + msg, combined: combined + msg, durationMs: Date.now() - start });
    });
  });
}
