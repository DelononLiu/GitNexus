# CodeWiki — 迁移与整合路线图

> 分支: `opencodewiki`（可独立提取为 repo）
> 目标: 将 codewiki 底层引擎从 GitNexus 替换为基于 Tree‑sitter 的开源方案，分阶段演进。

---

## Phase 0: 分支与初始化（一次性）

在 GitNexus 仓库中创建 `opencodewiki` 分支，清理无关目录，初始化 `opencodewiki/`。

完成此阶段后，后续工作全部在 `opencodewiki/` 内进行。

```bash
# ==== 创建分支 ====
git checkout -b opencodewiki

# ==== 清理无关目录 ====
# 分支内只保留 opencodewiki/ + 根级配置
# 原 codewiki/ 和 gitnexus/ 在 main 分支不受影响
rm -rf codewiki/ gitnexus/ gitnexus-web/ gitnexus-shared/ \
       gitnexus-claude-plugin/ gitnexus-cursor-integration/ eval/ \
       .github/ .husky/ .kilo/ scripts/ builtin/

# ==== 初始化 opencodewiki ====
mkdir opencodewiki && cd opencodewiki
npm init -y
npm install @colbymchenry/codegraph express cors
npm install -D typescript @types/node @types/express
```

**后续开发约束：**

| 约束 | 说明 |
|------|------|
| `opencodewiki/` 内新增修改 | ✅ 正常开发 |
| 原 `codewiki/`、`gitnexus/` | ❌ 不修改（已在分支内删除） |
| 根级 `.gitignore` | 追加 `opencodewiki/node_modules/` |
| 根级 `.prettierrc` | 复用 |

---

## Phase 1: 底座迁移（opencodewiki 内）

将 codewiki 的底层代码引擎从 GitNexus 替换为 **codegraph** (`@colbymchenry/codegraph`)，保持 Wiki + QA + 搜索功能不变。

### 迁移策略

- **增量模式**：新建 `opencodewiki/` 子目录，**不修改**原 `codewiki/` 任何文件
- **独立 repo 视角**：`opencodewiki/` 按独立仓库组织（独立 `package.json`、`tsconfig.json`），后续可直接抽出

### 1.1 目录结构

```
opencodewiki/                      ← 新增，按独立 repo 组织
├── package.json                   ← 独立依赖声明
├── tsconfig.json                  ← 独立 TypeScript 配置
├── src/
│   ├── server/
│   │   ├── qa-endpoint.ts         ← 从 codewiki/server/ 适配搬运
│   │   └── codegraph-bridge.ts    ← 新建 HTTP API
│   └── acp/                       ← 从 codewiki/server/acp/ 适配搬运
├── qa/
│   └── index.html                 ← 从 codewiki/qa/ 复制
├── landing/
│   └── index.html                 ← 从 codewiki/landing/ 复制
├── vendor/                        ← 从 codewiki/vendor/ 复制
├── start.sh                       ← 新建启动脚本
└── README.md

原 codewiki/ 目录               ← 不动，保持原样
原 gitnexus/ 目录               ← 不动，仍可独立运行
```

### 1.2 新建 HTTP Bridge

`opencodewiki/src/server/codegraph-bridge.ts`

将 `ToolHandler` 暴露为 Express HTTP 路由（codegraph 当前仅 stdio MCP，无 HTTP 端口）：

| 路由 | 后端调用 |
|------|----------|
| `POST /api/search` | `ToolHandler.execute('codegraph_search', ...)` |
| `POST /api/context` | `ToolHandler.execute('codegraph_context', ...)` |
| `POST /api/impact` | `ToolHandler.execute('codegraph_impact', ...)` |
| `GET /api/status` | `ToolHandler.execute('codegraph_status', ...)` |
| `POST /api/files` | `ToolHandler.execute('codegraph_files', ...)` |
| `POST /api/callers` | `ToolHandler.execute('codegraph_callers', ...)` |
| `POST /api/callees` | `ToolHandler.execute('codegraph_callees', ...)` |
| `POST /api/node` | `ToolHandler.execute('codegraph_node', ...)` |
| `POST /api/explore` | `ToolHandler.execute('codegraph_explore', ...)` |

### 1.3 改造 qa-endpoint.ts

**核心原则：只替换 `search()` 回调，其余逻辑不改。**

LLM 模式当前全流程：

