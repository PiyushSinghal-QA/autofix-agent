import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { BugsModule } from '../bugs/bugs.module';

@Module({
  imports: [PipelineModule, BugsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
