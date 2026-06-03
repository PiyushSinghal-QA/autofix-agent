import { Controller, MessageEvent, Param, Sse } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { EventsService } from './events.service';

@Controller('api/jobs')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** Server-Sent Events stream of pipeline stage updates for a job. */
  @Sse(':id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return this.events.stream(id).pipe(map((event) => ({ data: event } as MessageEvent)));
  }
}
