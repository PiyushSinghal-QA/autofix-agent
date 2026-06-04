import { Injectable } from '@nestjs/common';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { JobStore } from '../pipeline/job-store.service';
import { GitService } from '../git/git.service';
import { AppTester } from '../common/app-tester.service';
import { AnalysisService } from '../analysis/analysis.service';
import { Severity } from '../common/types';

export type BugHealthStatus = 'open' | 'in-progress' | 'fix-proposed' | 'pr-open' | 'resolved';

export interface BugHealth {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  branch: string;
  failingTest: string;
  status: BugHealthStatus;
  jobId?: string;
  pr?: { number: number; url: string } | null;
}

export interface BaselineScan {
  ok: boolean;
  passed: number;
  total: number;
  durationMs: number;
  at: string;
}

export interface HealthSnapshot {
  repository: string;
  total: number;
  open: number;
  inProgress: number;
  proposed: number;
  prOpen: number;
  resolved: number;
  score: number;
  status: 'healthy' | 'degraded' | 'critical' | 'recovering';
  bySeverity: { high: number; medium: number; low: number };
  bugs: BugHealth[];
  baseline?: BaselineScan;
}

/**
 * At-a-glance health. The FRAMEWORK is the source of truth for "resolved": a bug
 * only counts resolved once a pushed run that exercised its branch comes back
 * green (which also means it re-opens if it regresses). A merged-but-unverified
 * PR shows as "pr-open", never "fixed".
 */
@Injectable()
export class HealthService {
  private lastScan?: BaselineScan;

  constructor(
    private readonly registry: BugRegistryService,
    private readonly store: JobStore,
    private readonly git: GitService,
    private readonly tester: AppTester,
    private readonly analysis: AnalysisService,
  ) {}

  snapshot(): HealthSnapshot {
    const jobs = this.store.list();
    const bugs: BugHealth[] = this.registry.list().map((b) => {
      const job = jobs.find((j) => j.bugId === b.id);
      const fwReport = this.analysis.latestReportForBranch(b.branch);
      // The framework ran this branch and did NOT flag the bug → genuinely resolved.
      const fwResolved = !!fwReport && !fwReport.detected.some((d) => d.bugId === b.id);

      let status: BugHealthStatus;
      if (fwResolved) status = 'resolved';
      else if (job?.status === 'running') status = 'in-progress';
      else if (job?.status === 'awaiting-approval') status = 'fix-proposed';
      else if (job?.status === 'succeeded') status = 'pr-open'; // PR opened, not yet verified by the framework
      else status = 'open';

      return {
        id: b.id, title: b.title, severity: b.severity, category: b.category,
        branch: b.branch, failingTest: b.failingTest, status,
        jobId: job?.jobId,
        pr: job?.pullRequest ? { number: job.pullRequest.number, url: job.pullRequest.url } : null,
      };
    });

    const count = (s: BugHealthStatus) => bugs.filter((b) => b.status === s).length;
    const open = count('open');
    const inProgress = count('in-progress');
    const proposed = count('fix-proposed');
    const prOpen = count('pr-open');
    const resolved = count('resolved');
    const total = bugs.length;

    const active = bugs.filter((b) => b.status === 'open' || b.status === 'in-progress');
    const bySeverity = {
      high: active.filter((b) => b.severity === 'high').length,
      medium: active.filter((b) => b.severity === 'medium').length,
      low: active.filter((b) => b.severity === 'low').length,
    };

    const score = total ? Math.round((resolved / total) * 100) : 100;
    let status: HealthSnapshot['status'];
    if (open + inProgress === 0) status = resolved === total ? 'healthy' : 'recovering';
    else if (bySeverity.high > 0) status = 'critical';
    else status = 'degraded';

    return { repository: this.registry.repository, total, open, inProgress, proposed, prOpen, resolved, score, status, bySeverity, bugs, baseline: this.lastScan };
  }

  /** Builds main and runs the checkout-e2e suite against it to confirm the baseline is green. */
  async scanBaseline(): Promise<BaselineScan> {
    const worktree = await this.git.addDetachedWorktree('main', `health-${Date.now().toString(36)}`);
    try {
      const r = await this.tester.runSuite(worktree);
      this.lastScan = {
        ok: r.e2e.ok,
        passed: r.e2e.passed,
        total: r.e2e.passed + r.e2e.failed,
        durationMs: r.durationMs,
        at: new Date().toISOString(),
      };
    } finally {
      await this.git.removeWorktree(worktree);
    }
    return this.lastScan;
  }
}
