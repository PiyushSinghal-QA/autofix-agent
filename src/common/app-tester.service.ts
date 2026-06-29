import { Injectable, Logger } from '@nestjs/common';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { AgentConfig } from '../config/agent-config';
import { TargetCommands } from '../config/target-commands';
import { runShell } from './run-command';
import { sleep, stripAnsi, tail } from './util';

export interface StepResult {
  ok: boolean;
  durationMs: number;
  output: string;
}

export interface E2eResult extends StepResult {
  passed: number;
  failed: number;
  failures: string[];
}

export interface SuiteResult {
  ok: boolean;
  durationMs: number;
  build: StepResult;
  e2e: E2eResult;
}

/**
 * The cross-repo heart of the agent: prepares the app in a worktree (install +
 * build), starts it, runs the target's Playwright suite against the running
 * instance, and parses the result. Every step is driven by the target's
 * `autofix.config.json` (Node/Playwright defaults), so the same flow works for a
 * Node app or a PHP/Symfony app — only the commands differ.
 */
@Injectable()
export class AppTester {
  private readonly logger = new Logger(AppTester.name);

  constructor(private readonly config: AgentConfig) {}

  async runSuite(worktreePath: string): Promise<SuiteResult> {
    const start = Date.now();
    const t = this.config.target;

    const build = await this.prepare(worktreePath, t);
    if (!build.ok) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        build,
        e2e: { ok: false, durationMs: 0, output: 'skipped (prepare failed)', passed: 0, failed: 0, failures: [] },
      };
    }

    const app = await this.startApp(worktreePath, t);
    let e2e: E2eResult;
    try {
      e2e = await this.runE2e(t);
    } finally {
      await this.stopApp(app, worktreePath, t);
    }

    return { ok: build.ok && e2e.ok, durationMs: Date.now() - start, build, e2e };
  }

  /** install (optional) then build, in the app worktree. Reported as the "build" step. */
  private async prepare(worktreePath: string, t: TargetCommands): Promise<StepResult> {
    const start = Date.now();
    const opts = { prependPath: [this.config.appBinPath] };
    let combined = '';

    if (t.install && t.install.trim()) {
      const r = await runShell(this.sub(t.install), worktreePath, { ...opts, timeoutMs: 300_000 });
      combined += r.combined;
      if (!r.ok) return { ok: false, durationMs: Date.now() - start, output: tail(stripAnsi(combined), 30) };
    }
    if (t.build && t.build.trim()) {
      const r = await runShell(this.sub(t.build), worktreePath, { ...opts, timeoutMs: 180_000 });
      combined += r.combined;
      if (!r.ok) return { ok: false, durationMs: Date.now() - start, output: tail(stripAnsi(combined), 30) };
    }
    return { ok: true, durationMs: Date.now() - start, output: tail(stripAnsi(combined), 30) || 'prepared' };
  }

  private async startApp(worktreePath: string, t: TargetCommands): Promise<ChildProcess> {
    const child = spawn(this.sub(t.serve), [], {
      cwd: worktreePath,
      env: { ...process.env, PORT: String(this.config.appPort) },
      shell: true,
      // POSIX: own process group so we can kill the whole tree on teardown.
      detached: process.platform !== 'win32',
    });

    const url = `http://localhost:${this.config.appPort}${t.healthPath}`;
    const deadline = Date.now() + t.startTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`app exited early (code ${child.exitCode})`);
      try {
        const res = await fetch(url);
        if (res.ok) return child;
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    await this.stopApp(child, worktreePath, t);
    throw new Error(`app did not become healthy within ${Math.round(t.startTimeoutMs / 1000)}s at ${url}`);
  }

  /** Stop the app — explicit `stop` command if given, else kill the process tree. */
  private async stopApp(child: ChildProcess, worktreePath: string, t: TargetCommands): Promise<void> {
    if (t.stop && t.stop.trim()) {
      await runShell(this.sub(t.stop), worktreePath, { timeoutMs: 60_000 }).catch(() => undefined);
      return;
    }
    const pid = child.pid;
    try {
      if (pid && process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
      } else if (pid) {
        process.kill(-pid, 'SIGTERM'); // kill the process group (detached)
      } else {
        child.kill();
      }
    } catch {
      try { child.kill(); } catch { /* ignore */ }
    }
  }

  private async runE2e(t: TargetCommands): Promise<E2eResult> {
    const res = await runShell(this.sub(t.test), this.config.e2ePath, {
      timeoutMs: 180_000,
      prependPath: [join(this.config.e2ePath, 'node_modules', '.bin')],
      env: { BASE_URL: `http://localhost:${this.config.appPort}` },
    });

    const report = this.safeJson(res.stdout);
    const failures: string[] = [];
    let passed = 0;
    let failed = 0;
    const walk = (suite: any) => {
      (suite?.suites || []).forEach(walk);
      for (const spec of suite?.specs || []) {
        if (spec.ok) passed += 1;
        else { failed += 1; failures.push(spec.title); }
      }
    };
    (report?.suites || []).forEach(walk);

    const stats = report?.stats;
    const ok = stats ? stats.unexpected === 0 && stats.expected > 0 : failures.length === 0 && passed > 0;
    return { ok, durationMs: res.durationMs, output: tail(stripAnsi(res.combined), 30), passed, failed, failures };
  }

  /** Substitute `${PORT}` in a target command with the configured app port. */
  private sub(cmd: string): string {
    return cmd.replace(/\$\{PORT\}/g, String(this.config.appPort));
  }

  private safeJson(stdout: string): any {
    try {
      return JSON.parse(stdout);
    } catch {
      const a = stdout.indexOf('{');
      const b = stdout.lastIndexOf('}');
      if (a >= 0 && b > a) {
        try { return JSON.parse(stdout.slice(a, b + 1)); } catch { return null; }
      }
      return null;
    }
  }
}
