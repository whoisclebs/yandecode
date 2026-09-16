import { runMigrations } from './migrations/index.js';
import { openDatabase, type Database } from './open.js';

export class StateService {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly db: Database,
    readonly file: string,
  ) {}

  static open(file: string): StateService {
    const db = openDatabase(file);
    runMigrations(db);
    return new StateService(db, file);
  }

  read<T>(fn: (db: Database) => T): T {
    return fn(this.db);
  }

  write<T>(fn: (db: Database) => T): Promise<T> {
    const run = (): T => this.db.transaction(() => fn(this.db))();
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  close(): void {
    this.db.close();
  }
}
