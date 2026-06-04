import { Body, Controller, Get, Head, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { AgentConfig } from '../config/agent-config';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { AnalysisService, IncomingE2eResult } from '../analysis/analysis.service';

/**
 * Trello → AutoFix trigger. In production, Trello POSTs here when a card moves to
 * the "Approved" list; the agent then runs the fix pipeline for that card's bug.
 * For the demo, POST { "bugId": "..." } to drive a run through the same path.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('TrelloWebhook');

  constructor(
    private readonly config: AgentConfig,
    private readonly registry: BugRegistryService,
    private readonly pipeline: PipelineService,
    private readonly analysis: AnalysisService,
  ) {}

  // Trello validates a webhook by issuing HEAD/GET to the callback URL.
  @Get('trello')
  @Head('trello')
  verify() {
    return { ok: true };
  }

  /** checkout-e2e pushes its run results here; the agent analyses them + reports. */
  @Post('e2e')
  @HttpCode(200)
  ingestE2e(@Body() body: IncomingE2eResult) {
    const report = this.analysis.ingest(body || ({ failures: [] } as IncomingE2eResult));
    this.logger.log(`E2E results received from ${report.suite}: ${report.summary}`);
    return report;
  }

  @Post('trello')
  @HttpCode(200)
  trigger(@Body() body: any, @Headers('x-trello-webhook') signature?: string) {
    if (!this.config.dryRun && this.config.trello.webhookSecret && !signature) {
      this.logger.warn('Missing x-trello-webhook signature on a non-dry-run request.');
    }
    const bugId = this.resolveBugId(body);
    if (!bugId) {
      return { ok: false, message: 'Could not resolve a bugId from the payload.' };
    }
    // Trello card → "Approved" is itself the human gate, so the webhook runs autonomously to PR.
    const { jobId } = this.pipeline.start(bugId, { source: 'webhook', autoApprove: true });
    this.logger.log(`Triggered pipeline ${jobId} for bug "${bugId}" via webhook.`);
    return { ok: true, jobId, bugId };
  }

  /** Accept an explicit bugId, or map a Trello card name back to a known bug. */
  private resolveBugId(body: any): string | undefined {
    if (body?.bugId) return body.bugId;
    const cardName: string | undefined = body?.action?.data?.card?.name;
    if (cardName) {
      const match = this.registry.list().find((b) => cardName.includes(b.title));
      if (match) return match.id;
    }
    return undefined;
  }
}
