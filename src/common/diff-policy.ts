import { countChanges, parseDiffPaths } from './diff';

export interface PolicyVerdict {
  ok: boolean;
  violations: string[];
  filesChanged: string[];
  additions: number;
  deletions: number;
}

export const MAX_FILES = 3;

const DEP_MANIFESTS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

const TEST_DIR_RE = /(^|\/)(test|tests|__tests__)\//i;
const SPEC_FILE_RE = /\.(spec|e2e-spec|test)\.[tj]sx?$/i;

/**
 * Enforces the PRD guardrails on any proposed patch BEFORE it is applied:
 *   - at most 3 files changed
 *   - no dependency-manifest edits
 *   - no test edits (the agent must never weaken tests to force a green run)
 */
export function evaluateDiff(diff: string): PolicyVerdict {
  const filesChanged = parseDiffPaths(diff);
  const { additions, deletions } = countChanges(diff);
  const violations: string[] = [];

  if (filesChanged.length === 0) {
    violations.push('Patch contains no recognisable file changes.');
  }
  if (filesChanged.length > MAX_FILES) {
    violations.push(`Patch touches ${filesChanged.length} files (limit is ${MAX_FILES}).`);
  }
  for (const file of filesChanged) {
    const base = file.split('/').pop() || file;
    if (DEP_MANIFESTS.has(base)) {
      violations.push(`Patch modifies a dependency manifest (${file}); dependency changes are not allowed.`);
    }
    if (TEST_DIR_RE.test(file) || SPEC_FILE_RE.test(file)) {
      violations.push(`Patch edits a test file (${file}); the agent may not modify tests to force a pass.`);
    }
  }

  return { ok: violations.length === 0, violations, filesChanged, additions, deletions };
}