```
question
  → resolveRepo → 读取 wiki/overview.md（系统上下文）
  → 中文检测 → 翻译英文 → 构造双语搜索语句
  → 调 search() 回调  ← 唯一依赖 gitnexus 的一环
  → 遍历每个搜索结果 → 从磁盘读实际代码片段
  → classifyQuestion → 选结构模板
  → 构造 systemPrompt（wiki + 源码片段 + execution flows + 规则）
  → 调 LLM API（streaming）→ SSE
```

`search()` 回调是 gitnexus 注入的，替换为 codegraph 调用：

```typescript
// 当前 (gitnexus)
const searchCodebase = async (query, repo) => {
  const graphResult = await backend.callTool('query', { query, repo });
  const hsResults = await hybridSearch(query, 10, ...);
  return { sources, flows };
};

// 改造后 (codegraph)
const searchCodebase = async (query, repo) => {
  const cg = await CodeGraph.open(repo.storagePath);
  const nodes = cg.searchNodes(query, { kind: undefined, limit: 10 });
  const ctx = await cg.buildContext(query);
  return { sources: nodes, flows: ctx };
};
```

| 回调 | 替换方案 |
|------|----------|
| `resolveRepo(repo)` | `CodeGraph.open(path)` |
| `resolveLLMConfig()` | 保持不变（opencodewiki 侧配置） |
| `searchCodebase(query, repo)` | `cg.searchNodes(q)` + `cg.buildContext(q)` |
| `listRepos()` | opencodewiki 维护列表 / `ToolHandler` 跨项目缓存 |
| `backend.callTool('query', ...)` | `cg.searchNodes()` + `cg.buildContext()` |
| `hybridSearch` / `searchFTSFromLbug` | `cg.searchNodes()` FTS5 多通道 |

**额外修改**：更新 systemPrompt 中硬编码的 gitnexus 工具引用：

```
- 当前: gitnexus_query → gitnexus_cypher → gitnexus_context → grep
- 改为: codegraph_search → codegraph_context → codegraph_impact → (平台 grep)
```

### 1.4 改造 start.sh

`opencodewiki/start.sh`

新建独立启动脚本，不再依赖 `GITNEXUS_DIR`：

```bash
#!/bin/bash
cd "$(dirname "$0")"
# 前置：确保目标项目已 codegraph init + index
npx tsx src/server/codegraph-bridge.ts --port 4747
```

### 1.5 ACP Agent 模式说明

ACP Agent 模式当前保留不变。Phase 1 迁移对它影响很小。

#### 架构说明

```
opencodewiki qa-endpoint.ts
  → 启动 kilo acp (Agent 运行时)      ← 不变
  → Agent 拥有两类工具:
      ├─ MCP tools (图搜索)            ← gitnexus → codegraph
      └─ 平台内置 grep/glob/read        ← 不变
  → Agent 自主决策 → 调用工具 → LLM 生成回答
```

#### 迁移改动

| 组件 | 当前 | 迁移后 |
|------|------|--------|
| MCP 工具注册 | gitnexus 注入 | codegraph MCP 注入 |
| Agent 运行时 | `kilo acp` | `kilo acp`（不变） |
| AgentManager / AcpClient | `codewiki/server/acp/` | `opencodewiki/src/acp/`（适配搬运） |
| 平台内置工具 | grep / glob / read | grep / glob / read（不变） |

#### 后续计划

- **Phase 1~3**：保留 ACP Agent 模式，仅切换 MCP 工具后端
- **Phase 4（预留）**：待纯 LLM 模式效果赶上后，移除 ACP Agent 模式，精简 opencodewiki 架构

### 1.6 文件改动清单

| 文件 | 改动 |
|------|------|
| `opencodewiki/src/server/codegraph-bridge.ts` | **新建** - HTTP API 包装 ToolHandler |
| `opencodewiki/src/server/qa-endpoint.ts` | **适配搬运** - 从 `codewiki/server/` 复制后改回调 |
| `opencodewiki/src/acp/AcpClient.ts` | **适配搬运** - MCP 端点改为 codegraph |
| `opencodewiki/src/acp/AgentManager.ts` | **适配搬运** |
| `opencodewiki/src/acp/callbacks.ts` | **适配搬运** |
| `opencodewiki/src/acp/types.ts` | **适配搬运** |
| `opencodewiki/qa/index.html` | **复制** - 从 `codewiki/qa/`，不变 |
| `opencodewiki/landing/index.html` | **复制** - 从 `codewiki/landing/`，不变 |
| `opencodewiki/vendor/` | **复制** - 从 `codewiki/vendor/`，不变 |
| `opencodewiki/start.sh` | **新建** - 独立启动脚本 |
| `opencodewiki/package.json` | **新建** - 独立依赖 |
| `opencodewiki/tsconfig.json` | **新建** - 独立 TypeScript 配置 |
| `opencodewiki/README.md` | **新建** |
| 原 `codewiki/` | **不动** |
| 原 `gitnexus/` | **不动** |

