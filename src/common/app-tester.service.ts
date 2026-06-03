import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { AgentConfig } from '../config/agent-config';
import { runCommand } from './run-command';
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
 * The cross-repo heart of the agent: builds the app in a worktree, starts it,
 * runs the checkout-e2e (Playwright) suite against the running instance, and
 * parses the result. Used by both detection (on the buggy branch) and
 * validation (on the patched branch).
 */
@Injectable()
export class AppTester {
  private readonly logger = new Logger(AppTester.name);

  constructor(private readonly config: AgentConfig) {}

  async runSuite(worktreePath: string): Promise<SuiteResult> {
    const start = Date.now();

    const buildRes = await runCommand('npm', ['run', 'build'], worktreePath, {
      timeoutMs: 120_000,
      prependPath: [this.config.appBinPath],
    });
    const build: StepResult = { ok: buildRes.ok, durationMs: buildRes.durationMs, output: tail(stripAnsi(buildRes.combined), 30) };
    if (!build.ok) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        build,
        e2e: { ok: false, durationMs: 0, output: 'skipped (build failed)', passed: 0, failed: 0, failures: [] },
      };
    }

    const app = await this.startApp(worktreePath);
    let e2e: E2eResult;
    try {
      e2e = await this.runE2e();
    } finally {
      this.stopApp(app);
    }

    return { ok: build.ok && e2e.ok, durationMs: Date.now() - start, build, e2e };
  }

  private async startApp(worktreePath: string): Promise<ChildProcess> {
    const child = spawn('node', ['dist/main.js'], {
      cwd: worktreePath,
      env: { ...process.env, PORT: String(this.config.appPort) },
    });
    const url = `http://localhost:${this.config.appPort}/health`;
    const deadline = Date.now() + 30_000;
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
    this.stopApp(child);
    throw new Error('app did not become healthy within 30s');
  }

  private stopApp(child: ChildProcess): void {
    try { child.kill(); } catch { /* ignore */ }
  }

  private async runE2e(): Promise<E2eResult> {
    const res = await runCommand('npx', ['playwright', 'test', 'tests/api.spec.ts', '--reporter=json'], this.config.e2ePath, {
      timeoutMs: 120_000,
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
