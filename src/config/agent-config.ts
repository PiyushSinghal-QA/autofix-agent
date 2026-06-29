import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { TargetCommands, loadTargetCommands } from './target-commands';

export type AiProviderName = 'mock' | 'claude';

/**
 * Typed view over the environment. The agent is target-agnostic — point it at
 * any app + test suite + GitHub repo via env:
 *   - appPath  : the target app the agent fixes     (APP_PATH)
 *   - e2ePath  : the target's black-box test suite   (E2E_PATH)
 *   - agentRoot: this repo (the tool itself)
 * The sample checkout-service/checkout-e2e are just one example target.
 */
@Injectable()
export class AgentConfig {
  private readonly logger = new Logger(AgentConfig.name);

  readonly aiProvider: AiProviderName;
  readonly dryRun: boolean;
  readonly port: number;
  readonly agentRoot: string;
  readonly appPath: string;
  readonly e2ePath: string;
  readonly appPort: number;
  readonly worktreeRoot: string;
  readonly appBinPath: string;
  readonly target: TargetCommands;
  readonly commitAuthorName: string;
  readonly commitAuthorEmail: string;

  readonly anthropicApiKey?: string;
  readonly anthropicModel: string;
  readonly trello: { apiKey?: string; token?: string; boardId?: string; listId?: string; webhookSecret?: string };
  readonly github: { token?: string; owner: string; repo: string; defaultReviewer?: string };

  constructor() {
    const env = process.env;
    this.aiProvider = env.AI_PROVIDER === 'claude' ? 'claude' : 'mock';
    this.dryRun = env.DRY_RUN !== 'false';
    this.port = env.PORT ? Number(env.PORT) : 4000;
    this.agentRoot = resolve(__dirname, '..', '..');
    this.appPath = this.resolveDir(env.APP_PATH, '../target-app', 'package.json');
    this.e2ePath = this.resolveDir(env.E2E_PATH, '../target-tests', 'playwright.config.ts');
    this.appPort = env.APP_PORT ? Number(env.APP_PORT) : 3100;
    this.worktreeRoot = join(this.appPath, '.agent-worktrees');
    this.appBinPath = join(this.appPath, 'node_modules', '.bin');
    // How to install/build/serve/test the target — defaults to Node/Playwright,
    // overridden by an autofix.config.json the target ships (e.g. a PHP app).
    this.target = loadTargetCommands(this.appPath);
    // The agent owns its commit identity so fixes are attributable and commits
    // never fail on environments without an ambient git user (e.g. CI runners).
    this.commitAuthorName = env.GIT_AUTHOR_NAME || 'AutoFix Agent';
    this.commitAuthorEmail = env.GIT_AUTHOR_EMAIL || 'autofix-agent@users.noreply.github.com';

    this.anthropicApiKey = env.ANTHROPIC_API_KEY || undefined;
    this.anthropicModel = env.ANTHROPIC_MODEL || 'claude-opus-4-8';
    this.trello = {
      apiKey: env.TRELLO_API_KEY || undefined,
      token: env.TRELLO_TOKEN || undefined,
      boardId: env.TRELLO_BOARD_ID || undefined,
      listId: env.TRELLO_LIST_ID || undefined,
      webhookSecret: env.TRELLO_WEBHOOK_SECRET || undefined,
    };
    this.github = {
      token: env.GITHUB_TOKEN || undefined,
      owner: env.GITHUB_OWNER || '',
      repo: env.GITHUB_REPO || '',
      defaultReviewer: env.GITHUB_DEFAULT_REVIEWER || undefined,
    };
  }

  private resolveDir(fromEnv: string | undefined, fallback: string, marker: string): string {
    const tries = [
      fromEnv && resolve(process.cwd(), fromEnv),
      resolve(process.cwd(), fallback),
      resolve(this.agentRoot, fallback),
    ].filter(Boolean) as string[];
    for (const t of tries) if (existsSync(join(t, marker))) return t;
    this.logger.warn(`Could not locate ${marker} (tried ${tries.join(', ')}); defaulting to ${tries[0]}.`);
    return tries[0];
  }

  summary(): Record<string, string> {
    return { AI_PROVIDER: this.aiProvider, DRY_RUN: String(this.dryRun), appPath: this.appPath, e2ePath: this.e2ePath };
  }
}
