import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AgentConfig } from '../config/agent-config';
import { EventsService } from '../events/events.service';
import { JobStore } from './job-store.service';
import { DetectorService } from '../detector/detector.service';
import { GitService, FixWorktree } from '../git/git.service';
import { ValidationService } from '../validation/validation.service';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { AI_PROVIDER, AIProvider } from '../providers/ai/ai-provider.interface';
import { TRELLO_ADAPTER, TrelloAdapter } from '../adapters/trello/trello.interface';
import { GITHUB_ADAPTER, GitHubAdapter } from '../adapters/github/github.interface';
import { evaluateDiff } from '../common/diff-policy';
import {
  Bug,
  FixResponse,
  JobRecord,
  PipelineEvent,
  PipelineStage,
  StageStatus,
  ValidationResult,
} from '../common/types';

export interface StartOptions {
  rogue?: boolean;
  source?: 'api' | 'webhook';
  /** When false (dashboard default), the run pauses after validation for human approval. */
  autoApprove?: boolean;
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger('Pipeline');
  /** Tracks each run's full completion (including worktree cleanup) for callers that await it. */
  private readonly settled = new Map<string, Promise<void>>();
  /** Live worktrees for jobs paused awaiting approval (kept until approve/reject). */
  private readonly worktrees = new Map<string, FixWorktree>();

  constructor(
    private readonly config: AgentConfig,
    private readonly events: EventsService,
    private readonly store: JobStore,
    private readonly detector: DetectorService,
    private readonly git: GitService,
    private readonly validation: ValidationService,
    private readonly registry: BugRegistryService,
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
    @Inject(TRELLO_ADAPTER) private readonly trello: TrelloAdapter,
    @Inject(GITHUB_ADAPTER) private readonly github: GitHubAdapter,
  ) {}

  /** Kicks off a pipeline run and returns immediately with the job id. */
  start(bugId: string, options: StartOptions = {}): { jobId: string } {
    const entry = this.registry.get(bugId); // throws on unknown id
    // Don't open a second fix while one is already in flight for this bug.
    const active = this.store.list().find(
      (j) => j.bugId === entry.id && (j.status === 'running' || j.status === 'awaiting-approval'),
    );
    if (active) {
      throw new BadRequestException(
        `A fix for "${entry.id}" is already ${active.status} (job ${active.jobId}). Approve, discard, or let it finish first.`,
      );
    }
    const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.store.create(jobId, entry.id);
    this.settled.set(jobId, this.run(jobId, entry.id, options));
    return { jobId };
  }

  /** Resolves when the run (including worktree cleanup) has fully finished. */
  whenSettled(jobId: string): Promise<void> {
    return this.settled.get(jobId) ?? Promise.resolve();
  }

  private emit(
    jobId: string,
    stage: PipelineStage,
    status: StageStatus,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const event: PipelineEvent = {
      jobId,
      stage,
      status,
      message,
      timestamp: new Date().toISOString(),
      data,
    };
    this.store.get(jobId)?.events.push(event);
    this.events.emit(event);
    const tag = status === 'error' ? 'ERROR' : status.toUpperCase();
    this.logger.log(`[${jobId}] ${stage}/${tag} — ${message}`);
  }

