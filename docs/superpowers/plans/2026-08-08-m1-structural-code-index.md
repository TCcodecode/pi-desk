# M1: 结构层代码索引（packages/code-index）技术方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建零外部依赖的代码结构索引包——tree-sitter 符号提取 + SQLite FTS5(trigram) 词法检索 + 引用/调用图，作为方案 A（纯结构层）的地基。GUI（pi-desk）与 pi extension（M2）共用此包。

**背景决策链:** 调研（Claude Code / Sourcegraph / Cursor / Aider 弃用向量库）+ 实测（opencode-codebase-index 的 embedding 硬依赖是设计缺陷）→ 结论：**结构层零依赖可跑，embedding 是可选二期增强（ONNX 进程内，不用 Ollama）**。本计划只做结构层。

**Architecture:** 独立 npm workspace 包 `packages/code-index`，纯逻辑零 UI 依赖。三层：(1) scanner 增量扫描（git 感知）；(2) parser 符号提取（web-tree-sitter WASM）；(3) store + search（node:sqlite FTS5 trigram + 引用边表）。

**Tech Stack:** TypeScript, `web-tree-sitter` (WASM), `tree-sitter-wasms` (预编译语法), `node:sqlite` (Node 22.5+ 内置, Electron 43 自带), Vitest。

---

## 技术选型（已实证 2026-08-08）

| 层 | 选型 | 决策依据 |
|---|---|---|
| 符号提取 | `web-tree-sitter` (WASM) + `tree-sitter-wasms` | **零原生模块**，免 electron-rebuild，electron-vite 直接打包；node-tree-sitter 需 ABI 匹配 rebuild，是分发痛点 |
| 存储 + 检索 | **`node:sqlite`**（Node 22.5+ 内置，Electron 43 自带） | 实证通过：FTS5 trigram 部分匹配/精确匹配/join/边表全链路 OK。零依赖、零打包、零 rebuild |
| 引用图 | SQLite 边表（from_id/to_id/kind） | 已实证 join 查询 OK |
| 增量策略 | git 感知：`git ls-files` + sha256 内容哈希 | 只重新解析变更文件，索引常新 |

**选型杀手锏：整个 M1 零原生模块。** 树-sitter 走 WASM、SQLite 走 Node 内置 → electron-builder 无需处理任何 `.node` ABI 兼容问题。避开 opencode-codebase-index 的教训（embedding + 原生模块双重绑定）。

**Electron 兼容性注记:** `node:sqlite` 在 Node 22.5 起可用（`--experimental-sqlite`），Node 23.4 起稳定默认开启；Electron 43 内置 Node 22+，已可无 flag 使用（本机 Node 24.15 实证）。若未来 Electron 内置 Node 版本过低需 flag，回退方案为 `better-sqlite3`（仅增加一个原生依赖，接口一致）。

---

## 目录结构

```
packages/code-index/
├── package.json            # 独立包, "type": "module"
├── tsconfig.json
├── src/
│   ├── index.ts            # 公共 API: createCodeIndex / searchSymbols / findUsages / getStatus
│   ├── scanner.ts          # git 感知扫描: git ls-files + .gitignore + 内容哈希
│   ├── parser.ts           # web-tree-sitter 符号提取 (函数/类/方法/导入)
│   ├── store.ts            # node:sqlite schema + FTS5 trigram + 边表
│   └── search.ts           # searchSymbols (FTS5) / findUsages (边表 join)
├── test/
│   ├── scanner.test.ts
│   ├── parser.test.ts
│   ├── store.test.ts
│   └── search.test.ts
└── wasm/                   # tree-sitter-wasms 语法文件 (打包资源, 随包分发)
```

---

## 数据 Schema（已实证的 SQL）

```sql
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,           -- class / function / method / import / ...
  file TEXT NOT NULL,           -- 相对项目根
  line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  qualified TEXT                -- PiHost.createSdkRuntime 式限定名
);

CREATE VIRTUAL TABLE symbols_fts USING fts5(name, qualified, tokenize='trigram');

CREATE TABLE edges (
  from_id INTEGER NOT NULL,     -- 引用方 symbol id
  to_id INTEGER NOT NULL,       -- 被引用 symbol id
  kind TEXT NOT NULL            -- contains / imports / calls
);
CREATE INDEX idx_edges_from ON edges(from_id);
CREATE INDEX idx_edges_to ON edges(to_id);
```

**FTS5 external-content 注记:** 初期用独立 FTS5 表（插入时同步 rowid）；`content='symbols'` external-content + triggers 是后期优化，MVP 不做。

---

## 公共 API 契约

```typescript
export interface SymbolHit {
  name: string;
  kind: string;
  file: string;      // 相对路径
  line: number;
  endLine: number;
  qualified: string;
  score?: number;    // FTS5 bm25 归一化
}

export interface UsageHit {
  name: string;      // 引用方符号名
  kind: string;
  file: string;
  line: number;
  edgeKind: string;  // contains / imports / calls
}

export interface IndexStatus {
  state: "idle" | "indexing" | "ready" | "error";
  filesIndexed: number;
  symbolsIndexed: number;
  lastIndexedAt?: string;
  error?: string;
}

export interface CodeIndex {
  index(projectRoot: string): Promise<IndexStats>;   // 增量索引
  searchSymbols(query: string, opts?: { limit?: number }): Promise<SymbolHit[]>;  // FTS5 trigram, 部分匹配
  findUsages(symbolName: string, opts?: { kind?: string }): Promise<UsageHit[]>; // 边表 join, 反向引用
  getStatus(): IndexStatus;
  dispose(): void;
}

export function createCodeIndex(opts?: { dbPath?: string }): CodeIndex;
```

