import { Injectable } from '@nestjs/common';
import { BugRegistryEntry, BugRegistryService } from '../bugs/bug-registry.service';
import { AnalysisService } from '../analysis/analysis.service';
import { Bug } from '../common/types';

/**
 * Builds the structured Bug for a fix run. Detection itself now comes from the
 * checkout-e2e framework's PUSHED results (see AnalysisService); here we just
 * resolve the bug from the registry and attach context from the latest report.
 */
@Injectable()
export class DetectorService {
  constructor(
    private readonly registry: BugRegistryService,
    private readonly analysis: AnalysisService,
  ) {}

  async detect(entry: BugRegistryEntry, _jobId: string): Promise<Bug> {
    const report = this.analysis.getLatest();
    const fromReport = report?.detected.find((d) => d.bugId === entry.id);
    const logs = fromReport
      ? `Reported by ${report?.suite} at ${report?.receivedAt}: "${entry.failingTest}" failing (${report?.failed}/${report?.totalTests} failed in that run).`
      : `Resolved from the bug registry — no matching checkout-e2e push on record for "${entry.failingTest}".`;

    return {
      id: entry.id,
      title: entry.title,
      severity: entry.severity,
      category: entry.category,
      repository: this.registry.repository,
      branch: entry.branch,
      files: entry.files,
      failingTest: entry.failingTest,
      testFile: entry.testFile,
      description: entry.description,
      logs,
      detectedAt: new Date().toISOString(),
    };
  }
}
