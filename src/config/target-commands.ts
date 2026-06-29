import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How to install, run and test the TARGET app. Read from
 * `<APP_PATH>/autofix.config.json` so each target declares its own commands and
 * the agent stays language-agnostic. Absent (e.g. the Node demo) → the defaults
 * below. `${PORT}` is substituted with APP_PORT and also set in the environment.
 *
 * Example (Symfony):
 * {
 *   "install": "composer install --no-interaction --no-progress",
 *   "build":   "",
 *   "serve":   "php -S 127.0.0.1:${PORT} -t public",
 *   "healthPath": "/health",
 *   "startTimeoutMs": 60000,
 *   "test": "npx playwright test --reporter=json"
 * }
 */
export interface TargetCommands {
  /** Optional: run in the app worktree before build (e.g. "composer install"). */
  install?: string;
  /** Run in the app worktree; "" to skip (PHP often needs no build). */
  build: string;
  /** Start the app; `${PORT}` substituted and also set in env. */
  serve: string;
  /** Readiness probe: GET http://localhost:<APP_PORT><healthPath>. */
  healthPath: string;
  /** How long to wait for the app to become healthy (ms). */
  startTimeoutMs: number;
  /** Optional teardown (e.g. "docker compose down"); else the process is killed. */
  stop?: string;
  /** Run in E2E_PATH; BASE_URL is set to the app. Must emit Playwright JSON. */
  test: string;
}

export const DEFAULT_TARGET: TargetCommands = {
  build: 'npm run build',
  serve: 'node dist/main.js',
  healthPath: '/health',
  startTimeoutMs: 30_000,
  test: 'npx playwright test --reporter=json',
};

/** Load the target's autofix.config.json (if any), merged over the defaults. */
export function loadTargetCommands(appPath: string): TargetCommands {
  const file = join(appPath, 'autofix.config.json');
  if (!existsSync(file)) return { ...DEFAULT_TARGET };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<TargetCommands>;
    return { ...DEFAULT_TARGET, ...parsed };
  } catch {
    return { ...DEFAULT_TARGET };
  }
}
