# CodeWiki 底层引擎替换调研报告

> 创建分支 `opencodewiki`，将 codewiki 的底层代码引擎从 GitNexus 替换为基于 Tree‑sitter 的替代方案，保持 Wiki + QA + 搜索功能不变，且 `codewiki/` 目录代码改动最小。

## 调研范围

候选仓库（均在 `~/Code/` 下）：

| 仓库 | 语言 | 初筛结果 |
|------|------|----------|
| `codegraph` | TypeScript | ✅ 进入二期 |
| `CodeGraphContext` | Python | ❌ Python 栈、无 QA、996 文件过于庞大 |
| `code-review-graph` | Python | ✅ 进入二期 |
| `code-graph-rag` | Python | ❌ 需 Docker (Memgraph)，太重 |
| `graphify` | Python | ❌ 无 FTS 搜索、MCP 工具少 |
| `Understand-Anything` | TypeScript | ✅ 进入二期 |

硬性条件：必须基于 **Tree‑sitter**（或类似 AST 技术）。全部通过。

---

## 第一阶段：初筛

### 淘汰原因

| 仓库 | 淘汰原因 |
|------|----------|
| **CodeGraphContext** | Python 栈，文件数 ~996，21 个 MCP 工具但无 QA 管道，嵌入仅供索引消歧而非 QA |
| **code-graph-rag** | Python 栈，强依赖 Docker 运行 Memgraph，启动成本高；503 文件数偏大 |
| **graphify** | Python 栈，图存在 NetworkX 内存中 (graph.json 序列化)，无 FTS 搜索，MCP 工具少（仅 4 个） |

### 入选 Phase 2 原因

| 仓库 | 入选理由 |
|------|----------|
| **codegraph** | TypeScript 同栈，SQLite FTS5 搜索，9 个 MCP 工具，`CodeGraph` 类可直接 npm import |
| **code-review-graph** | 28 个 MCP 工具覆盖最全，FTS5 + 向量混合搜索，内置 Wiki 生成，社区检测 + 执行流追踪 |
| **Understand-Anything** | TypeScript 同栈，图模式最丰富（21 节点 × 35 边），42 语言配置，指纹增量更新 |

---

## 第二阶段：深度对比

### 1. codegraph

**基本信息**

| 属性 | 值 |
|------|------|
| 路径 | `~/Code/codegraph/` |
| 语言 | TypeScript (98%) |
| 包名 | `@colbymchenry/codegraph` (npm) |
| 版本 | 0.8.0 (MIT) |
| Node | >=20.0.0 <25.0.0 |
| 文件数 | ~156（源码 96 TS 文件） |

**核心架构**

```
codegraph/
├── src/
│   ├── extraction/    # Tree-sitter WASM 解析 (19 语言)
│   │   └── languages/ # 语言提取器 (每个语言一个)
│   ├── graph/         # 内存图 + BFS 遍历
│   ├── db/            # SQLite 适配 (better-sqlite3 + WASM 回退)
│   │   ├── schema.sql # 6 表 + FTS5 + 17 索引
│   │   └── queries.ts # SQL 查询层 (1454 行)
│   ├── search/        # FTS5 + LIKE + 模糊 + CamelCase 多通道搜索
│   ├── context/       # 多阶段上下文构建器 (1134 行)
│   ├── mcp/           # MCP 服务器 (stdio 传输, 9 工具)
│   └── bin/           # CLI 入口 (commander)
```

**数据库表**

| 表 | 说明 |
|------|------|
| `nodes` | 代码符号 (id, kind, name, qualified_name, file_path, language, start_line, end_line, docstring, signature, visibility, is_exported) |
| `edges` | 关系 (source, target, kind, line, col, provenance) |
| `files` | 文件清单 (path, content_hash, language, size, modified_at, indexed_at) |
| `unresolved_refs` | 未解析引用 |
| `nodes_fts` | FTS5 全文搜索虚拟表 |
| `project_metadata` | KV 存储 |
| `schema_versions` | 迁移版本 (当前 v4) |

