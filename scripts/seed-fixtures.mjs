#!/usr/bin/env node
/**
 * Generates the MockAIProvider's canonical fix patches from checkout-service:
 * for each seeded bug, `git diff bug/<id> main` is the patch that turns the
 * buggy code back into the correct code. Stored in ./fixtures/<id>.patch.
 *
 *   npm run seed:fixtures
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = process.env.APP_PATH ? join(process.cwd(), process.env.APP_PATH) : join(root, '..', 'checkout-service');
const registry = JSON.parse(readFileSync(join(appPath, 'bugs', 'registry.json'), 'utf8'));
const fixturesDir = join(root, 'fixtures');
mkdirSync(fixturesDir, { recursive: true });

for (const bug of registry.bugs) {
  const patch = execSync(`git diff ${bug.branch} main`, { cwd: appPath, encoding: 'utf8' });
  writeFileSync(join(fixturesDir, `${bug.id}.patch`), patch);
  console.log(`• ${bug.id}.patch (${patch.split('\n').length} lines)`);
}
console.log(`\nWrote ${registry.bugs.length} fix fixtures from ${appPath}`);
