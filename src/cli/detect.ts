import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DetectorService } from '../detector/detector.service';
import { BugRegistryService } from '../bugs/bug-registry.service';
import { loadEnv } from '../config/load-env';

/**
 * Headless bug detector — runs the failing test on a bug branch and prints the
 * structured Bug object.
 *   npm run detect -- <bugId>
 */
async function main() {
  loadEnv();
  const bugId = process.argv[2] || 'null-check';
  const app = await NestFactory.create(AppModule, { logger: ['warn', 'error'] });
  await app.init();

  const detector = app.get(DetectorService);
  const registry = app.get(BugRegistryService);
  const entry = registry.get(bugId);
  const bug = await detector.detect(entry, 'cli');

  console.log(JSON.stringify(bug, null, 2));
  await app.close();
}

void main();
