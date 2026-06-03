import { Logger, Module } from '@nestjs/common';
import { AgentConfig } from '../../config/agent-config';
import { AI_PROVIDER, AIProvider } from './ai-provider.interface';
import { MockAIProvider } from './mock-ai.provider';
import { ClaudeAIProvider } from './claude-ai.provider';

@Module({
  providers: [
    MockAIProvider,
    ClaudeAIProvider,
    {
      provide: AI_PROVIDER,
      inject: [AgentConfig, MockAIProvider, ClaudeAIProvider],
      useFactory: (config: AgentConfig, mock: MockAIProvider, claude: ClaudeAIProvider): AIProvider => {
        const logger = new Logger('AIProviderFactory');
        if (config.aiProvider === 'claude') {
          if (config.anthropicApiKey) {
            logger.log(`Using Claude provider (${config.anthropicModel}).`);
            return claude;
          }
          logger.warn('AI_PROVIDER=claude but ANTHROPIC_API_KEY is missing — falling back to mock.');
        }
        logger.log('Using deterministic mock AI provider (offline).');
        return mock;
      },
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