### 1.7 Q&A 两种模式说明

当前 codewiki 支持两种问答模式，迁移时需区分对待：

#### 纯 LLM 模式（默认）

```
用户提问 → qa-endpoint
  → resolveRepo + 读 wiki/overview
  → 中文翻译（如有）
  → 调 search() 回调            ← 替换: gitnexus → codegraph
  → 遍历结果 → 从磁盘读代码片段     ← 不变
  → classifyQuestion → 选结构模板  ← 不变
  → 构造 systemPrompt              ← 仅改工具名硬编码
  → 调 LLM API → SSE              ← 不变
```

迁移要点：只换 `search()` 回调实现（gitnexus → codegraph API），
其余流程（wiki 读取、代码片段提取、问题分类、prompt 构建、LLM 调用）**不修改**。

#### ACP Agent 模式（`CODEWIKI_ACP_ENABLE=true`）

```
用户提问 → qa-endpoint 把问题发给 ACP Agent
                                  ↓
                          Agent 自主决策工具调用:
                          ├─ codegraph MCP tools (图搜索)   ← 替换 gitnexus MCP
                          ├─ grep/glob/read (平台内置工具)   ← 不变
                          └─ ... (Agent 自带的 LLM)          ← 不变
```

迁移要点：Agent 模式中 `qa-endpoint.ts` **不直接调搜索**，核心改动在 MCP 工具注册：
- 当前：`api.ts` 将 gitnexus MCP tools 注入 Agent
- 迁移后：`opencodewiki` 将 codegraph MCP tools 注入 Agent
- Agent 自带的 grep/glob/read 等平台工具不受影响

Phase 3 融合后，Agent 模式还将获得额外的 MCP 工具（`hybrid_search`、`flows_list`、`impact_with_risk` 等），Agent 可自主选择使用。

### 1.8 验收标准

- [ ] `opencodewiki` 分支创建成功，无关目录已清除
- [ ] `cd opencodewiki && npm install` 完成
- [ ] codegraph 索引服务正常运行
- [ ] `POST /api/search?q=xxx` 返回 FTS5 搜索结果
- [ ] `POST /api/qa` SSE 流式问答正确返回
- [ ] Q&A 页面正常渲染（qa/index.html）
- [ ] 跨仓库搜索可用
- [ ] ACP Agent 模式（如需保留）可正常运作

> 详见: `codewiki/调研01-codegraph替换方案.md` 调研记录

---

## Phase 2: 运行磨合（预留）

Phase 2 预留给 Phase 1 迁移后的稳定性测试、问题修复、性能优化、以及日常使用中暴露的兼容性问题修复。

此阶段不引入新功能，只打磨。

---

## Phase 3: 三合一座舱底座

以 codegraph 的 TypeScript + SQLite + MCP 为骨架，将 **code-review-graph** 和 **Understand-Anything** 的关键能力用 TypeScript 重新实现注入 codegraph。

### 3.1 能力吸收清单

#### 从 code-review-graph 吸收

| 能力 | 实现方式 | 预估 |
|------|----------|------|
| 向量嵌入 + RRF 混合搜索 | `@xenova/transformers` 运行 all-MiniLM-L6-v2 + RRF 融合 FTS5 | 2~3 天 |
| 执行流追踪 | 复用 codegraph `Graph.traversal.ts` BFS，新增 entry point 检测 | 2~3 天 |
| 社区检测 (Leiden) | `graphology-communities-louvain` (npm) | 1 天 |
| Wiki 生成 | 社区结构 + ContextBuilder → Markdown | 2~3 天 |
| 影响分析风险评分 | 纯 TS 评分函数（调用者数 + 流参与 + 社区跨越 + 安全关键词 + 测试覆盖） | 1 天 |

