const RESET = '[0m';
const BOLD = '[1m';
const DIM = '[2m';
const MAGENTA = '[35m';
const GREEN = '[32m';
const YELLOW = '[33m';
const CYAN = '[36m';
const RED = '[31m';

export interface StatusLineGitInfo {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface StatusLineSwarmInfo {
  done: number;
  total: number;
}

export interface StatusLineWorkspaceInfo {
  chunks: number;
  dirtyFiles: number;
  indexGeneration: number;
  indexBytes: number;
  hooksRegistered: number;
  hooksTotal: number;
  swarm: StatusLineSwarmInfo | null;
}

export interface StatusLineInput {
  version: string;
  projectName: string;
  model: string | null;
  durationMs: number | null;
  git: StatusLineGitInfo | null;
  workspace: StatusLineWorkspaceInfo | null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1 && bytes > 0) return '<0.1MB';
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}

function renderGitSegment(git: StatusLineGitInfo): string {
  const dirtyFlag = git.dirty ? `${YELLOW}*${RESET}` : '';
  const parts = [`${BOLD}${git.branch}${RESET}${dirtyFlag}`];
  if (git.ahead > 0) parts.push(`${GREEN}+${git.ahead}${RESET}`);
  if (git.behind > 0) parts.push(`${RED}-${git.behind}${RESET}`);
  return parts.join(' ');
}

function renderScanSegment(ws: StatusLineWorkspaceInfo): string {
  if (ws.chunks === 0) return `${RED}○ not indexed${RESET}`;
  if (ws.dirtyFiles > 0) return `${YELLOW}◐ scan pending (${ws.dirtyFiles})${RESET}`;
  return `${GREEN}● scan clean${RESET}`;
}

function renderSwarmSegment(ws: StatusLineWorkspaceInfo): string {
  if (!ws.swarm) return `${DIM}Swarm ○ idle${RESET}`;
  return `Swarm ${CYAN}●${RESET} ${ws.swarm.done}/${ws.swarm.total}`;
}

export function renderStatusLine(input: StatusLineInput): string {
  const headParts = [`${MAGENTA}●${RESET} ${BOLD}YandeCode${RESET} v${input.version}`];
  headParts.push(`${DIM}${input.projectName}${RESET}`);
  if (input.git) headParts.push(renderGitSegment(input.git));
  if (input.model) headParts.push(`${CYAN}${input.model}${RESET}`);
  if (input.durationMs !== null)
    headParts.push(`${DIM}⏱${formatDuration(input.durationMs)}${RESET}`);
  const line1 = headParts.join(`  ${DIM}|${RESET}  `);

  if (!input.workspace) {
    return `${line1}\n${DIM}yandecode: not initialized here · run "yandecode init"${RESET}`;
  }

  const ws = input.workspace;
  const line2Parts = [
    renderSwarmSegment(ws),
    `Hooks ${ws.hooksRegistered}/${ws.hooksTotal}`,
    `📚 ${ws.chunks} chunks`,
    `💾 ${formatBytes(ws.indexBytes)}`,
    renderScanSegment(ws),
  ];
  const line2 = line2Parts.join(`  ${DIM}·${RESET}  `);

  const line3 = `${DIM}💡 rag_search finds code before you read it manually · github.com/whoisclebs/yandecode${RESET}`;

  return `${line1}\n${line2}\n${line3}`;
}
