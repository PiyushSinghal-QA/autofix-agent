import { Injectable, Logger } from '@nestjs/common';
import { AgentConfig } from '../../config/agent-config';
import { PullRequest } from '../../common/types';
import { GitHubAdapter, OpenPrInput, PushInput } from './github.interface';

/** Simulates GitHub: logs the push/PR/reviewer actions and returns a fake PR. */
@Injectable()
export class DryRunGitHubAdapter implements GitHubAdapter {
  readonly mode = 'dry-run' as const;
  private readonly logger = new Logger('GitHub[dry-run]');
  private static prCounter = 42;

  constructor(private readonly config: AgentConfig) {}

  async pushBranch(input: PushInput): Promise<void> {
    this.logger.log(`push → origin ${input.branch} (from ${input.worktreePath})`);
  }

  async openPullRequest(input: OpenPrInput): Promise<PullRequest> {
    const number = ++DryRunGitHubAdapter.prCounter;
    const { owner, repo } = this.config.github;
    const pr: PullRequest = {
      number,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      reviewers: input.reviewers,
      draft: input.draft ?? false,
    };
    this.logger.log(`openPullRequest → #${number} ${input.head} → ${input.base} (${pr.url})`);
    if (input.reviewers.length) this.logger.log(`requestReviewers → ${input.reviewers.join(', ')}`);
    return pr;
  }
}
