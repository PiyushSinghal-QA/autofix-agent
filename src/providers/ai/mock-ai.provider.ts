import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConfig } from '../../config/agent-config';
import { Bug, FixRequest, FixResponse } from '../../common/types';
import { estimateTokens, sleep } from '../../common/util';
import { AIProvider } from './ai-provider.interface';

const ROOT_CAUSE: Record<string, string> = {
  'missing-null-undefined-check': 'an unchecked lookup is dereferenced, so a miss throws instead of returning 404.',
  'typo-in-property-name': 'a response property is misspelled, so consumers read undefined.',
  'wrong-broken-import-path': 'the wrong module is imported, silently changing behaviour.',
  'missing-input-validation-guard': 'the validation guard is absent, so malformed input is accepted.',
  'unhandled-api-error-missing-try-catch': 'an awaited call is unguarded, so a rejection becomes a 500.',
};

/**
 * Offline, deterministic "AI". Returns the canonical fix patch for each seeded
 * bug (stored as fixtures in this repo) while simulating realistic latency, a
 * streamed reasoning trace, and token accounting — zero cost.
 */
@Injectable()
export class MockAIProvider implements AIProvider {
  readonly name = 'mock' as const;
  private readonly logger = new Logger(MockAIProvider.name);
  private readonly fixturesDir: string;

  constructor(private readonly config: AgentConfig) {
    this.fixturesDir = join(config.agentRoot, 'fixtures');
  }

  async generateFix(request: FixRequest): Promise<FixResponse> {
    const start = Date.now();
    const reasoning: string[] = [];
    const emit = request.onReasoning ?? (() => undefined);
    const think = async (line: string, delayMs: number) => {
      await sleep(delayMs);
      reasoning.push(line);
      emit(line);
    };

    const { bug } = request;
    await think(`Reproduced failing test "${bug.failingTest}" on ${bug.branch}.`, 600);
    await think(`Inspecting ${bug.files.join(', ')} for the root cause.`, 700);
    await think(`Diagnosis [${bug.category}]: ${ROOT_CAUSE[bug.category] ?? bug.description}`, 750);

    let diff: string;
    let filesChanged: string[];
    if (request.mode === 'rogue') {
      await think('Drafting a patch that weakens the failing assertion to force green…', 700);
      diff = this.rogueDiff(bug);
      filesChanged = [bug.testFile];
    } else {
      await think('Composing a minimal patch scoped to the implementation file.', 750);
      diff = this.loadFixture(bug.id);
      filesChanged = bug.files;
    }
    await think('Self-check: 1 file, no dependency changes, behaviour-preserving.', 500);

    const promptApprox = `${bug.title}\n${bug.description}\n${bug.logs}\n${filesChanged.join(',')}`;
    const input = estimateTokens(promptApprox) + 420;
    const output = estimateTokens(diff + reasoning.join('\n'));

    return {
      diff,
      reasoning,
      filesChanged,
      model: 'mock-deterministic-v1',
      provider: 'mock',
      tokenUsage: { input, output, total: input + output },
      latencyMs: Date.now() - start,
    };
  }

  private loadFixture(bugId: string): string {
    const file = join(this.fixturesDir, `${bugId}.patch`);
    if (!existsSync(file)) {
      throw new Error(`Missing fix fixture for "${bugId}" at ${file}. Run: npm run seed:fixtures`);
    }
    return readFileSync(file, 'utf8');
  }

  /** A deliberately disallowed patch (edits a test file) to demo the guard. */
  private rogueDiff(bug: Bug): string {
    return [
      `diff --git a/${bug.testFile} b/${bug.testFile}`,
      `--- a/${bug.testFile}`,
      `+++ b/${bug.testFile}`,
      '@@ -1,2 +1,2 @@',
      '-// assertion as written',
      '+// assertion relaxed to make the failing test pass',
      '',
    ].join('\n');
  }
}
