import { createRequire } from 'node:module';
import Parser from 'web-tree-sitter';
import type { TokenCounter } from '../embeddings/provider.js';
import { GRAMMAR_FILES } from './languages.js';
import type { LineChunker } from './line-chunker.js';
import { DEFAULT_LIMITS, type Chunk, type ChunkLimits, type Chunker } from './types.js';

type Node = Parser.SyntaxNode;

interface Unit {
  kind: string;
  symbol: string | null;
  startRow: number;
  endRow: number;
  members: Unit[];
}

interface Rules {
  unwrap: (n: Node) => Node;
  classify: (n: Node) => { kind: string; symbol: string | null } | null;
  members: (n: Node, parentSymbol: string | null) => Unit[];
}

const require = createRequire(import.meta.url);

function name(n: Node): string | null {
  return n.childForFieldName('name')?.text ?? null;
}

function endRowOf(n: Node): number {
  return n.endPosition.column === 0 && n.endPosition.row > n.startPosition.row
    ? n.endPosition.row - 1
    : n.endPosition.row;
}

function unitOf(n: Node, kind: string, symbol: string | null, members: Unit[] = []): Unit {
  return { kind, symbol, startRow: n.startPosition.row, endRow: endRowOf(n), members };
}

function firstStringArg(call: Node): string | null {
  const args = call.childForFieldName('arguments');
  const s = args?.namedChildren.find((c) => c.type === 'string' || c.type === 'template_string');
  return s ? s.text.replace(/^['"`]|['"`]$/g, '') : null;
}

const TEST_FNS = new Set(['describe', 'it', 'test', 'context', 'suite']);

function jsMembers(body: Node | null, parent: string | null): Unit[] {
  if (!body) return [];
  const out: Unit[] = [];
  for (const m of body.namedChildren) {
    if (
      m.type === 'method_definition' ||
      m.type === 'abstract_method_signature' ||
      m.type === 'method_signature'
    ) {
      const n = name(m);
      out.push(unitOf(m, 'method', parent && n ? `${parent}.${n}` : n));
    }
  }
  return out;
}

const JS_RULES: Rules = {
  unwrap: (n) => (n.type === 'export_statement' ? (n.childForFieldName('declaration') ?? n) : n),
  classify: (n) => {
    switch (n.type) {
      case 'class_declaration':
      case 'abstract_class_declaration':
        return { kind: 'class', symbol: name(n) };
      case 'interface_declaration':
        return { kind: 'interface', symbol: name(n) };
      case 'type_alias_declaration':
        return { kind: 'type', symbol: name(n) };
      case 'enum_declaration':
        return { kind: 'enum', symbol: name(n) };
      case 'function_declaration':
      case 'generator_function_declaration':
        return { kind: 'function', symbol: name(n) };
      case 'lexical_declaration':
      case 'variable_declaration': {
        const decl = n.namedChildren.find((c) => c.type === 'variable_declarator');
        const value = decl?.childForFieldName('value');
        const isFn =
          value?.type === 'arrow_function' ||
          value?.type === 'function' ||
          value?.type === 'function_expression';
        if (!isFn) return null;
        return { kind: 'function', symbol: decl ? name(decl) : null };
      }
      case 'expression_statement': {
        const call = n.namedChildren[0];
        if (call?.type === 'call_expression') {
          const fn = call.childForFieldName('function')?.text ?? '';
          if (TEST_FNS.has(fn.split('.')[0] ?? ''))
            return { kind: 'test', symbol: firstStringArg(call) };
        }
        return null;
      }
      default:
        return null;
    }
  },
  members: (n, parent) =>
    n.type.endsWith('class_declaration') ? jsMembers(n.childForFieldName('body'), parent) : [],
};

const PY_RULES: Rules = {
  unwrap: (n) => (n.type === 'decorated_definition' ? (n.childForFieldName('definition') ?? n) : n),
  classify: (n) => {
    if (n.type === 'class_definition') return { kind: 'class', symbol: name(n) };
    if (n.type === 'function_definition') return { kind: 'function', symbol: name(n) };
    return null;
  },
  members: (n, parent) => {
    if (n.type !== 'class_definition') return [];
    const body = n.childForFieldName('body');
    const out: Unit[] = [];
    for (const raw of body?.namedChildren ?? []) {
      const m = PY_RULES.unwrap(raw);
      if (m.type === 'function_definition') {
        const nm = name(m);
        out.push(unitOf(raw, 'method', parent && nm ? `${parent}.${nm}` : nm));
      }
    }
    return out;
  },
};

const GO_RULES: Rules = {
  unwrap: (n) => n,
  classify: (n) => {
    if (n.type === 'function_declaration') return { kind: 'function', symbol: name(n) };
    if (n.type === 'method_declaration') {
      const recv = n.childForFieldName('receiver');
      const recvType =
        recv?.namedChildren[0]?.childForFieldName('type')?.text.replace(/^\*/, '') ?? null;
      const nm = name(n);
      return { kind: 'method', symbol: recvType && nm ? `${recvType}.${nm}` : nm };
    }
    if (n.type === 'type_declaration') {
      const spec = n.namedChildren.find((c) => c.type === 'type_spec');
      const t = spec?.childForFieldName('type')?.type ?? '';
      return {
        kind: t === 'struct_type' ? 'struct' : t === 'interface_type' ? 'interface' : 'type',
        symbol: spec ? name(spec) : null,
      };
    }
    return null;
  },
  members: () => [],
};

const JAVA_RULES: Rules = {
  unwrap: (n) => n,
  classify: (n) => {
    if (n.type === 'class_declaration') return { kind: 'class', symbol: name(n) };
    if (n.type === 'interface_declaration') return { kind: 'interface', symbol: name(n) };
    if (n.type === 'enum_declaration') return { kind: 'enum', symbol: name(n) };
    if (n.type === 'record_declaration') return { kind: 'class', symbol: name(n) };
    return null;
  },
  members: (n, parent) => {
    const body = n.childForFieldName('body');
    const out: Unit[] = [];
    for (const m of body?.namedChildren ?? []) {
      if (m.type === 'method_declaration' || m.type === 'constructor_declaration') {
        const nm = name(m);
        out.push(unitOf(m, 'method', parent && nm ? `${parent}.${nm}` : nm));
      }
    }
    return out;
  },
};

const RUST_RULES: Rules = {
  unwrap: (n) => n,
  classify: (n) => {
    switch (n.type) {
      case 'function_item':
        return { kind: 'function', symbol: name(n) };
      case 'struct_item':
        return { kind: 'struct', symbol: name(n) };
      case 'enum_item':
        return { kind: 'enum', symbol: name(n) };
      case 'trait_item':
        return { kind: 'trait', symbol: name(n) };
      case 'mod_item':
        return { kind: 'module', symbol: name(n) };
      case 'impl_item':
        return { kind: 'impl', symbol: n.childForFieldName('type')?.text ?? null };
      default:
        return null;
    }
  },
  members: (n, parent) => {
    if (n.type !== 'impl_item' && n.type !== 'trait_item') return [];
    const body = n.childForFieldName('body');
    const out: Unit[] = [];
    for (const m of body?.namedChildren ?? []) {
      if (m.type === 'function_item' || m.type === 'function_signature_item') {
        const nm = name(m);
        out.push(unitOf(m, 'method', parent && nm ? `${parent}.${nm}` : nm));
      }
    }
    return out;
  },
};

const RULES: Record<string, Rules> = {
  typescript: JS_RULES,
  tsx: JS_RULES,
  javascript: JS_RULES,
  python: PY_RULES,
  go: GO_RULES,
  java: JAVA_RULES,
  rust: RUST_RULES,
};

let parserInit: Promise<void> | null = null;
const languages = new Map<string, Promise<Parser.Language>>();

async function loadLanguage(language: string): Promise<Parser.Language> {
  parserInit ??= Parser.init();
  await parserInit;
  let lang = languages.get(language);
  if (!lang) {
    const file = GRAMMAR_FILES[language];
    if (!file) throw new Error(`no grammar for ${language}`);
    lang = Parser.Language.load(require.resolve(`tree-sitter-wasms/out/${file}`));
    languages.set(language, lang);
  }
  return lang;
}

export class TreeSitterChunker implements Chunker {
  constructor(
    private readonly counter: TokenCounter,
    private readonly line: LineChunker,
    private readonly limits: ChunkLimits = DEFAULT_LIMITS,
  ) {}

  supports(language: string | null): boolean {
    return language !== null && language in RULES;
  }

  async chunk(_path: string, content: string, language: string | null): Promise<Chunk[]> {
    if (!this.supports(language)) throw new Error(`unsupported language ${String(language)}`);
    const rules = RULES[language!]!;
    const lang = await loadLanguage(language!);
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(content);
    const lines = content.split('\n');

    const units: Unit[] = [];
    for (const top of tree.rootNode.namedChildren) {
      const inner = rules.unwrap(top);
      const cls = rules.classify(inner);
      if (!cls) continue;
      units.push(unitOf(top, cls.kind, cls.symbol, rules.members(inner, cls.symbol)));
    }
    units.sort((a, b) => a.startRow - b.startRow);

    const out: Chunk[] = [];
    let cursor = 0;
    for (const u of units) {
      if (u.startRow > cursor) out.push(...(await this.gap(lines, cursor, u.startRow - 1)));
      out.push(...(await this.unitChunks(lines, u)));
      cursor = Math.max(cursor, u.endRow + 1);
    }
    if (cursor <= lines.length - 1) out.push(...(await this.gap(lines, cursor, lines.length - 1)));
    tree.delete();
    parser.delete();
    return out.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  }

  private async gap(lines: string[], startRow: number, endRow: number): Promise<Chunk[]> {
    let start = startRow;
    let end = endRow;
    while (start <= end && (lines[start] ?? '').trim().length === 0) start++;
    while (end >= start && (lines[end] ?? '').trim().length === 0) end--;
    if (start > end) return [];
    const slice = lines.slice(start, end + 1);
    return this.line.chunkLines(slice, start + 1, 'module', null);
  }

  private async unitChunks(lines: string[], u: Unit): Promise<Chunk[]> {
    const text = lines.slice(u.startRow, u.endRow + 1).join('\n');
    const tokens = await this.counter.countTokens(text);
    if (tokens <= this.limits.maxTokens) {
      return [
        {
          kind: u.kind,
          symbol: u.symbol,
          startLine: u.startRow + 1,
          endLine: u.endRow + 1,
          content: text,
        },
      ];
    }
    if (u.members.length === 0)
      return this.line.chunkLines(
        lines.slice(u.startRow, u.endRow + 1),
        u.startRow + 1,
        u.kind,
        u.symbol,
      );

    const out: Chunk[] = [];
    const covered = new Set<number>();
    for (const m of u.members) {
      for (let r = m.startRow; r <= m.endRow; r++) covered.add(r);
      const mText = lines.slice(m.startRow, m.endRow + 1).join('\n');
      const mTokens = await this.counter.countTokens(mText);
      if (mTokens <= this.limits.maxTokens)
        out.push({
          kind: m.kind,
          symbol: m.symbol,
          startLine: m.startRow + 1,
          endLine: m.endRow + 1,
          content: mText,
        });
      else
        out.push(
          ...(await this.line.chunkLines(
            lines.slice(m.startRow, m.endRow + 1),
            m.startRow + 1,
            m.kind,
            m.symbol,
          )),
        );
    }
    const shellRows: number[] = [];
    for (let r = u.startRow; r <= u.endRow; r++) if (!covered.has(r)) shellRows.push(r);
    const shellLines = shellRows.map((r) => lines[r] ?? '');
    if (shellLines.some((l) => l.trim().length > 0)) {
      const first = shellRows[0]!;
      const shell = await this.line.chunkLines(shellLines, first + 1, u.kind, u.symbol);
      // shell rows are not contiguous; report the unit's full range for attribution
      out.push(...shell.map((c) => ({ ...c, startLine: u.startRow + 1, endLine: u.endRow + 1 })));
    }
    return out;
  }
}
