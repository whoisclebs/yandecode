import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the plugin root (directory containing .claude-plugin/). */
export const pluginRoot = dirname(fileURLToPath(import.meta.url));