  private async run(jobId: string, bugId: string, options: StartOptions): Promise<void> {
    const job = this.store.get(jobId)!;
    const entry = this.registry.get(bugId);
    let worktree: FixWorktree | undefined;

    try {
      // 1) DETECT ───────────────────────────────────────────────────────────
      this.emit(jobId, 'detected', 'start', `Resolving "${entry.failingTest}" reported by checkout-e2e on ${entry.branch}`);
      const bug = await this.detector.detect(entry, jobId);
      job.bug = bug;
      this.emit(jobId, 'detected', 'success', `Reproduced failing test: "${bug.failingTest}"`, {
        bug,
      });

      // 2) CARD ─────────────────────────────────────────────────────────────
      this.emit(jobId, 'carded', 'start', 'Filing a Trello card for the defect');
      const card = await this.trello.createCard({
        name: `[${bug.severity.toUpperCase()}] ${bug.title}`,
        desc: this.cardDescription(bug),
        labels: ['autofix', `severity:${bug.severity}`, bug.category],
      });
      job.card = card;
      this.emit(jobId, 'carded', 'success', `Trello card created (${this.trello.mode})`, { card });
      this.emit(
        jobId,
        'carded',
        'info',
        'In production, moving this card to "Approved" fires POST /webhooks/trello; here the agent proceeds automatically.',
      );

      // 3) BRANCH ───────────────────────────────────────────────────────────
      this.emit(jobId, 'branched', 'start', 'Creating an isolated worktree + fix branch');
      const fixBranch = `fix/${bug.id}-${jobId.slice(-4)}`;
      worktree = await this.git.addFixWorktree(entry.branch, fixBranch, jobId);
      this.worktrees.set(jobId, worktree);
      job.fixBranch = fixBranch;
      this.emit(jobId, 'branched', 'success', `Branched ${fixBranch} from ${entry.branch}`, {
        fixBranch,
        baseBranch: entry.branch,
      });

      // 4) AI FIX ───────────────────────────────────────────────────────────
      this.emit(jobId, 'ai-fix', 'start', `Requesting a fix from the ${this.ai.name} provider`);
      const fix = await this.ai.generateFix({
        bug,
        repoPath: worktree.path,
        mode: options.rogue ? 'rogue' : 'normal',
        onReasoning: (line) => this.emit(jobId, 'ai-fix', 'info', line),
      });
      job.fix = fix;

      const verdict = evaluateDiff(fix.diff);
      this.emit(
        jobId,
        'ai-fix',
        'info',
        `Proposed patch — ${verdict.filesChanged.join(', ') || 'no files'} (+${verdict.additions}/-${verdict.deletions}), ${fix.tokenUsage.total} tokens, ${fix.latencyMs}ms`,
        {
          diff: fix.diff,
          reasoning: fix.reasoning,
          tokenUsage: fix.tokenUsage,
          model: fix.model,
          provider: fix.provider,
          latencyMs: fix.latencyMs,
          filesChanged: verdict.filesChanged,
          additions: verdict.additions,
          deletions: verdict.deletions,
        },
      );

      if (!verdict.ok) {
        const reason = `Patch rejected by policy: ${verdict.violations.join(' ')}`;
        await this.trello.addComment(card.id, `AutoFix aborted before applying. ${reason}`);
        await this.fail(jobId, job, reason, { violations: verdict.violations });
        await this.cleanup(jobId);
        return;
      }

      await this.git.applyPatch(worktree.path, fix.diff);
      this.emit(jobId, 'ai-fix', 'success', `Applied patch to ${verdict.filesChanged.join(', ')}`);

      // 5) VALIDATE ─────────────────────────────────────────────────────────
      this.emit(jobId, 'validating', 'start', 'Running test → lint → build against the patched code');
      const validation = await this.validation.validate(worktree.path, (step) =>
        this.emit(
          jobId,
          'validating',
          'info',
          `${step.name}: ${step.skipped ? 'skipped' : step.ok ? 'passed' : 'FAILED'} (${step.durationMs}ms)`,
          { step },
        ),
      );
      job.validation = validation;

      if (!validation.ok) {
        await this.trello.addComment(
          card.id,
          'AutoFix produced a patch but validation failed; the branch was discarded and no PR was opened.',
        );
        await this.fail(
          jobId,
          job,
          'Validation failed — reverted, no PR opened (tests were never modified).',
          { validation },
        );
        await this.cleanup(jobId);
        return;
      }
      this.emit(jobId, 'validating', 'success', `All gates passed in ${validation.durationMs}ms`, {
        validation,
      });

      // 6) COMMIT — the fix is now locked on the branch, ready to push on approval.
      await this.git.commitAll(worktree.path, this.commitMessage(bug));

      if (options.autoApprove) {
        // Autonomous mode (CLI / Trello webhook): straight to PR.
        await this.finishWithPr(jobId);
      } else {
        // Human-in-the-loop (dashboard default): pause for review.
        job.status = 'awaiting-approval';
        this.emit(
          jobId,
          'awaiting-approval',
          'info',
          'Fix validated and committed — awaiting approval to open the pull request.',
          { fixBranch, baseBranch: entry.branch, diff: fix.diff },
        );
      }
    } catch (err) {
      await this.fail(jobId, job, `Unexpected error: ${(err as Error).message}`, {
        stack: (err as Error).stack,
      });
      await this.cleanup(jobId);
    }
  }

