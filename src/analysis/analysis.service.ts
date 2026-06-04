import { Injectable, Logger } from '@nestjs/common';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { Severity } from '../common/types';

/** Payload the checkout-e2e suite pushes after a run. */
export interface IncomingE2eResult {
  repository?: string;
  suite?: string;
  branch?: string;
  failures: string[]; // failing test titles
  stats?: { passed?: number; failed?: number; total?: number };
}

export interface DetectedBug {
  bugId: string;
  title: string;
  severity: Severity;
  category: string;
  files: string[];
  branch: string;
  failingTest: string;
}

export interface AnalysisReport {
  receivedAt: string;
  repository: string;
  suite: string;
  totalTests: number;
  passed: number;
  failed: number;
  detected: DetectedBug[];
  unmapped: string[];
  summary: string;
}

/**
 * Ingests results PUSHED by the checkout-e2e framework, maps each failing test
 * to a known bug, and produces a triage report the dashboard + operator act on.
 * (Detection now comes from the framework's push, not the agent running tests.)
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger('Analysis');
  private latest: AnalysisReport | null = null;
  private readonly history: AnalysisReport[] = [];

  constructor(private readonly registry: BugRegistryService) {}

  ingest(input: IncomingE2eResult): AnalysisReport {
    const catalogue = this.registry.list();
    const failures = Array.isArray(input.failures) ? input.failures : [];
    const detected: DetectedBug[] = [];
    const unmapped: string[] = [];

    for (const title of failures) {
      const bug = catalogue.find((b) => b.failingTest === title);
      if (bug) {
        detected.push({
          bugId: bug.id, title: bug.title, severity: bug.severity,
          category: bug.category, files: bug.files, branch: bug.branch, failingTest: bug.failingTest,
        });
      } else {
        unmapped.push(title);
      }
    }

    const failed = input.stats?.failed ?? failures.length;
    const total = input.stats?.total ?? 0;
    const passed = input.stats?.passed ?? Math.max(0, total - failed);

    const report: AnalysisReport = {
      receivedAt: new Date().toISOString(),
      repository: input.repository || this.registry.repository,
      suite: input.suite || 'checkout-e2e',
      totalTests: total,
      passed,
      failed,
      detected,
      unmapped,
      summary: detected.length
        ? `${failed} failing test(s) → ${detected.length} known bug(s): ${detected.map((d) => `${d.bugId} [${d.severity}]`).join(', ')}${unmapped.length ? `; ${unmapped.length} unmapped` : ''}.`
        : failed
          ? `${failed} failing test(s); none matched a known bug.`
          : `All ${total} tests passed — nothing to fix.`,
    };

    this.latest = report;
    this.history.unshift(report);
    if (this.history.length > 20) this.history.pop();
    this.printReport(report);
    return report;
  }

  getLatest(): AnalysisReport | null {
    return this.latest;
  }

  listHistory(): AnalysisReport[] {
    return this.history;
  }

  private printReport(r: AnalysisReport): void {
    const rows = r.detected
      .map((d) => `   • ${d.bugId.padEnd(20)} [${d.severity}]  ${d.failingTest}`)
      .join('\n');
    this.logger.log(
      `\n── E2E triage report (${r.suite}) ───────────────────────────\n` +
        `   ${r.passed}/${r.totalTests} passed · ${r.failed} failing\n` +
        (rows ? rows + '\n' : '') +
        (r.unmapped.length ? `   unmapped: ${r.unmapped.join(', ')}\n` : '') +
        `   → ${r.summary}\n` +
        `──────────────────────────────────────────────────────────────`,
    );
  }
}