---

## 执行任务（TDD，按依赖顺序）

### Task 1: scanner——git 感知文件扫描

**Files:**
- Create: `packages/code-index/src/scanner.ts`
- Test: `packages/code-index/test/scanner.test.ts`

- [ ] **Step 1: 写失败测试**——扫描 git 仓库，返回相对路径列表，排除 node_modules/.git/gitignore 项，支持 `.gitignore` 规则
- [ ] **Step 2: 实现 scanner.ts**——`git ls-files` 取追踪文件（无 git 时回退目录遍历）+ `ignore` 包处理 .gitignore + sha256 内容哈希表
- [ ] **Step 3: 增量对比**——返回 `{ added: string[], modified: string[], deleted: string[] }`（对比上次哈希快照）

### Task 2: parser——web-tree-sitter 符号提取

**Files:**
- Create: `packages/code-index/src/parser.ts`
- Test: `packages/code-index/test/parser.test.ts`

- [ ] **Step 1: 写失败测试**——TS 文件解析出 class/function/method 符号 + 行号范围 + 限定名
- [ ] **Step 2: 实现 parser.ts**——初始化 `tree-sitter-wasms` 语法（按扩展名映射），tree-sitter query 提取符号
- [ ] **Step 3: 引用提取**——import/调用边（M1 先做 import + contains，calls 为 M1.5 可选）
- [ ] **Step 4: 多语言扩展点**——语言 → 语法包映射表，先支持 ts/tsx/js/py/go/rs，后续加

### Task 3: store——node:sqlite schema

**Files:**
- Create: `packages/code-index/src/store.ts`
- Test: `packages/code-index/test/store.test.ts`

- [ ] **Step 1: 写失败测试**——建表、插入符号、FTS5 trigram 部分匹配查询、边表 join 查询
- [ ] **Step 2: 实现 store.ts**——`DatabaseSync` 封装，schema 如上，批量插入 + 事务
- [ ] **Step 3: 哈希快照表**——`file_hashes (path PK, hash, mtime)` 支撑增量

### Task 4: search——检索 API

**Files:**
- Create: `packages/code-index/src/search.ts`
- Test: `packages/code-index/test/search.test.ts`

- [ ] **Step 1: 写失败测试**——`searchSymbols("PiHost")` 命中 class；部分匹配 `"createSdk"` 命中方法；`findUsages("PiHost")` 返回引用方
- [ ] **Step 2: 实现 search.ts**——FTS5 MATCH + JOIN symbols 取元数据；边表反向 JOIN 取 usages
- [ ] **Step 3: 结果排序**——精确匹配优先，其次 bm25 分数，最后文件路径

### Task 5: 端到端 + 接入 workspace

**Files:**
- Modify: `packages/code-index/package.json`（workspace 注册）
- Modify: 根 `package.json`（workspaces 字段）
- Create: `packages/code-index/test/e2e.test.ts`

- [ ] **Step 1: 写端到端测试**——对 pi-workspace 自身建索引，断言 PiHost/createSdkRuntime 可检索、findUsages 有结果
- [ ] **Step 2: workspace 接线**——根 package.json 加 `"workspaces": ["packages/*"]`，vitest 配置覆盖

---

## Electron 集成点（M1.4，独立任务）

**Files:**
- Create: `electron/indexService.ts`
- Modify: `electron/piHost.ts`（挂载 IndexService）
- Modify: `electron/preload.ts`（暴露 IPC）
- Modify: `src/shared/protocol.ts`（IndexStatus 类型 + `index_status_changed` 事件）
- Modify: `src/renderer/state/appStore.ts`（事件 reducer）
- Modify: `src/renderer/components/ResourceInspector.tsx`（索引状态面板）

- [ ] 主进程 IndexService：启动时对当前项目自动建索引，`pi:indexStatus` / `pi:indexSearch` / `pi:indexFindUsages` IPC
- [ ] `index_status_changed` 事件：索引进度推送给 renderer（补上此前发现"无事件"的设计缺陷）
- [ ] 渲染层：ResourceInspector 增加索引状态区 + 符号检索结果列表

---

## 明确的非目标（Out of Scope）

- ❌ 语义检索 / embedding（二期 B 方案：ONNX 进程内 BGE-small，**不用 Ollama**）
- ❌ 调用图深度分析（calls 边为 M1.5 可选；`calls` 全量留到 M2+）
- ❌ 跨项目检索（多项目索引为 M3+）
- ❌ 索引数据云端同步
- ❌ external-content FTS5 优化（后期）
- ❌ 语言覆盖全集（先 ts/tsx/js/py/go/rs）

---

## 验证基线

```bash
npm test -- --run       # 全量测试（含新增 code-index 测试）
npm run typecheck       # tsc 双配置
```

预期：基线绿 + 新增测试全过 + `node:sqlite` 在 Electron 43 主进程可加载。

**验收标准:**
- [ ] `createCodeIndex().index(项目根)` 在真实项目上建索引成功
- [ ] `searchSymbols("PiHost")` 类级 99%+ 命中（参照 opencode-codebase-index 实测基准）
- [ ] `findUsages("PiHost")` 返回真实引用方（含跨文件）
- [ ] 增量索引只重解析变更文件（哈希对比生效）
- [ ] 零原生模块：electron-builder 打包无需 rebuild 配置