#### 从 Understand-Anything 吸收

| 能力 | 实现方式 | 预估 |
|------|----------|------|
| 非代码解析器 ×12 | 复制 UA `plugins/parsers/` 到 `extraction/non-code/` | 0.5 天 |
| 指纹增量更新 | 替换 codegraph content_hash 为 AST 级指纹 | 2~3 天 |
| 丰富图节点类型 | 扩展 NodeKind 枚举 + SQLite schema | 1~2 天 |
| React Flow 面板 | 适配 UA dashboard 为 codewiki 新增页面 `/dashboard` | 1~2 周 |
| Fuse.js 模糊搜索回退 | `npm install fuse.js`，FTS5 无结果时降级 | 0.5 天 |
| Q&A Prompt 构建 | 替换 qa-endpoint 搜索构造为 buildChatPrompt 模式 | 1 天 |

### 3.2 数据库 Schema 扩展

当前 codegraph v4 表 → 融合后新增:

| 新增表 | 说明 | Migration |
|--------|------|-----------|
| `communities` | 社区 (id, name, level, cohesion, size, dominant_language) | v5 |
| `flows` | 执行流 (id, name, entry_point_id, depth, criticality) | v6 |
| `flow_memberships` | 流成员 (flow_id, node_id, position) | v6 |
| `embeddings` | 向量存储 (node_id, vector BLOB, model, dimension) | v7 |
| `risk_index` | 风险评分 (node_id, risk_score, caller_count, flow_participation, etc.) | v8 |
| `node_semantics` | 语义摘要 (node_id, summary, tags, complexity, updated_at) | v9 |
| `architecture_layers` | 分层映射 (node_id, layer, confidence, updated_at) | v9 |

```sql
ALTER TABLE nodes ADD COLUMN community_id INTEGER REFERENCES communities(id);
ALTER TABLE files ADD COLUMN fingerprint TEXT;
ALTER TABLE files ADD COLUMN fingerprint_kind TEXT;
```

### 3.3 MCP 工具扩展 (9 → 18+)

| 类别 | 新增工具 | 来源 |
|------|----------|------|
| 搜索 | `hybrid_search`, `semantic_search`, `fuzzy_search` | CRG, UA |
| 查询 | `flows_list`, `flow_detail` | CRG |
| 社区 | `communities_list`, `community_detail`, `architecture_overview` | CRG+UA |
| 影响 | `impact_with_risk`, `detect_changes` | CRG |
| Wiki | `wiki_generate`, `wiki_get` | CRG |
| 代码质量 | `dead_code`, `refactor_preview`, `hub_nodes`, `bridge_nodes` | CRG |
| 非代码 | `search_config` | UA |

### 3.4 搜索流程（三阶段 RRF）

```
查询 → FTS5 BM25 (最快, 精确匹配)
      → 向量余弦相似度 (语义: "cache" ↔ "ttl" ↔ "过期")
      → RRF 融合重排序
      → Fuse.js 降级回退 (当以上为空)
```

### 3.5 索引后处理流水线

```
GraphBuilder (codegraph) 
  → FTS5 重建
  → 向量嵌入生成
  → 执行流检测
  → 社区检测 (Louvain)
  → 风险评分
  → Wiki 生成
  → [可选] 语义摘要 + 架构分层   ← UA Agent 精简流水线
      ├─ file-analyzer          → 每个文件的 plain-English 摘要
      ├─ architecture-analyzer  → API/Service/Data/UI/Utility 分层
      └─ domain-analyzer        → 业务领域提取
```

可选模式：`--with-semantics` 参数触发。仅当日志有 LLM 密钥时运行。
结果写入 `node_semantics` 表和 `architecture_layers` 表，QA 时优先使用。

### 3.6 语义摘要系统（UA 核心注入）

QA 的上下文质量取决于搜索能带回多少"语义"而非仅"结构"。

#### 索引时（可选，`--with-semantics`）

```
每个节点 (函数/类/文件)
  → 调 LLM 生成:
     ├─ summary: 一两句话解释 "这个代码是做什么的"
     ├─ tags:    关键词标签 ["auth", "jwt", "middleware"]
     ├─ complexity: simple / moderate / complex
     └─ layer:   api / service / data / ui / utility
  → 存入 node_semantics + architecture_layers 表
```

