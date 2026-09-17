import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../src/events/event-log.js';
import { EventRepository } from '../src/persistence/repositories/events.js';
import { StateService } from '../src/persistence/state-service.js';

describe('EventLog', () => {
  it('writes to SQLite and mirrors one JSON line per event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yc-evlog-'));
    const file = join(dir, 'logs', 'events.jsonl');
    const state = StateService.open(':memory:');
    const events = new EventRepository(state);
    const log = new EventLog(events, file);
    await log.emit({ event: 'a' });
    await log.emit({ event: 'b', agent: 'scout' });
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { event: string; agent?: string });
    expect(lines.map((l) => l.event)).toEqual(['a', 'b']);
    expect(lines[1]?.agent).toBe('scout');
    expect(events.recent(5)).toHaveLength(2);
  });
});
