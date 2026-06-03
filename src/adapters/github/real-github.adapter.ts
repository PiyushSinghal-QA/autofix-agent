import { Injectable, Logger } from '@nestjs/common';
import { AgentConfig } from '../../config/agent-config';
import { GitService } from '../../git/git.service';
import { PullRequest } from '../../common/types';
import { GitHubAdapter, OpenPrInput, PushInput } from './github.interface';

/**
 * Real GitHub implementation: pushes via git and opens the PR with Octokit
 * (dynamically imported so it never loads in the default offline demo).
 * Only constructed when DRY_RUN=false and a token is present.
 */
@Injectable()
export class RealGitHubAdapter implements GitHubAdapter {
  readonly mode = 'real' as const;
  private readonly logger = new Logger('GitHub[real]');

  constructor(
    private readonly config: AgentConfig,
    private readonly git: GitService,
  ) {}

  async pushBranch(input: PushInput): Promise<void> {
    await this.git.push(input.worktreePath, input.branch);
  }

  async openPullRequest(input: OpenPrInput): Promise<PullRequest> {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: this.config.github.token });
    const { owner, repo } = this.config.github;

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: input.draft ?? false,
    });

    if (input.reviewers.length) {
      await octokit.pulls
        .requestReviewers({ owner, repo, pull_number: pr.number, reviewers: input.reviewers })
        .catch((err) => this.logger.warn(`requestReviewers failed: ${err.message}`));
    }

    return {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      body: input.body,
      head: input.head,
      base: input.base,
      reviewers: input.reviewers,
      draft: pr.draft ?? false,
    };
  }
}