**9 个 MCP 工具**

| 工具 | 功能 | 等价于 GitNexus |
|------|------|------------------|
| `codegraph_search` | FTS5 多通道搜索 | `hybridSearch` / `searchFTSFromLbug` |
| `codegraph_context` | 自然语言上下文构建 | `gitnexus_context` |
| `codegraph_callers` | 查找调用者 | 上游影响 |
| `codegraph_callees` | 查找被调用者 | 下游追踪 |
| `codegraph_impact` | 冲突半径分析 (BFS, 可配深度) | `gitnexus_impact` |
| `codegraph_node` | 单个符号详情 + 源码 | 符号详情 |
| `codegraph_explore` | 多文件上下文探索 | `gitnexus_query` 流程查询 |
| `codegraph_files` | 文件结构浏览 | 文件树 |
| `codegraph_status` | 索引统计 | 索引状态 |

**集成方式**

```typescript
import CodeGraph from '@colbymchenry/codegraph';

// 打开项目
const cg = await CodeGraph.open('/path/to/repo');

// 搜索
const results = cg.searchNodes('UserService', { kind: 'function', limit: 10 });

// 上下文
const ctx = await cg.buildContext('how does auth work?', { format: 'markdown' });

// 影响分析
const impact = await cg.getImpactRadius('node-id-123', 2);
```

**与 codewiki 接口映射**

| `qa-endpoint.ts` 中引用的回调 | codegraph 替换方案 |
|------|------|
| `resolveRepo(repo)` → 获取 `storagePath` | `CodeGraph.open(path)` 替换，codegraph 自管理存储路径 |
| `resolveLLMConfig()` → LLM 配置 | 保持不变，codewiki 侧无需修改 |
| `searchCodebase(query, repo)` → 搜索+流程 | `cg.searchNodes(q)` + `cg.buildContext(q)` |
| `listRepos()` → 注册仓库列表 | `ToolHandler` 跨项目缓存，或 codewiki 维护列表 |
| 后端 MCP `callTool('query', ...)` | 直接调用 `cg.searchNodes()` / `cg.buildContext()` |
| `hybridSearch` / `searchFTSFromLbug` | `cg.searchNodes()` FTS5 多通道 |

**差距分析**

| 缺失功能 | 难度 | 预估工作量 |
|----------|------|-----------|
| HTTP API (当前仅 stdio MCP) | 低 | 2~3 天 (Express 包装 ToolHandler) |
| 向量搜索 / RAG | 中 | 1~2 周 (sqlite-vec + LLM 管道) |
| Wiki 页面生成 | 中 | 2~3 周 (ContextBuilder 输出 + LLM 合成) |
| 跨仓库存储 | 已有 | `projectPath` 参数 |

**关键依赖**

| 包 | 用途 |
|------|------|
| `web-tree-sitter` ^0.25.3 | WASM 解析器 |
| `tree-sitter-wasms` ^0.1.11 | 19 语言 WASM grammar |
| `better-sqlite3` ^12.4.1 | SQLite (native) |
| `node-sqlite3-wasm` ^0.8.30 | SQLite WASM 回退 |
| `commander` ^14.0.2 | CLI |

---

### 2. code-review-graph

**基本信息**

| 属性 | 值 |
|------|------|
| 路径 | `~/Code/code-review-graph/` |
| 语言 | Python 3.10+ |
| 包名 | `code-review-graph` (PyPI) |
| 版本 | 2.3.3 |
| 文件数 | ~245（37 Python 源文件） |

**核心架构**

