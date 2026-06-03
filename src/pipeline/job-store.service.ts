import { Injectable } from '@nestjs/common';
import { JobRecord } from '../common/types';

/** In-memory record of every pipeline run (the dashboard reads final state here). */
@Injectable()
export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  create(jobId: string, bugId: string): JobRecord {
    const record: JobRecord = {
      jobId,
      bugId,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
    };
    this.jobs.set(jobId, record);
    return record;
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
