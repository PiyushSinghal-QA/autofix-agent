import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { JobStore } from './job-store.service';
import { EventsModule } from '../events/events.module';
import { GitModule } from '../git/git.module';
import { BugsModule } from '../bugs/bugs.module';
import { DetectorModule } from '../detector/detector.module';
import { ValidationModule } from '../validation/validation.module';
import { AiModule } from '../providers/ai/ai.module';
import { TrelloModule } from '../adapters/trello/trello.module';
import { GithubModule } from '../adapters/github/github.module';

@Module({
  imports: [
    EventsModule,
    GitModule,
    BugsModule,
    DetectorModule,
    ValidationModule,
    AiModule,
    TrelloModule,
    GithubModule,
  ],
  providers: [PipelineService, JobStore],
  exports: [PipelineService, JobStore],
})
export class PipelineModule {}
