import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventInput, EventRecord, EventRepository } from '../persistence/repositories/events.js';

export class EventLog {
  constructor(
    private readonly events: EventRepository,
    private readonly logFile: string,
  ) {}

  async emit(input: EventInput): Promise<EventRecord> {
    const rec = await this.events.record(input);
    mkdirSync(dirname(this.logFile), { recursive: true });
    appendFileSync(this.logFile, `${JSON.stringify(rec)}\n`, 'utf8');
    return rec;
  }
}
