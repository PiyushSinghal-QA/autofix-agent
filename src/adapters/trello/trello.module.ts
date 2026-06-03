import { Logger, Module } from '@nestjs/common';
import { AgentConfig } from '../../config/agent-config';
import { TRELLO_ADAPTER, TrelloAdapter } from './trello.interface';
import { DryRunTrelloAdapter } from './dry-run-trello.adapter';
import { RealTrelloAdapter } from './real-trello.adapter';

@Module({
  providers: [
    DryRunTrelloAdapter,
    RealTrelloAdapter,
    {
      provide: TRELLO_ADAPTER,
      inject: [AgentConfig, DryRunTrelloAdapter, RealTrelloAdapter],
      useFactory: (config: AgentConfig, dry: DryRunTrelloAdapter, real: RealTrelloAdapter): TrelloAdapter => {
        const logger = new Logger('TrelloFactory');
        if (!config.dryRun && config.trello.apiKey && config.trello.token) {
          logger.log('Using real Trello adapter.');
          return real;
        }
        logger.log('Using dry-run Trello adapter (simulated).');
        return dry;
      },
    },
  ],
  exports: [TRELLO_ADAPTER],
})
export class TrelloModule {}
