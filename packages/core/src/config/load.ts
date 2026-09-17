import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { YandeCodeError } from '../errors.js';
import { CONFIG_FILENAME, ConfigSchema, DEFAULT_CONFIG, type YandeCodeConfig } from './schema.js';

export { CONFIG_FILENAME, ConfigSchema, DEFAULT_CONFIG, type YandeCodeConfig };

export function loadConfig(projectRoot: string): YandeCodeConfig {
  const file = join(projectRoot, CONFIG_FILENAME);
  if (!existsSync(file)) return ConfigSchema.parse({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new YandeCodeError('CONFIG_INVALID', `${file} is not valid JSON`, { cause });
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new YandeCodeError(
      'CONFIG_INVALID',
      `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

export function writeDefaultConfig(projectRoot: string): boolean {
  const file = join(projectRoot, CONFIG_FILENAME);
  if (existsSync(file)) return false;
  writeFileSync(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
  return true;
}