  /** Push the fix branch + open the PR + finish (shared by auto-approve and manual approve). */
  private async finishWithPr(jobId: string): Promise<void> {
    const job = this.store.get(jobId)!;
    const entry = this.registry.get(job.bugId);
    const worktree = this.worktrees.get(jobId);
    const bug = job.bug!;
    try {
      await this.github.pushBranch({ worktreePath: worktree!.path, branch: job.fixBranch! });

      this.emit(jobId, 'pr-opened', 'start', `Opening pull request (${this.github.mode})`);
      const reviewers = this.config.github.defaultReviewer ? [this.config.github.defaultReviewer] : [];
      const pr = await this.github.openPullRequest({
        title: `fix: ${bug.title}`,
        body: this.prBody(bug, job.fix!, job.validation!),
        head: job.fixBranch!,
        base: entry.branch,
        reviewers,
        draft: false,
      });
      job.pullRequest = pr;
      const reviewerNote = reviewers.length ? ` — requested review from ${reviewers.join(', ')}` : '';
      await this.trello.addComment(job.card!.id, `AutoFix opened ${pr.url}${reviewerNote}.`);
      await this.trello.moveCard(job.card!.id, 'In Review');
      this.emit(jobId, 'pr-opened', 'success', `Opened PR #${pr.number} → ${pr.url}`, { pullRequest: pr });

      job.status = 'succeeded';
      job.finishedAt = new Date().toISOString();
      job.durationMs = Date.now() - Date.parse(job.startedAt);
      this.emit(jobId, 'done', 'success', `AutoFix complete in ${job.durationMs}ms`, {
        summary: this.summary(job),
      });
      this.printSummary(job);
    } finally {
      await this.cleanup(jobId);
    }
  }

  /** Reviewer approved the suggested fix → push + open the PR. */
  async approve(jobId: string): Promise<JobRecord> {
    const job = this.requireAwaiting(jobId);
    job.status = 'running';
    await this.finishWithPr(jobId);
    return this.store.get(jobId)!;
  }

  /** Reviewer discarded the suggested fix → drop the branch, no PR. */
  async reject(jobId: string): Promise<JobRecord> {
    const job = this.requireAwaiting(jobId);
    await this.cleanup(jobId);
    job.status = 'discarded';
    job.failureReason = 'Discarded by reviewer';
    job.finishedAt = new Date().toISOString();
    job.durationMs = Date.now() - Date.parse(job.startedAt);
    this.emit(jobId, 'failed', 'error', 'Discarded by reviewer — fix branch removed, no PR opened.', { discarded: true });
    return job;
  }

  private requireAwaiting(jobId: string): JobRecord {
    const job = this.store.get(jobId);
    if (!job) throw new NotFoundException(`Unknown job: ${jobId}`);
    if (job.status !== 'awaiting-approval') {
      throw new BadRequestException(`Job ${jobId} is not awaiting approval (status: ${job.status}).`);
    }
    return job;
  }

  private async cleanup(jobId: string): Promise<void> {
    const worktree = this.worktrees.get(jobId);
    if (worktree) {
      await this.git.removeWorktree(worktree.path, worktree.branch);
      this.worktrees.delete(jobId);
    }
  }

