# CodeWiki — 迁移与整合路线图

> 分支: `opencodewiki`
> 目标: 将 codewiki 底层引擎从 GitNexus 替换为基于 Tree‑sitter 的开源方案，分阶段演进。

---

## Phase 1: codewiki 底座迁移 → codegraph

将 codewiki 的底层代码引擎从 GitNexus 替换为 **codegraph** (`@colbymchenry/codegraph`)，保持 Wiki + QA + 搜索功能不变，`codewiki/` 目录代码改动最小。

### 1.1 依赖安装

```bash
cd gitnexus    # 当前 workspace
npm install @colbymchenry/codegraph express cors
```

### 1.2 新建 HTTP Bridge

`codewiki/server/codegraph-bridge.ts`

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

将当前硬编码的 gitnexus 回调替换为 codegraph API：

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
  const nodes = cg.searchNodes(query, { limit: 10 });
  const ctx = await cg.buildContext(query);
  return { sources: nodes, flows: ctx };
};
```

| 回调 | 替换方案 |
|------|----------|
| `resolveRepo(repo)` | `CodeGraph.open(path)` |
| `resolveLLMConfig()` | 保持不变（codewiki 侧配置） |
| `searchCodebase(query, repo)` | `cg.searchNodes(q)` + `cg.buildContext(q)` |
| `listRepos()` | codewiki 维护列表 / `ToolHandler` 跨项目缓存 |
| `backend.callTool('query', ...)` | 直接调用 `cg.searchNodes()` / `cg.buildContext()` |
| `hybridSearch` / `searchFTSFromLbug` | `cg.searchNodes()` FTS5 多通道 |

### 1.4 改造 start.sh

移除 `GITNEXUS_DIR` 引用，改为 codegraph 索引入口。

### 1.5 改造 server/acp/（可选）

ACP（Agent Client Protocol）层可保留或简化。若保留需将子进程从 `kilo acp` 替换为 `codegraph serve --mcp`。

### 1.6 文件改动清单

| 文件 | 改动 |
|------|------|
| `codewiki/server/codegraph-bridge.ts` | **新建** - HTTP API 包装 ToolHandler |
| `codewiki/server/qa-endpoint.ts` | 重写回调实现 |
| `codewiki/server/acp/AcpClient.ts` | 适配 codegraph MCP 传输（可选） |
| `codewiki/start.sh` | 修改启动逻辑 |
| `codewiki/package.json` | 新增 codegraph + express 依赖 |
| `codewiki/README.md` | 更新安装步骤 |
| `codewiki/PLAN.md` | 更新架构图 |
| `codewiki/vendor/` | **不变** |
| `codewiki/qa/index.html` | **可不变** (SSE 接口兼容) |
| `codewiki/landing/index.html` | **可不变** |

### 1.7 验收标准

- [ ] `npm run dev` 启动后 codegraph 索引服务正常运行
- [ ] `POST /api/search?q=xxx` 返回 FTS5 搜索结果
- [ ] `POST /api/qa` SSE 流式问答正确返回
- [ ] `GET /codewiki/:repo/qa` Q&A 页面正常渲染
- [ ] `GET /codewiki/:repo` Wiki 概览页正常
- [ ] ACP 模式（如保留）可正常运作
- [ ] 跨仓库搜索可用

> 详见: `codewiki/RESEARCH-REPLACEMENT.md` 调研记录

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
```

### 3.6 文件改动全景

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

### 3.7 依赖

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

### 3.8 验收标准

- [ ] `hybrid_search` 返回 FTS5 + 向量的融合排序结果
- [ ] `detect_communities` 可自动聚类功能模块并自动命名
- [ ] `generate_wiki` 生成基于社区的 Markdown 导航文档
- [ ] 非代码文件（YAML/JSON/Dockerfile/SQL）被正常解析入图
- [ ] `flow_detail` 可追踪执行路径
- [ ] `impact_with_risk` 输出含风险评分的报告
- [ ] `/dashboard` 页显示 React Flow 图可视化
- [ ] `fuzzy_search` 在 FTS5 无结果时正常回退
- [ ] 增量重建时指纹检测只重编 STRUCTURAL 变更的文件

> 详见: `codewiki/RESEARCH-COMBINED.md` 融合方案设计

---

## 时间线总览

```
Phase 1 (4~6 周)   →   Phase 2 (X 周)   →   Phase 3 (6~10 周)
                        ↑
                  运行磨合 / 问题修复
```

| Phase | 内容 | 预估 |
|-------|------|------|
| **Phase 1** | codegraph 替换 gitnexus，HTTP Bridge + qa-endpoint 改造 | 4~6 周 |
| **Phase 2** | 迁移后磨合、Bug 修复、性能优化 | 待定 |
| **Phase 3** | 融合 CRG + UA 能力：向量搜索/社区/Wiki/面板/非代码解析/指纹 | 6~10 周 |