```
code_review_graph/
├── main.py          # MCP 服务器入口 (FastMCP)
├── cli.py           # Typer CLI (build, update, serve, watch, daemon)
├── graph.py         # 图存储 (SQLite + NetworkX)
├── analysis.py      # 图分析 (介数中心性, Hub/桥节点)
├── parser.py        # Tree-sitter AST 解析 (6829 行, 24+ 语言)
├── search.py        # 混合搜索 (FTS5 BM25 + 向量 RRF)
├── embeddings.py    # 向量嵌入 (sentence-transformers, Gemini, OpenAI)
├── incremental.py   # 增量更新 (SHA-256 diff)
├── changes.py       # 变更分析 (git diff → 影响 → 风险评分)
├── wiki.py          # Wiki 生成 (社区结构 → Markdown)
├── migrations.py    # Schema 迁移
├── registry.py      # 多仓库注册表
└── tools/           # 28 个 MCP 工具
    ├── build.py     # 索引构建
    ├── query.py     # 查询 + 影响分析
    ├── context.py   # 最小上下文构建
    ├── review.py    # 审查 + 变更检测
    └── ...
```

**28 个 MCP 工具 (选列)**

| 工具 | 功能 | 与 codewiki 相关度 |
|------|------|-------------------|
| `build_or_update_graph_tool` | 增量/全量索引 | ★★★★★ 替换 analyze |
| `get_minimal_context_tool` | ~100 token 超紧凑上下文 | ★★★★☆ 替换 context |
| `get_impact_radius_tool` | BFS/SQLite CTE 影响分析 | ★★★★★ 替换 impact |
| `query_graph_tool` | 预定义查询 (调用者/被调用者/继承者/测试等) | ★★★★☆ 替换 query |
| `semantic_search_nodes_tool` | FTS5 + 向量混合搜索 (RRF) | ★★★★★ 替换 searchCodebase |
| `generate_wiki_tool` | 社区 Markdown Wiki 生成 | ★★★★☆ Wiki 生成 |
| `get_community_tool` | 社区详情 | ★★★☆☆ 架构概览 |
| `detect_changes_tool` | git diff → 风险评分 → 测试缺口 | ★★★☆☆ 变更分析 |
| `embed_graph_tool` | 计算向量嵌入 | ★★★☆☆ RAG 基础 |
| `refactor_tool` | 重命名预检/死代码检测 | ★★☆☆☆ 可选 |

**数据库表**

| 表 | 说明 |
|------|------|
| `nodes` | 代码符号 (id, kind, name, qualified_name, file_path, line_start, line_end, language, signature 等) |
| `edges` | 关系 (kind, source_qualified, target_qualified, file_path, line, confidence_tier) |
| `flows` | 执行流 (id, name, entry_point_id, depth, node_count, criticality) |
| `flow_memberships` | 流成员 (flow_id, node_id, position) |
| `communities` | 社区 (id, name, level, cohesion, size, dominant_language) |
| `community_summaries` | 社区摘要 |
| `nodes_fts` | FTS5 虚拟表 |
| `embeddings` | 向量存储 (qualified_name, vector BLOB, provider) |
| `risk_index` | 预计算风险评分 |
| `metadata` | KV 元数据 |

**集成方式 (从 TypeScript)**

```typescript
// 方案 A: 直接读 SQLite (最快)
import Database from 'better-sqlite3';
const db = new Database('/repo/.code-review-graph/graph.db');
const results = db.prepare(`
  SELECT n.* FROM nodes_fts f JOIN nodes n ON f.rowid = n.id
  WHERE nodes_fts MATCH ? ORDER BY rank
`).all('"auth"');

// 方案 B: MCP streamable-http
// code-review-graph serve --http --port 5555
const res = await fetch('http://127.0.0.1:5555/messages/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'tools/call',
    params: { name: 'semantic_search_nodes_tool', arguments: { query: 'auth', limit: 10 } }
  })
});

// 方案 C: 子进程 stdio MCP (通过 @modelcontextprotocol/sdk)
```

**差距分析**

| 缺失功能 | 难度 | 说明 |
|----------|------|------|
| TypeScript 原生接口 | 低 | SQLite 直读绕过 MCP 协议，TypeScript 直接 `better-sqlite3` |
| REST HTTP API | 中 | 目前仅 MCP-over-HTTP (streamable-http)，非 REST。可写薄 Python FastAPI 或 TypeScript 侧 SQLite 直读 |
| Q&A 管道 | 中 | 有向量搜索和 Wiki 生成，但无组合好的 Q&A 端点。需在 codewiki 侧组装：检索 → LLM → 流式响应 |
| 嵌入向量索引 | 低 | 当前全表扫描余弦相似度，大数据集需加向量索引 |