  private async fail(
    jobId: string,
    job: JobRecord,
    reason: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    job.status = 'failed';
    job.failureReason = reason;
    job.finishedAt = new Date().toISOString();
    job.durationMs = Date.now() - Date.parse(job.startedAt);
    this.emit(jobId, 'failed', 'error', reason, data);
    this.logger.warn(`[${jobId}] FAILED — ${reason}`);
  }

  // ── Artifacts ────────────────────────────────────────────────────────────
  private cardDescription(bug: Bug): string {
    return [
      `**Severity:** ${bug.severity}  •  **Category:** ${bug.category}`,
      `**Repository:** ${bug.repository}  •  **Branch:** ${bug.branch}`,
      '',
      bug.description,
      '',
      `**Failing test:** ${bug.failingTest}`,
    ].join('\n');
  }

  private commitMessage(bug: Bug): string {
    return `fix: ${bug.title}`;
  }

  private prBody(bug: Bug, fix: FixResponse, validation: ValidationResult): string {
    const gate = (name: string) => {
      const s = validation.steps.find((x) => x.name === name);
      if (!s) return '—';
      return `${s.ok ? 'pass' : s.skipped ? 'skipped' : 'fail'} (${s.durationMs}ms)`;
    };
    return [
      `## AutoFix: ${bug.title}`,
      '',
      `**Bug** \`${bug.category}\` · severity **${bug.severity}**`,
      '',
      bug.description,
      '',
      '### Root cause',
      ...fix.reasoning.map((r) => `- ${r}`),
      '',
      '### Validation',
      '| Gate | Result |',
      '| --- | --- |',
      `| test | ${gate('test')} |`,
      `| lint | ${gate('lint')} |`,
      `| build | ${gate('build')} |`,
      '',
      '### Change',
      `- Files: ${fix.filesChanged.join(', ')}`,
      `- Provider: ${fix.provider} (${fix.model})`,
      `- Tokens: ${fix.tokenUsage.input} in / ${fix.tokenUsage.output} out`,
      '',
      '```diff',
      fix.diff.trimEnd(),
      '```',
      '',
      `_Automated by AutoFix — fixes the failing test "${bug.failingTest}"._`,
    ].join('\n');
  }

  private summary(job: JobRecord): Record<string, unknown> {
    return {
      jobId: job.jobId,
      bug: job.bug?.title,
      status: job.status,
      durationMs: job.durationMs,
      provider: job.fix?.provider,
      model: job.fix?.model,
      tokenUsage: job.fix?.tokenUsage,
      validation: job.validation?.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.durationMs })),
      pullRequest: job.pullRequest ? { number: job.pullRequest.number, url: job.pullRequest.url } : null,
    };
  }

  private printSummary(job: JobRecord): void {
    const rows: [string, string][] = [
      ['Job', job.jobId],
      ['Bug', `${job.bug?.title} [${job.bug?.severity}]`],
      ['Status', job.status],
      ['Duration', `${job.durationMs}ms`],
      ['AI provider', `${job.fix?.provider} (${job.fix?.model})`],
      ['Tokens', `${job.fix?.tokenUsage.input} in / ${job.fix?.tokenUsage.output} out / ${job.fix?.tokenUsage.total} total`],
      ['Validation', (job.validation?.steps || []).map((s) => `${s.name}:${s.ok ? 'ok' : s.skipped ? 'skip' : 'fail'}`).join('  ')],
      ['Pull request', job.pullRequest ? `#${job.pullRequest.number} ${job.pullRequest.url}` : '—'],
    ];
    const width = Math.max(...rows.map(([k]) => k.length));
    const table = rows.map(([k, v]) => `   ${k.padEnd(width)}  ${v}`).join('\n');
    this.logger.log(`\n── AutoFix run summary ────────────────────────────────\n${table}\n───────────────────────────────────────────────────────`);
  }
}
