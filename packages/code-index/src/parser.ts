import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { Parser, Language, type Node } from "web-tree-sitter";

export interface SymbolExtraction {
  /** Symbol identifier (function/class/method name). */
  name: string;
  /** Symbol kind: "class" | "function" | "method" | "import". */
  kind: string;
  /** The file path passed to extractSymbols. */
  file: string;
  /** 1-based start line. */
  line: number;
  /** 1-based end line. */
  endLine: number;
  /** Dotted qualified path, e.g. "PiHost.createSdkRuntime". */
  qualified: string;
}

export interface ParsedFile {
  symbols: SymbolExtraction[];
  imports: string[];
}

const require_ = createRequire(import.meta.url);

function resolveWasm(packageName: string, wasmFile: string): string {
  const pkgJson = require_.resolve(`${packageName}/package.json`);
  return join(dirname(pkgJson), wasmFile);
}

const wasmPaths: Record<string, { wasmPath: string }> = {
  ".ts": { wasmPath: resolveWasm("tree-sitter-typescript", "tree-sitter-typescript.wasm") },
  ".tsx": { wasmPath: resolveWasm("tree-sitter-typescript", "tree-sitter-tsx.wasm") },
  ".js": { wasmPath: resolveWasm("tree-sitter-javascript", "tree-sitter-javascript.wasm") },
  ".jsx": { wasmPath: resolveWasm("tree-sitter-javascript", "tree-sitter-javascript.wasm") },
  ".py": { wasmPath: resolveWasm("tree-sitter-python", "tree-sitter-python.wasm") },
  ".go": { wasmPath: resolveWasm("tree-sitter-go", "tree-sitter-go.wasm") },
};

const parserCache = new Map<string, Parser>();
let parserInitDone = false;

async function ensureInit(): Promise<void> {
  if (!parserInitDone) {
    // When electron-vite bundles main into out/main/main.js, web-tree-sitter's
    // default locateFile looks for web-tree-sitter.wasm next to that bundle
    // (ENOENT). Always resolve the real package asset instead.
    const runtimeWasm = require_.resolve("web-tree-sitter/web-tree-sitter.wasm");
    await Parser.init({
      locateFile: (scriptName: string) =>
        scriptName.endsWith(".wasm") ? runtimeWasm : scriptName,
    });
    parserInitDone = true;
  }
}

async function getParser(wasmPath: string): Promise<Parser> {
  await ensureInit();

  const cached = parserCache.get(wasmPath);
  if (cached) return cached;

  const wasmBuffer = await readFile(wasmPath);
  const lang = await Language.load(new Uint8Array(wasmBuffer));
  const parser = new Parser();
  parser.setLanguage(lang);
  parserCache.set(wasmPath, parser);
  return parser;
}

interface MatchResult {
  name: string;
  kind: string;
  qualified: string;
  isClass: boolean;
}

type NodeMatcher = (node: Node, parentClassName: string | null) => MatchResult | null;

function matchTS(node: Node, parentClassName: string | null): MatchResult | null {
  if (node.type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const name = nameNode.text;
      return {
        name,
        kind: "class",
        qualified: parentClassName ? `${parentClassName}.${name}` : name,
        isClass: true,
      };
    }
  }

  if (node.type === "method_definition") {
    const nameNode = node.childForFieldName("name");
    if (nameNode && parentClassName) {
      const name = nameNode.text;
      return {
        name,
        kind: "method",
        qualified: `${parentClassName}.${name}`,
        isClass: false,
      };
    }
  }

  if (node.type === "function_declaration" && !parentClassName) {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const name = nameNode.text;
      return {
        name,
        kind: "function",
        qualified: name,
        isClass: false,
      };
    }
  }

  return null;
}

function matchPython(node: Node, parentClassName: string | null): MatchResult | null {
  if (node.type === "class_definition") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const name = nameNode.text;
      return {
        name,
        kind: "class",
        qualified: parentClassName ? `${parentClassName}.${name}` : name,
        isClass: true,
      };
    }
  }

  if (node.type === "function_definition") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const name = nameNode.text;
      if (parentClassName) {
        return {
          name,
          kind: "method",
          qualified: `${parentClassName}.${name}`,
          isClass: false,
        };
      }
      return {
        name,
        kind: "function",
        qualified: name,
        isClass: false,
      };
    }
  }

  return null;
}

function matchGo(node: Node, _parentClassName: string | null): MatchResult | null {
  if (node.type === "function_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const name = nameNode.text;
      return {
        name,
        kind: "function",
        qualified: name,
        isClass: false,
      };
    }
  }

  if (node.type === "type_declaration") {
    // The name is on a child type_spec or type_alias node, not directly.
    for (const child of node.namedChildren) {
      if (child.type === "type_spec" || child.type === "type_alias") {
        const nameNode = child.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          return {
            name,
            kind: "class",
            qualified: name,
            isClass: false,
          };
        }
        break;
      }
    }
  }

  return null;
}

const matchers: Record<string, NodeMatcher> = {
  ".ts": matchTS,
  ".tsx": matchTS,
  ".js": matchTS,
  ".jsx": matchTS,
  ".py": matchPython,
  ".go": matchGo,
};

