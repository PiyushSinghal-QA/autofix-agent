import { Injectable } from '@nestjs/common';
import { AppTester } from '../common/app-tester.service';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { Bug, ValidationResult, ValidationStep } from '../common/types';

/**
 * Validates a patched worktree by building it and running the checkout-e2e
 * suite against it.
 *
 * `main` carries every seeded defect, so one fix can't turn the whole suite
 * green. The gate therefore is: the build passes, the target bug's failing test
 * now PASSES, and every test still failing maps to another KNOWN seeded defect
 * — i.e. the patch fixed its bug and regressed nothing. The agent never edits
 * the tests (they live in another repo), so a behaviour break shows up here.
 */
@Injectable()
export class ValidationService {
  constructor(
    private readonly tester: AppTester,
    private readonly registry: BugRegistryService,
  ) {}

  async validate(
    worktreePath: string,
    bug: Bug,
    onStep?: (step: ValidationStep) => void,
  ): Promise<ValidationResult> {
    const start = Date.now();
    const result = await this.tester.runSuite(worktreePath);
    const steps: ValidationStep[] = [];

    const build: ValidationStep = {
      name: 'build',
      ok: result.build.ok,
      durationMs: result.build.durationMs,
      exitCode: result.build.ok ? 0 : 1,
      output: result.build.output,
    };
    steps.push(build);
    onStep?.(build);

    const failures = result.e2e.failures;
    const knownDefectTests = new Set(this.registry.list().map((b) => b.failingTest));
    const targetFixed = !failures.includes(bug.failingTest);
    const regressions = failures.filter((f) => !knownDefectTests.has(f));
    const e2eOk = result.build.ok && targetFixed && regressions.length === 0;

    const output = !result.build.ok
      ? 'skipped (build failed)'
      : regressions.length
        ? `regression — unexpected failing test(s): ${regressions.join(', ')}`
        : !targetFixed
          ? `target test still failing: "${bug.failingTest}"`
          : `fixed "${bug.failingTest}"` +
            (failures.length
              ? ` · ${failures.length} other known defect(s) still open on main`
              : ' · suite fully green');

    const e2e: ValidationStep = {
      name: 'e2e',
      ok: e2eOk,
      skipped: !result.build.ok,
      durationMs: result.e2e.durationMs,
      exitCode: e2eOk ? 0 : 1,
      output,
    };
    steps.push(e2e);
    onStep?.(e2e);

    return { ok: build.ok && e2eOk, durationMs: Date.now() - start, steps };
  }
}
