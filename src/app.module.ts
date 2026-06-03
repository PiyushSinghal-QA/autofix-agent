import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { EventsModule } from './events/events.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ApiModule } from './api/api.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [ConfigModule, EventsModule, PipelineModule, ApiModule, WebhooksModule],
})
export class AppModule {}
