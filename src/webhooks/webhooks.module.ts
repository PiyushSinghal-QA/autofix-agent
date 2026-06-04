import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { BugsModule } from '../bugs/bugs.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [PipelineModule, BugsModule, AnalysisModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
