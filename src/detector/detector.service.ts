import { Injectable, Logger } from '@nestjs/common';
import { AgentConfig } from '../config/agent-config';
import { GitService } from '../git/git.service';
import { BugRegistryEntry, BugRegistryService } from '../bugs/bug-registry.service';
import { AppTester } from '../common/app-tester.service';
import { tail } from '../common/util';
import { Bug } from '../common/types';

/**
 * Reproduces a bug by running the checkout-e2e suite against the app built from
 * the bug branch (in a throwaway worktree) and emits a structured Bug.
 */
@Injectable()
export class DetectorService {
  private readonly logger = new Logger(DetectorService.name);

  constructor(
    private readonly config: AgentConfig,
    private readonly git: GitService,
    private readonly registry: BugRegistryService,
    private readonly tester: AppTester,
  ) {}

  async detect(entry: BugRegistryEntry, jobId: string): Promise<Bug> {
    const worktree = await this.git.addDetachedWorktree(entry.branch, jobId);
    try {
      const result = await this.tester.runSuite(worktree);
      const failures = result.e2e.failures;
      const matched = failures.find((f) => f === entry.failingTest) ?? failures[0] ?? entry.failingTest;
      const logs = failures.length
        ? `E2E failures: ${failures.join('; ')}\n\n${result.e2e.output}`
        : result.e2e.output;
      if (!failures.length) {
        this.logger.warn(`Detector saw no e2e failure for ${entry.id}; falling back to registry data.`);
      }

      return {
        id: entry.id,
        title: entry.title,
        severity: entry.severity,
        category: entry.category,
        repository: this.registry.repository,
        branch: entry.branch,
        files: entry.files,
        failingTest: matched,
        testFile: entry.testFile,
        description: entry.description,
        logs: tail(logs, 30),
        detectedAt: new Date().toISOString(),
      };
    } finally {
      await this.git.removeWorktree(worktree);
    }
  }
}
