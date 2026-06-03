import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PipelineService } from '../pipeline/pipeline.service';
import { JobStore } from '../pipeline/job-store.service';
import { loadEnv } from '../config/load-env';

/**
 * Headless pipeline runner — proves the full flow without the dashboard.
 *   npm run pipeline -- <bugId> [--rogue]
 */
async function main() {
  loadEnv();
  const bugId = process.argv[2];
  const rogue = process.argv.includes('--rogue');
  if (!bugId) {
    console.error('usage: npm run pipeline -- <bugId> [--rogue]');
    process.exit(2);
  }

  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  await app.init();

  const pipeline = app.get(PipelineService);
  const store = app.get(JobStore);

  const { jobId } = pipeline.start(bugId, { rogue, autoApprove: true, source: 'api' });
  await pipeline.whenSettled(jobId); // includes worktree cleanup

  const job = store.get(jobId);
  await app.close();
  process.exit(job?.status === 'succeeded' ? 0 : 1);
}

void main();
