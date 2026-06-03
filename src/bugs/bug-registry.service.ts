import { Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConfig } from '../config/agent-config';
import { Severity } from '../common/types';

export interface BugRegistryEntry {
  id: string;
  branch: string;
  title: string;
  category: string;
  severity: Severity;
  files: string[];
  failingTest: string;
  testFile: string;
  description: string;
}

interface RegistryFile {
  repository: string;
  defaultBranch: string;
  bugs: BugRegistryEntry[];
}

/** Loads the seeded bug catalogue that checkout-service ships in bugs/registry.json. */
@Injectable()
export class BugRegistryService {
  constructor(private readonly config: AgentConfig) {}

  private load(): RegistryFile {
    const path = join(this.config.appPath, 'bugs', 'registry.json');
    return JSON.parse(readFileSync(path, 'utf8')) as RegistryFile;
  }

  get repository(): string {
    return this.load().repository;
  }

  list(): BugRegistryEntry[] {
    return this.load().bugs;
  }

  get(id: string): BugRegistryEntry {
    const bug = this.load().bugs.find((b) => b.id === id);
    if (!bug) throw new NotFoundException(`Unknown bug id: ${id}`);
    return bug;
  }
}