function walkTree(
  node: Node,
  symbols: SymbolExtraction[],
  filePath: string,
  parentClassName: string | null,
  matcher: NodeMatcher,
): void {
  const match = matcher(node, parentClassName);

  if (match) {
    symbols.push({
      name: match.name,
      kind: match.kind,
      file: filePath,
      line: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      qualified: match.qualified,
    });
  }

  const nextClassName = match?.isClass ? match.name : parentClassName;

  for (const child of node.namedChildren) {
    walkTree(child, symbols, filePath, nextClassName, matcher);
  }
}

export async function extractSymbols(
  filePath: string,
  source: string,
): Promise<SymbolExtraction[]> {
  const ext = extname(filePath).toLowerCase();
  const config = wasmPaths[ext];
  const matcher = matchers[ext];

  if (!config || !matcher) return [];

  const parser = await getParser(config.wasmPath);
  const tree = parser.parse(source);
  if (!tree) return [];

  const symbols: SymbolExtraction[] = [];
  walkTree(tree.rootNode, symbols, filePath, null, matcher);

  return symbols;
}

function findChildByType(node: Node, type: string): Node | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
  }
  return null;
}

function extractTsImports(root: Node): string[] {
  const imports: string[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "import_statement") continue;

    const importClause = findChildByType(stmt, "import_clause");
    if (!importClause) continue;

    for (const child of importClause.namedChildren) {
      if (child.type === "named_imports") {
        for (const spec of child.namedChildren) {
          if (spec.type !== "import_specifier") continue;
          const nameNode = spec.childForFieldName("name");
          if (nameNode) imports.push(nameNode.text);
        }
      } else if (child.type === "namespace_import") {
        for (const nsChild of child.namedChildren) {
          if (nsChild.type === "identifier") {
            imports.push(nsChild.text);
            break;
          }
        }
      } else if (child.type === "identifier") {
        imports.push(child.text);
      }
    }
  }
  return imports;
}

function extractPythonImports(root: Node): string[] {
  const imports: string[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type === "import_statement") {
      for (const child of stmt.namedChildren) {
        if (child.type === "dotted_name") {
          imports.push(child.text);
        } else if (child.type === "aliased_import") {
          const aliasNode = child.childForFieldName("alias");
          if (aliasNode) {
            imports.push(aliasNode.text);
          } else {
            const nameNode = child.childForFieldName("name");
            if (nameNode) imports.push(nameNode.text);
          }
        }
      }
    } else if (stmt.type === "import_from_statement") {
      for (const child of stmt.namedChildren) {
        if (child.type === "dotted_name") {
          const moduleNameNode = stmt.childForFieldName("module_name");
          if (moduleNameNode && child.equals(moduleNameNode)) continue;
          imports.push(child.text);
        } else if (child.type === "aliased_import") {
          const nameNode = child.childForFieldName("name");
          if (nameNode) imports.push(nameNode.text);
        }
      }
    }
  }
  return imports;
}

function extractGoImports(root: Node): string[] {
  const imports: string[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type !== "import_declaration") continue;

    for (const spec of stmt.namedChildren) {
      if (spec.type !== "import_spec") continue;

      const nameNode = spec.childForFieldName("name");
      if (nameNode) {
        imports.push(nameNode.text);
      } else {
        const pathNode = spec.childForFieldName("path");
        if (pathNode) {
          let text = pathNode.text;
          if (
            (text.startsWith('"') && text.endsWith('"')) ||
            (text.startsWith("`") && text.endsWith("`"))
          ) {
            text = text.slice(1, -1);
          }
          const seg = text.split("/").pop();
          if (seg) imports.push(seg);
        }
      }
    }
  }
  return imports;
}

const importExtractors: Record<string, (root: Node) => string[]> = {
  ".ts": extractTsImports,
  ".tsx": extractTsImports,
  ".js": extractTsImports,
  ".jsx": extractTsImports,
  ".py": extractPythonImports,
  ".go": extractGoImports,
};

export async function parseFile(
  filePath: string,
  source: string,
): Promise<ParsedFile> {
  const ext = extname(filePath).toLowerCase();
  const config = wasmPaths[ext];
  const extractor = importExtractors[ext];

  if (!config || !extractor) {
    return { symbols: [], imports: [] };
  }

  try {
    const parser = await getParser(config.wasmPath);
    const tree = parser.parse(source);
    if (!tree) return { symbols: [], imports: [] };

    const symbols: SymbolExtraction[] = [];
    const matcher = matchers[ext];
    walkTree(tree.rootNode, symbols, filePath, null, matcher);

    const imports = extractor(tree.rootNode);

    return { symbols, imports };
  } catch (error) {
    // tree-sitter grammars can trap the WASM VM ("memory access out of
    // bounds") on specific inputs — most often a file caught mid-write or
    // with pathological syntax. One bad file must not fail the whole index:
    // skip it (the caller keeps its hash unrecorded so the next scan
    // retries it) instead of rejecting the pipeline. The parser's WASM
    // memory may be corrupted after a trap, so drop it from the cache and
    // rebuild on the next file.
    if (config) parserCache.delete(config.wasmPath);
    const reason = error instanceof Error ? error.message : String(error);
    if (process.env.CODE_INDEX_DEBUG) {
      console.warn(`[code-index] skipping ${filePath}: ${reason}`);
    }
    return { symbols: [], imports: [] };
  }
}
