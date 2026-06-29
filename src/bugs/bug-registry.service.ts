import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Loads the OPTIONAL seeded bug catalogue a target may ship in bugs/registry.json.
 * Present for the demo target (drives catalogue mode); absent for a real app, in
 * which case the agent runs in live mode off the pushed test results.
 */
@Injectable()
export class BugRegistryService {
  constructor(private readonly config: AgentConfig) {}

  private load(): RegistryFile {
    const path = join(this.config.appPath, 'bugs', 'registry.json');
    if (!existsSync(path)) {
      // No catalogue shipped by the target (a real app) — return an empty one so
      // the agent boots cleanly and works off live pushed results instead.
      return { repository: this.config.github.repo, defaultBranch: 'main', bugs: [] };
    }
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
