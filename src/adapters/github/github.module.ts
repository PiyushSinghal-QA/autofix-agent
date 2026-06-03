import { Logger, Module } from '@nestjs/common';
import { AgentConfig } from '../../config/agent-config';
import { GitModule } from '../../git/git.module';
import { GITHUB_ADAPTER, GitHubAdapter } from './github.interface';
import { DryRunGitHubAdapter } from './dry-run-github.adapter';
import { RealGitHubAdapter } from './real-github.adapter';

@Module({
  imports: [GitModule],
  providers: [
    DryRunGitHubAdapter,
    RealGitHubAdapter,
    {
      provide: GITHUB_ADAPTER,
      inject: [AgentConfig, DryRunGitHubAdapter, RealGitHubAdapter],
      useFactory: (config: AgentConfig, dry: DryRunGitHubAdapter, real: RealGitHubAdapter): GitHubAdapter => {
        const logger = new Logger('GitHubFactory');
        if (!config.dryRun && config.github.token) {
          logger.log('Using real GitHub adapter (Octokit).');
          return real;
        }
        logger.log('Using dry-run GitHub adapter (simulated).');
        return dry;
      },
    },
  ],
  exports: [GITHUB_ADAPTER],
})
export class GithubModule {}
