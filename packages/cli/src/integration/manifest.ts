import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomic } from '@yandecode/core';
import { z } from 'zod';

const ManifestSchema = z.object({
  version: z.string(),
  files: z.array(z.object({ path: z.string(), hash: z.string() })),
});

export type ManagedFile = { path: string; hash: string };
export type ManagedManifest = z.infer<typeof ManifestSchema>;

export function readManifest(file: string): ManagedManifest | null {
  if (!existsSync(file)) return null;
  const parsed = ManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  return parsed.success ? parsed.data : null;
}

export function writeManifest(file: string, manifest: ManagedManifest): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
