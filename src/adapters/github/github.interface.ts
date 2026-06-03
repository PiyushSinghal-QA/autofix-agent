import { PullRequest } from '../../common/types';

export const GITHUB_ADAPTER = Symbol('GITHUB_ADAPTER');

export interface PushInput {
  worktreePath: string;
  branch: string;
}

export interface OpenPrInput {
  title: string;
  body: string;
  head: string;
  base: string;
  reviewers: string[];
  draft?: boolean;
}

export interface GitHubAdapter {
  readonly mode: 'dry-run' | 'real';
  pushBranch(input: PushInput): Promise<void>;
  openPullRequest(input: OpenPrInput): Promise<PullRequest>;
}