#### QA 时

```typescript
const searchCodebase = async (query, repo) => {
  const cg = await CodeGraph.open(repo.storagePath);
  const nodes = cg.searchNodes(query, { limit: 10 });
  const semantics = db.prepare(`
    SELECT ns.summary, ns.tags, al.layer FROM node_semantics ns
    LEFT JOIN architecture_layers al ON al.node_id = ns.node_id
    WHERE ns.node_id = ?
  `);
  return { sources: nodes, semantics, flows: ctx };
};
```

#### 从 UA Agent 精简实现

| UA Agent | 简化实现 | 必需 |
|----------|---------|------|
| `file-analyzer` | 每个节点 → LLM → `{ summary, tags, complexity }` | ⭐ |
| `architecture-analyzer` | 文件名+引用图 → 分类到 API/Service/Data/UI/Utility | ⭐ |
| `domain-analyzer` | 按社区聚合 → LLM 提取业务领域 | 可选 |
| `project-scanner` | 整体描述（一次调用） | 可选 |
| `tour-builder` | 学习路径（LLM 重） | 后置 |
| `graph-reviewer` | 验证完整性 | 后置 |

依赖：复用 qa-endpoint 已有的 LLM 配置，无需新包。
Schema 扩展已在 v9 migration 中。

### 3.7 文件改动全景

| 目录/文件 | Phase 3 改动 |
|-----------|-------------|
| `engine/src/db/schema.sql` | +communities, flows, embeddings, fingerprints 表 |
| `engine/src/extraction/non-code/` | +12 非代码解析器 |
| `engine/src/extraction/fingerprint.ts` | +UA 指纹变更检测 |
| `engine/src/analysis/` | +flows.ts, communities.ts, risk-score.ts |
| `engine/src/search/hybrid-search.ts` | +RRF 融合 |
| `engine/src/search/vector-search.ts` | +@xenova 向量嵌入 |
| `engine/src/search/fuzzy-search.ts` | +Fuse.js |
| `engine/src/graph/flow-tracer.ts` | +执行流 |
| `engine/src/mcp/tools/` | +11 个新工具模块 |
| `engine/src/wiki/generator.ts` | +Wiki 生成 |
| `server/qa-endpoint.ts` | +向量搜索 + 社区上下文 |
| `dashboard/` | +React Flow 面板 |

### 3.8 依赖

```bash
# 向量 + 搜索增强
npm install @xenova/transformers fuse.js

# 社区 + 图算法
npm install graphology graphology-communities-louvain \
            graphology-betweenness-centrality graphology-hubs

# 非代码解析
npm install yaml js-yaml smol-toml dockerfile-ast \
            graphql protobuf-parser hcl2-parser
```

### 3.9 验收标准

- [ ] `hybrid_search` 返回 FTS5 + 向量的融合排序结果
- [ ] `detect_communities` 可自动聚类功能模块并自动命名
- [ ] `generate_wiki` 生成基于社区的 Markdown 导航文档
- [ ] 非代码文件（YAML/JSON/Dockerfile/SQL）被正常解析入图
- [ ] `flow_detail` 可追踪执行路径
- [ ] `impact_with_risk` 输出含风险评分的报告
- [ ] `/dashboard` 页显示 React Flow 图可视化
- [ ] `fuzzy_search` 在 FTS5 无结果时正常回退
- [ ] 增量重建时指纹检测只重编 STRUCTURAL 变更的文件

> 详见: `codewiki/调研02-三合一融合方案.md` 融合方案设计

---

## 时间线总览

```
Phase 1 (4~6 周)   →   Phase 2 (X 周)   →   Phase 3 (6~10 周)   →   Phase 4 (待定)
                        ↑                        ↑
                  运行磨合 / 问题修复          ACP Agent 模式可移除
```

| Phase | 内容 | 预估 |
|-------|------|------|
| **Phase 1** | codegraph 替换 gitnexus，HTTP Bridge + qa-endpoint 改造 | 4~6 周 |
| **Phase 2** | 迁移后磨合、Bug 修复、性能优化 | 待定 |
| **Phase 3** | 融合 CRG + UA 能力：向量搜索/社区/Wiki/面板/非代码解析/指纹 | 6~10 周 |
| **Phase 4** | （预留）纯 LLM 模式效果达标后，移除 ACP Agent 模式 | 待定 |
