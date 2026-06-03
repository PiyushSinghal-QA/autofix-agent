import { Injectable } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import { PipelineEvent } from '../common/types';

/**
 * Per-job event bus backing the dashboard's SSE stream. ReplaySubject buffers
 * history so a client that connects mid-run (or just after) still sees every
 * stage from the beginning.
 */
@Injectable()
export class EventsService {
  private readonly streams = new Map<string, ReplaySubject<PipelineEvent>>();

  private subjectFor(jobId: string): ReplaySubject<PipelineEvent> {
    let subject = this.streams.get(jobId);
    if (!subject) {
      subject = new ReplaySubject<PipelineEvent>(500);
      this.streams.set(jobId, subject);
    }
    return subject;
  }

  emit(event: PipelineEvent): void {
    this.subjectFor(event.jobId).next(event);
  }

  stream(jobId: string): Observable<PipelineEvent> {
    return this.subjectFor(jobId).asObservable();
  }
}
