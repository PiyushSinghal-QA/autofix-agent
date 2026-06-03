import { Global, Module } from '@nestjs/common';
import { AgentConfig } from './agent-config';

@Global()
@Module({
  providers: [AgentConfig],
  exports: [AgentConfig],
})
export class ConfigModule {}
