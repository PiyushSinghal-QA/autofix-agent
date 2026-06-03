import { Injectable } from '@nestjs/common';
import { AppTester } from '../common/app-tester.service';
import { ValidationResult, ValidationStep } from '../common/types';

/**
 * Validates a patched worktree by building it and running the checkout-e2e
 * suite against it. The agent never touches the tests (they live in another
 * repo), so a "fix" that breaks behaviour is caught here, not masked.
 */
@Injectable()
export class ValidationService {
  constructor(private readonly tester: AppTester) {}

  async validate(
    worktreePath: string,
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

    const e2e: ValidationStep = {
      name: 'e2e',
      ok: result.e2e.ok,
      skipped: !result.build.ok,
      durationMs: result.e2e.durationMs,
      exitCode: result.e2e.ok ? 0 : 1,
      output: result.e2e.failures.length
        ? `failed: ${result.e2e.failures.join(', ')}`
        : `${result.e2e.passed} passed`,
    };
    steps.push(e2e);
    onStep?.(e2e);

    return { ok: result.ok, durationMs: Date.now() - start, steps };
  }
}
