export function resolveClaudeBin(): string {
  return process.env.YANDECODE_CLAUDE_BIN ?? 'claude';
}
