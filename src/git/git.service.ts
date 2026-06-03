import { Injectable, Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConfig } from '../config/agent-config';

export interface FixWorktree {
  path: string;
  branch: string;
  baseBranch: string;
}

/**
 * Thin wrapper over git for the agent. checkout-service is the external "target
 * repo"; every fix happens inside a throwaway worktree (under its
 * .agent-worktrees/) so the source checkout is never mutated and runs repeat.
 */
@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly base: SimpleGit;

  constructor(private readonly config: AgentConfig) {
    this.base = simpleGit(config.appPath);
    mkdirSync(config.worktreeRoot, { recursive: true });
  }

  async addDetachedWorktree(bugBranch: string, jobId: string): Promise<string> {
    const path = join(this.config.worktreeRoot, `detect-${jobId}`);
    this.cleanPath(path);
    await this.base.raw(['worktree', 'add', '--detach', path, bugBranch]);
    return path;
  }

  async addFixWorktree(bugBranch: string, fixBranch: string, jobId: string): Promise<FixWorktree> {
    const path = join(this.config.worktreeRoot, `fix-${jobId}`);
    this.cleanPath(path);
    await this.base.raw(['worktree', 'add', '-b', fixBranch, path, bugBranch]);
    return { path, branch: fixBranch, baseBranch: bugBranch };
  }

  async applyPatch(worktreePath: string, patch: string): Promise<void> {
    const patchDir = join(this.config.worktreeRoot, '_patches');
    mkdirSync(patchDir, { recursive: true });
    const patchFile = join(patchDir, `patch-${Date.now()}.patch`);
    writeFileSync(patchFile, patch);
    try {
      await simpleGit(worktreePath).raw(['apply', '--whitespace=nowarn', patchFile]);
    } finally {
      rmSync(patchFile, { force: true });
    }
  }

  async commitAll(worktreePath: string, message: string): Promise<string> {
    const git = simpleGit(worktreePath);
    await git.add(['-A']);
    await git.commit(message);
    return (await git.revparse(['HEAD'])).trim();
  }

  /** Real-mode push; never called in DRY_RUN. */
  async push(worktreePath: string, branch: string): Promise<void> {
    await simpleGit(worktreePath).push(['-u', 'origin', branch]);
  }

  async removeWorktree(path: string, branch?: string): Promise<void> {
    try {
      await this.base.raw(['worktree', 'remove', '--force', path]);
    } catch (err) {
      this.logger.warn(`worktree remove failed (${path}): ${(err as Error).message}`);
      this.cleanPath(path);
    }
    await this.base.raw(['worktree', 'prune']).catch(() => undefined);
    if (branch) {
      await this.base.branch(['-D', branch]).catch(() => undefined);
    }
  }

  private cleanPath(path: string): void {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
}
