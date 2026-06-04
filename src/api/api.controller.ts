import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { AgentConfig } from '../config/agent-config';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { JobStore } from '../pipeline/job-store.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { HealthService } from '../health/health.service';
import { AnalysisService } from '../analysis/analysis.service';

interface TriggerBody {
  bugId: string;
  rogue?: boolean;
  autoApprove?: boolean;
}

@Controller('api')
export class ApiController {
  constructor(
    private readonly config: AgentConfig,
    private readonly registry: BugRegistryService,
    private readonly store: JobStore,
    private readonly pipeline: PipelineService,
    private readonly health: HealthService,
    private readonly analysis: AnalysisService,
  ) {}

  @Get('config')
  getConfig() {
    return {
      aiProvider: this.config.aiProvider,
      dryRun: this.config.dryRun,
      repository: this.registry.repository,
      model: this.config.anthropicModel,
    };
  }

  @Get('health')
  getHealth() {
    return this.health.snapshot();
  }

  @Post('health/scan')
  scanHealth() {
    return this.health.scanBaseline();
  }

  /** Latest triage report pushed by the checkout-e2e framework. */
  @Get('report')
  getReport() {
    return this.analysis.getLatest();
  }

  /** Cumulative list of issues found across all pushed runs. */
  @Get('issues')
  getIssues() {
    return this.analysis.issuesToDate();
  }

  @Post('issues/clear')
  clearIssues() {
    this.analysis.clear();
    return { ok: true };
  }

  @Get('bugs')
  listBugs() {
    return this.registry.list();
  }

  @Get('jobs')
  listJobs() {
    return this.store.list().map((j) => ({
      jobId: j.jobId,
      bugId: j.bugId,
      status: j.status,
      startedAt: j.startedAt,
      durationMs: j.durationMs,
      pr: j.pullRequest ? { number: j.pullRequest.number, url: j.pullRequest.url } : null,
    }));
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    const job = this.store.get(id);
    if (!job) throw new NotFoundException(`Unknown job: ${id}`);
    return job;
  }

  @Post('jobs')
  trigger(@Body() body: TriggerBody) {
    // Dashboard default: pause for human approval unless autoApprove is explicitly set.
    return this.pipeline.start(body.bugId, {
      rogue: body.rogue,
      autoApprove: body.autoApprove === true,
      source: 'api',
    });
  }

  @Post('jobs/:id/approve')
  approve(@Param('id') id: string) {
    return this.pipeline.approve(id);
  }

  @Post('jobs/:id/reject')
  reject(@Param('id') id: string) {
    return this.pipeline.reject(id);
  }
}