**关键依赖**

| 包 | 用途 |
|------|------|
| `tree-sitter>=0.23.0` | AST 解析 |
| `tree-sitter-language-pack>=0.3.0` | 24+ 语言 grammar |
| `networkx>=3.2` | 图算法 |
| `fastmcp>=3.2.4` | MCP 服务器框架 |
| `watchdog>=4.0.0` | 文件监听 |
| `sentence-transformers>=3.0.0` (可选) | 本地向量嵌入 |

---

### 3. Understand-Anything

**基本信息**

| 属性 | 值 |
|------|------|
| 路径 | `~/Code/Understand-Anything/understand-anything-plugin/` |
| 语言 | TypeScript (95%) + Python 辅助脚本 |
| 包名 | `@understand-anything/core` (workspace, 未发布 npm) |
| 版本 | 2.7.5 |
| 文件数 | ~403（60 TS 核心 + 35 React 组件） |

**核心架构**

```
packages/
├── core/src/           # 核心引擎
│   ├── index.ts        # 主出口 (GraphBuilder, SearchEngine, 类型)
│   ├── search.ts       # Fuse.js 模糊搜索 (浏览器安全)
│   ├── embedding-search.ts  # 余弦相似度语义搜索
│   ├── analyzer/       # 分析器: graph-builder.ts, fingerprint.ts
│   ├── languages/      # 语言注册表 + Framework 注册表
│   │   └── extractors/ # 8 语言提取器 + 13 非代码解析器
│   ├── plugins/        # TreeSitterPlugin, PluginRegistry
│   └── types.ts        # 21 节点类型 × 35 边类型
├── dashboard/src/      # React 19 + React Flow 可视化面板
└── skill/              # Claude Code 插件层
```

**图模式 (21 节点类型)**

| 类别 | 类型 |
|------|------|
| 代码 | `file`, `function`, `class`, `module`, `concept` |
| 非代码 | `config`, `document`, `service`, `table`, `endpoint`, `pipeline`, `schema`, `resource` |
| 领域 | `domain`, `flow`, `step` |
| 知识 | `article`, `entity`, `topic`, `claim`, `source` |

**42 种语言配置**

| 类别 | 覆盖 |
|------|------|
| 代码语言 | TypeScript/JS, Python, Go, Rust, Java, Ruby, PHP, C/C++, C# |
| 框架 | NestJS, Express, React, Vue, Django, Flask, FastAPI, Spring, Rails, Gin |
| 非代码解析器 | Markdown, YAML, JSON, TOML, Env, Dockerfile, SQL, GraphQL, Protobuf, Terraform, Makefile, Shell |

**集成方式**

```typescript
import { SearchEngine, GraphBuilder, buildChatContext } from '@understand-anything/core';
import { KnowledgeGraphSchema } from '@understand-anything/core/types';

// 构建图 (需先跑 Agent pipeline 或手动调用 GraphBuilder)
const graph = GraphBuilder.fromFileAnalysis(fileAnalysisResults);

// 搜索
const engine = new SearchEngine(graph);
const results = engine.search('auth middleware', { type: 'function', limit: 10 });

// Q&A 上下文
const ctx = buildChatContext(graph, 'how does authentication work?');
// → 返回: { nodes, edges, layers } 结构化数据
```

**差距分析**

