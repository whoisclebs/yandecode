import type { Launcher } from '../launcher.js';
import { launcherCommandLine } from '../launcher.js';

type HookCommand = { type: string; command: string; timeout?: number };
type HookGroup = { matcher?: string; hooks: HookCommand[] };

const YANDECODE_HOOK = /\byandecode hook (\w+)\b/;

function isYandecodeGroup(group: unknown): boolean {
  if (typeof group !== 'object' || group === null) return false;
  const hooks = (group as HookGroup).hooks;
  return (
    Array.isArray(hooks) && hooks.length > 0 && hooks.every((h) => YANDECODE_HOOK.test(h.command))
  );
}

export function hookEntriesFor(
  launcher: Launcher,
  pluginHooksJson: unknown,
): Record<string, unknown[]> {
  const source = (pluginHooksJson as { hooks: Record<string, HookGroup[]> }).hooks;
  const out: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(source)) {
    out[event] = groups.map((g) => ({
      ...g,
      hooks: g.hooks.map((h) => {
        const m = YANDECODE_HOOK.exec(h.command);
        return m ? { ...h, command: launcherCommandLine(launcher, 'hook', m[1]!) } : h;
      }),
    }));
  }
  return out;
}

export function removeHooks(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const cleaned: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups.filter((g) => !isYandecodeGroup(g));
    if (kept.length > 0) cleaned[event] = kept;
  }
  const next: Record<string, unknown> = { ...settings };
  if (Object.keys(cleaned).length > 0) next.hooks = cleaned;
  else delete next.hooks;
  return next;
}

export function mergeHooks(
  settings: Record<string, unknown>,
  entries: Record<string, unknown[]>,
): Record<string, unknown> {
  const base = removeHooks(settings);
  const hooks = { ...((base.hooks ?? {}) as Record<string, unknown[]>) };
  for (const [event, groups] of Object.entries(entries)) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  return { ...base, hooks };
}
