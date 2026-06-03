import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AgentConfig } from './config/agent-config';
import { loadEnv } from './config/load-env';

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useStaticAssets(join(__dirname, 'public'));

  const config = app.get(AgentConfig);
  await app.listen(config.port);

  const logger = new Logger('Bootstrap');
  logger.log(`AutoFix agent on http://localhost:${config.port}`);
  logger.log(`Dashboard   →  http://localhost:${config.port}/`);
  logger.log(`Mode        →  AI=${config.aiProvider}  DRY_RUN=${config.dryRun}`);
  logger.log(`Target app  →  ${config.appPath}`);
  logger.log(`E2E suite   →  ${config.e2ePath}`);
}

void bootstrap();