| 缺失功能 | 难度 | 说明 |
|----------|------|------|
| MCP 服务器 | 中 | 需用 `@modelcontextprotocol/sdk` 从零搭建 |
| HTTP/REST API | 中 | 当前仅 Vite 中间件 (文件服务, 非搜索 API) |
| 独立 CLI | 中 | 当前需 Claude Code Agent 流水线；GraphBuilder 可编程调用但无 CLI |
| Q&A 完整管道 | 中 | `buildChatPrompt` 是提示构建器，非 LLM 调用器；需自行对接 |
| Wiki 生成 | 中 | 仅有 `buildOnboardingGuide()` 生成单文档 |
| 确定性元数据 | 中 | 摘要/标签/复杂度依赖 LLM；需加确定性回退 |
| 跨仓库 | 高 | 每个仓库独立 `.understand-anything/` |
| 向量嵌入生成 | 中 | `SemanticSearchEngine` 需外部提供嵌入 |

---

## 综合对比

| 维度 (权重) | codegraph | code-review-graph | Understand-Anything |
|---|---|---|---|
| **同栈 (TypeScript)** ★ | ✅ 原生 TS | ❌ Python | ✅ 原生 TS |
| **npm import** ★ | ✅ `@colbymchenry/codegraph` | ⚠️ SQLite 直读 / 子进程 | ✅ `@understand-anything/core` |
| **数据库** ★ | ✅ SQLite FTS5 | ✅ SQLite FTS5 + 向量 | ❌ JSON 内存加载 |
| **MCP 工具** ★ | ✅ 9 个 | ✅ 28 个 (最全) | ❌ 需自建 |
| **FTS 搜索** ★ | ✅ 多通道 (FTS5+LIKE+模糊+CamelCase) | ✅ FTS5 BM25 + 向量 RRF | ⚠️ Fuse.js 仅模糊 |
| **HTTP API** | ❌ 需自建 (2~3 天) | ⚠️ MCP-over-HTTP | ❌ 需自建 |
| **RAG/QA** | ❌ 需自建 (1~2 周) | ⚠️ 有向量搜索 + LLM 管道件 | ⚠️ 有提示构建器 |
| **Wiki 生成** | ❌ 需自建 (2~3 周) | ✅ 社区结构 Wiki | ⚠️ 入门指南 |
| **增量更新** | ✅ 原生 OS 文件监听 | ✅ Watchdog 守护进程 + 增量 | ✅ 指纹变更检测 |
| **影响分析** | ✅ BFS 冲突半径 | ✅ SQLite CTE + 风险评分 | ✅ Diff 上下文 |
| **跨仓库** | ✅ projectPath 参数 | ✅ Registry 注册表 | ❌ 不支持 |
| **语言覆盖** | 19 语言 | 24+ 语言 | 10 代码 + 30+ 非代码 |
| **活跃维护** | ⚠️ 0.8.0 (pre-1.0) | ✅ 2.3.3 (稳定) | ✅ 2.7.5 (稳定) |

---

## 最终推荐排序

### 首选: codegraph

**理由**

1. **TypeScript 同栈** — 与 codewiki 代码风格、构建工具、运行时完全一致。`qa-endpoint.ts` 无需跨语言桥接。
2. **npm 库集成** — `npm install @colbymchenry/codegraph` 后直接 `import CodeGraph from '@colbymchenry/codegraph'`，codewiki 改动最小。
3. **SQLite FTS5 搜索** — 多通道搜索策略 (FTS5 + LIKE + 模糊 + CamelCase + 位置加权) 整体优于 gitnexus 的 ladybugdb + FTS。
4. **`ContextBuilder`** — 多阶段流水线 (混合搜索 → 协同定位增强 → 类型层次 → BFS → 多样性上限) 可直接驱动 FAQ 检索。
5. **集成路径清晰** — `ToolHandler` 抽离了业务逻辑，`ToolHandler.execute('codegraph_search', args)` 可直接在 Express 路由中调用。

**需要的补充工作**

| 工作项 | 预估 | 优先级 |
|--------|------|--------|
| HTTP API 层 (Express 包装 ToolHandler) | 2~3 天 | P0 (基础通信) |
| 修改 `qa-endpoint.ts` 回调实现 | 3~5 天 | P0 (核心替换) |
| 嵌入向量 + RAG 管道 | 1~2 周 | P1 (QA 增强) |
| Wiki 生成 (ContextBuilder + LLM) | 2~3 周 | P2 (Wiki 保留) |

