import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}