### 次选: code-review-graph

**理由**

功能覆盖最全：28 个 MCP 工具、向量搜索、社区 Wiki 生成、执行流追踪、高级影响分析 (SQLite CTE + 风险评分)。SQLite 直读模式 (TypeScript 侧 `better-sqlite3`) 绕过 Python 栈差异，达到与同栈接近的集成体验。

**适用场景**

- 需要「开箱即用」最多功能
- 能接受 Python 子进程管理 (build/update 涉及写操作)
- 需要向量搜索做语义检索

### 三选: Understand-Anything

**理由**

图模式最丰富 (21 节点 × 35 边)、42 语言配置含非代码文件、指纹增量更新、现成 React 面板。但缺少 MCP 服务器和 HTTP API 需要从零搭建两层基础设施，JSON 文件存储在大代码库中内存占用高，LLM Agent 流水线让全确定性运行复杂。

---

## 推荐行动路径

```
opencodewiki 分支
│
├─ 第 1 步: 安装 codegraph 依赖
│   npm install @colbymchenry/codegraph
│
├─ 第 2 步: 新建 server/codegraph-bridge.ts
│   └─ Express 路由包装 ToolHandler
│   │   POST /api/search  → codegraph_search
│   │   POST /api/context → codegraph_context
│   │   POST /api/impact  → codegraph_impact
│   │   GET  /api/status  → codegraph_status
│
├─ 第 3 步: 修改 qa-endpoint.ts
│   └─ 替换回调:
│   │   resolveRepo     → CodeGraph.open()
│   │   searchCodebase  → cg.searchNodes() + cg.buildContext()
│   │   listRepos       → codewiki 维护列表
│   │   (resolveLLMConfig → 保持不变)
│
├─ 第 4 步: 更新 start.sh
│   └─ 移除 GITNEXUS_DIR 引用，改为 codegraph 索引
│
└─ 第 5 步: 添加 RAG (可选)
    └─ sqlite-vec / chromadb + LLM 流式管道
```

**预计最小改动的文件**

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `codewiki/server/qa-endpoint.ts` | 重写回调实现 | 将 gitnexus 回调切为 codegraph API 调用 |
| `codewiki/server/codegraph-bridge.ts` | 新建 | HTTP API 包装 ToolHandler |
| `codewiki/start.sh` | 修改 | 启动脚本适配 codegraph |
| `codewiki/vendor/` | 不变 | 前端 CDN 资源无需改动 |
| `codewiki/qa/index.html` | 可不变 | 前端 SSE 接口兼容 |
| `codewiki/landing/index.html` | 可不变 | 前端页面兼容 |
| `codewiki/server/acp/` | 可能删减 | ACP 集成可保留或移除 |
| `codewiki-cd/package.json` | 新增 | codegraph 依赖 |
| `codewiki/README.md` | 更新 | 安装步骤 |
| `codewiki/PLAN.md` | 更新 | 架构图 |

---

## 附录

### codegraph 快速体验

```bash
cd ~/Code/目标项目
npx @colbymchenry/codegraph init
npx @colbymchenry/codegraph index
npx @colbymchenry/codegraph query "auth" --json
npx @colbymchenry/codegraph status --json
```

### code-review-graph 快速体验

```bash
pip install code-review-graph
cd ~/Code/目标项目
code-review-graph build
code-review-graph query "auth"
code-review-graph serve --http --port 5555
```

### 各仓库文件数统计 (不含 node_modules/.git)

| 仓库 | 文件数 | 源码行数 |
|------|--------|----------|
| codegraph | ~156 | ~30,000 |
| CodeGraphContext | ~966 | ~80,000 |
| code-review-graph | ~245 | ~60,000 |
| code-graph-rag | ~503 | ~60,000 |
| graphify | ~261 | ~51,770 |
| Understand-Anything | ~403 | ~50,000 |

---

> 调研日期: 2026-05-30 · 调研范围: `~/Code/` 下 6 个仓库
