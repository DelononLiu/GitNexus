# Phase 2 — 三合一融合底座方案

> 在 Phase 1（codegraph 替代 gitnexus）基础之上，**吸取 code-review-graph 和 Understand-Anything 各自优势，融合三者**，形成 opencodewiki 的统一底座引擎。

---

## 总体思路

以 **codegraph** 的 SQLite + FTS5 + MCP 架构为骨架，将 **code-review-graph** 的向量搜索/流追踪/社区分析 和 **Understand-Anything** 的非代码解析/指纹更新/丰富图表/可视化面板 的关键能力**用 TypeScript 重新实现并注入** codegraph 框架中。

```
opencodecode/
│
├── engine/              ← codegraph fork + 三方融合
│   ├── schema.sql       ← 扩展表: flows, communities, embeddings, fingerprints
│   └── src/
│       ├── extraction/  ← + UA 非代码解析器 + UA 指纹
│       ├── analysis/    ← 新增: 社区检测, 流追踪, 风险评分
│       ├── search/      ← + 向量混合搜索 (RRF) + Fuse.js 回退
│       ├── graph/       ← + 执行流 (+UA 丰富节点类型)
│       └── mcp/         ← 工具从 9 扩到 18+
│
├── server/              ← codewiki HTTP 层 (Phase 1)
├── dashboard/           ← UA React Flow 面板 (适配)
├── qa/                  ← codewiki 原有前端
└── vendor/              ← CDN 资源
```

---

## 能力吸收清单

### 从 code-review-graph 吸收

| 能力 | CRG 实现 | 融合方案 | 可行性 |
|------|----------|----------|--------|
| **向量嵌入 + 混合搜索** | Python sentence-transformers + RRF | TS 侧: `@xenova/transformers` (运行 all-MiniLM-L6-v2) + `sqlite-vec` | ✅ 高 — TypeScript 生态有完整替代 |
| **执行流追踪** | SQLite CTE 递归 + NetworkX BFS | codegraph 已有 `Graph.traversal.ts` BFS，增加 flow detection | ✅ 高 — 复用现有图遍历 |
| **社区检测** | Python igraph (Leiden) | TS: `graphology-communities-louvain` (UA 已用) | ✅ 高 — npm 包直接可用 |
| **Wiki 生成** | 社区结构 → Markdown | TS 重新实现: 基于 ContextBuilder 输出 | ✅ 高 — 纯文本处理 |
| **影响分析风险评分** | 调用者数 + 流参与 + 社区跨越 + 测试 + 安全关键词 | TS 实现评分函数 | ✅ 高 — 纯计算逻辑 |

### 从 Understand-Anything 吸收

| 能力 | UA 实现 | 融合方案 | 可行性 |
|------|---------|----------|--------|
| **非代码解析器** | 12 个 `AnalyzerPlugin`: YAML, JSON, TOML, Env, Dockerfile, SQL, GraphQL, Protobuf, Terraform, Makefile, Shell, Markdown | 直接代码搬运到 codegraph 的 `extraction/` 层 | ✅ 高 — 每个 ~100-200 行, 纯 TS |
| **指纹增量更新** | `extractFileFingerprint()` → `compareFingerprints()` → NONE/COSMETIC/STRUCTURAL | 替换 codegraph 当前 `content_hash` 为 AST 级指纹 | ✅ 中高 — 需集成到 extraction pipeline |
| **丰富图节点类型** | 21 节点类型 vs codegraph ~22 种 — 新增非代码类型 | 扩展 `NodeKind` 枚举 + SQLite schema 新增行 | ✅ 高 — 分布式添加 |
| **React Flow 面板** | React 19 + React Flow + Zustand + TailwindCSS v4 | 适配后作为 codewiki 新增页面 | ✅ 中高 — 需处理依赖版本 |
| **Fuse.js 模糊搜索回退** | 加权字段模糊搜索 (name 0.4, tags 0.3, summary 0.2) | 作为 FTS5 无结果的回退层 | ✅ 高 — Fuse.js 无依赖 |
| **Q&A Prompt 构建** | `buildChatPrompt()` — 搜索 + 1 跳扩展 + 层次上下文 | 替换 `qa-endpoint.ts` 的搜索构造 | ✅ 高 |

---

## 架构设计

### 整体模块结构

```
engine/
├── src/
│   ├── extraction/           ← codegraph 原有
│   │   ├── tree-sitter.ts    ← Tree-sitter WASM 解析
│   │   ├── grammars.ts       ← 19 语言 grammar
│   │   ├── languages/        ← 语言提取器 (每个语言)
│   │   ├── non-code/         ← [新增] UA 12 非代码解析器
│   │   │   ├── yaml-parser.ts
│   │   │   ├── json-parser.ts
│   │   │   ├── dockerfile-parser.ts
│   │   │   ├── sql-parser.ts
│   │   │   └── ...
│   │   └── fingerprint.ts    ← [新增] UA 指纹变更检测
│   │
│   ├── analysis/             ← [新增] 后处理分析层
│   │   ├── communities.ts    ← Louvain 社区检测 (graphology)
│   │   ├── flows.ts          ← 执行流追踪 (BFS/DFS)
│   │   ├── risk-score.ts     ← 风险评分计算
│   │   └── postprocess.ts    ← 运行全部后处理
│   │
│   ├── search/               ← codegraph 原有 + 增强
│   │   ├── query-engine.ts   ← FTS5 多通道搜索 (原)
│   │   ├── hybrid-search.ts  ← [新增] FTS5 + 向量 RRF 融合
│   │   ├── vector-search.ts  ← [新增] cosine 相似度搜索
│   │   └── fuzzy-search.ts   ← [新增] Fuse.js 回退
│   │
│   ├── graph/                ← codegraph 原有 + 增强
│   │   ├── traversal.ts      ← BFS/DFS 图遍历 (原)
│   │   ├── flow-tracer.ts    ← [新增] 执行流追踪逻辑
│   │   └── schema.ts         ← [新增] 扩展节点类型枚举
│   │
│   ├── mcp/                  ← codegraph 原有 + 扩展
│   │   ├── index.ts          ← MCP 服务器入口
│   │   ├── transport.ts      ← 传输层 (stdio)
│   │   ├── tools.ts          ← [扩展] 工具注册 (9→18+)
│   │   └── tools/            ← [新增] 细分工具模块
│   │       ├── search.ts     ← search / hybrid_search / semantic_search
│   │       ├── query.ts      ← flows_list / flow_detail / communities
│   │       ├── impact.ts     ← impact_with_risk / detect_changes
│   │       ├── wiki.ts       ← wiki_generate / wiki_get
│   │       └── refactor.ts   ← refactor_preview / dead_code
│   │
│   ├── db/                   ← codegraph 原有
│   │   ├── schema.sql        ← [扩展] 新增表
│   │   ├── queries.ts        ← [扩展] 新增查询
│   │   └── migrations.ts     ← [扩展] 新增迁移 v5-v7
│   │
│   └── wiki/                 ← [新增] Wiki 生成引擎
│       └── generator.ts      ← 社区 + 流 → Markdown
│
├── dashboard/                ← [新增] UA React Flow 面板
│   └── src/
│       ├── App.tsx           ← 适配后的主页面
│       ├── GraphCanvas/      ← React Flow 可视化
│       ├── SearchBar/        ← 搜索组件
│       └── panels/           ← 信息面板
│
└── server/                   ← codewiki HTTP 层
    ├── qa-endpoint.ts        ← 增强: 向量搜索 + 社区上下文
    └── codegraph-bridge.ts   ← HTTP API 包装
```

### 数据库 Schema 扩展

当前 codegraph schema v4 (6 表)，融合后需新增 migration v5-v7：

```sql
-- === Migration v5: 社区检测 ===
CREATE TABLE IF NOT EXISTS communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    level INTEGER DEFAULT 0,
    parent_id INTEGER,
    cohesion REAL DEFAULT 0,
    size INTEGER DEFAULT 0,
    dominant_language TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES communities(id)
);

CREATE INDEX idx_communities_level ON communities(level);
CREATE INDEX idx_communities_cohesion ON communities(cohesion DESC);

ALTER TABLE nodes ADD COLUMN community_id INTEGER REFERENCES communities(id);

-- === Migration v6: 执行流 ===
CREATE TABLE IF NOT EXISTS flows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    entry_point_id TEXT NOT NULL,
    depth INTEGER DEFAULT 0,
    node_count INTEGER DEFAULT 0,
    file_count INTEGER DEFAULT 0,
    criticality REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (entry_point_id) REFERENCES nodes(id)
);

CREATE TABLE IF NOT EXISTS flow_memberships (
    flow_id INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (flow_id, node_id),
    FOREIGN KEY (flow_id) REFERENCES flows(id),
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

CREATE INDEX idx_flows_criticality ON flows(criticality DESC);
CREATE INDEX idx_flow_memberships_node ON flow_memberships(node_id);

-- === Migration v7: 向量嵌入 ===
CREATE TABLE IF NOT EXISTS embeddings (
    node_id TEXT PRIMARY KEY,
    vector BLOB NOT NULL,
    model TEXT NOT NULL,
    dimension INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);

ALTER TABLE files ADD COLUMN fingerprint TEXT;       -- AST 指纹
ALTER TABLE files ADD COLUMN fingerprint_kind TEXT;  -- structural / cosmetic

-- === Migration v8: 风险评分 ===
CREATE TABLE IF NOT EXISTS risk_index (
    node_id TEXT PRIMARY KEY,
    risk_score REAL DEFAULT 0,
    caller_count INTEGER DEFAULT 0,
    flow_participation INTEGER DEFAULT 0,
    community_crossings INTEGER DEFAULT 0,
    security_relevant INTEGER DEFAULT 0,
    last_computed INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id)
);
```

### 搜索融合策略 (三阶段 RRF)

```
用户查询 "如何实现缓存失效"
       │
       ▼
┌──────────────────────┐
│  阶段 1: FTS5 BM25   │ ← codegraph 现有
│  nodes_fts MATCH ?   │   最快, 名称/文档/签名精确匹配
└─────────┬────────────┘
          │ 结果集 A
          ▼
┌──────────────────────┐
│  阶段 2: 向量相似度   │ ← [新增] 从 CRG
│  cosine(嵌入, 查询)   │   语义匹配: "cache"↔"ttl"↔"过期"
└─────────┬────────────┘
          │ 结果集 B
          ▼
┌──────────────────────┐
│  阶段 3: RRF 融合     │ ← [新增] 从 CRG
│  reciprocal rank     │   合并结果 A + B, 重排序
└─────────┬────────────┘
          │
          ▼
┌──────────────────────┐
│  Fuse.js 回退        │ ← [新增] 从 UA
│  当 A+B 为空时备用    │   模糊匹配非代码字段
└──────────────────────┘
```

### MCP 工具扩展 (9 → 18+)

| 类别 | 工具名 | 来源 | 说明 |
|------|--------|------|------|
| **搜索** | `search` | codegraph | FTS5 多通道搜索 (原) |
| | `hybrid_search` | CRG | FTS5 + 向量 RRF 融合 |
| | `semantic_search` | CRG | 纯向量余弦相似度 |
| | `fuzzy_search` | UA | Fuse.js 模糊回退 |
| **查询** | `context` | codegraph | 自然语言上下文 (原) |
| | `node` | codegraph | 单个符号详情 (原) |
| | `explore` | codegraph | 多文件探索 (原) |
| | `files` | codegraph | 文件浏览 (原) |
| | `status` | codegraph | 索引状态 (原) |
| **流/社区** | `flows_list` | CRG | 执行流列表 |
| | `flow_detail` | CRG | 单流详情 |
| | `communities_list` | CRG+UA | 社区列表 |
| | `community_detail` | CRG+UA | 社区详情 |
| | `architecture_overview` | CRG | 架构概览 |
| **影响** | `impact` | codegraph | 冲突半径 (原) |
| | `impact_with_risk` | CRG | 带风险评分的 impact |
| | `detect_changes` | CRG | git diff → 影响 → 测试缺口 |
| **Wiki** | `wiki_generate` | CRG | 生成 Wiki |
| | `wiki_get` | CRG | 获取 Wiki 页面 |
| **代码质量** | `dead_code` | CRG | 死代码检测 |
| | `refactor_preview` | CRG | 重命名预检 |
| | `hub_nodes` | CRG | 高连接度节点 |
| | `bridge_nodes` | CRG | 关键桥节点 |
| **非代码** | `search_config` | UA | 配置/文档文件搜索 |

### 关键数据流

#### 索引流程 (替换 `gitnexus analyze`)

```
输入: 项目路径
  │
  ▼
┌──────────────────────────────┐
│  1. 文件扫描 + .gitignore    │ ← codegraph 已有
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  2a. Tree-sitter 代码解析     │ ← codegraph 已有 (19 语言)
│  2b. 非代码文件解析            │ ← [新增] UA 12 解析器
│  2c. 指纹提取                  │ ← [新增] UA 指纹
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  3. GraphBuilder              │ ← codegraph 已有
│     nodes + edges → SQLite    │ ← 扩展: 更多节点类型
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  4. 后处理                    │ ← [新增]
│  ├─ FTS5 重建                 │ ← codegraph 已有
│  ├─ 嵌入向量生成               │ ← [新增] transformers.js
│  ├─ 执行流检测                 │ ← [新增] flow tracer
│  ├─ 社区检测 (Louvain)         │ ← [新增] graphology
│  ├─ 风险评分                   │ ← [新增] risk scorer
│  └─ Wiki 生成                 │ ← [新增] generator
└──────────────────────────────┘
```

#### 报告生成流程 (替换 `gitnexus_impact`)

```
输入: 文件列表 / 符号名
  │
  ▼
┌──────────────────────────────┐
│  1. 映射变更到图节点           │ ← CRG 算法
│     (文件路径 + 行范围匹配)     │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  2. BFS 影响半径              │ ← codegraph 已有
│     遍历 incoming edges       │    + CRG SQLite CTE
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  3. 风险评分                   │ ← [新增] CRG 算法
│     = f(调用者数, 流参与,       │
│       社区跨越, 安全关键词,     │
│       测试覆盖)                │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│  4. 结构化输出                 │
│  ├─ changed_nodes             │
│  ├─ impacted_nodes (by depth) │
│  ├─ affected_flows            │
│  ├─ risk_score                │
│  ├─ test_gaps                 │
│  └─ review_priorities         │
└──────────────────────────────┘
```

---

## 可行性分析

### 绿色通道 (直接搬运, 改动小)

| 组件 | 来源 | 搬运方式 | 预估 |
|------|------|----------|------|
| 非代码解析器 ×12 | UA | 复制 `plugins/parsers/*.ts` → `extraction/non-code/` | 0.5 天 |
| Fuse.js 搜索回退 | UA | `npm install fuse.js`, 适配 SearchEngine 接口 | 0.5 天 |
| RRF 融合搜索 | CRG | 纯算法, ~100 行 TypeScript | 0.5 天 |
| Louvain 社区检测 | UA/CRG | `npm install graphology-communities-louvain` | 1 天 |
| 风险评分计算 | CRG | 纯数学, ~150 行 TypeScript | 1 天 |

### 黄色通道 (需适配改造, 中等)

| 组件 | 来源 | 改造点 | 预估 |
|------|------|--------|------|
| 向量嵌入生成 | CRG | `@xenova/transformers` 加载模型; 或调用外部 API | 2~3 天 |
| 执行流追踪 | CRG | 确定 entry point 的策略; 合并已有 `calls` 边 | 2~3 天 |
| Wiki 生成 | CRG | 适配到 codegraph 的社区结构 + ContextBuilder | 2~3 天 |
| 指纹增量更新 | UA | 改造 codegraph 的 `SyncEngine` 使其使用 AST 指纹而非 content_hash | 2~3 天 |
| UX 丰富节点类型 | UA | 注册表 + 搜索过滤器适配 | 1~2 天 |

### 红色通道 (需投入, 复杂)

| 组件 | 来源 | 难点 | 预估 |
|------|------|------|------|
| React Flow 面板 | UA | 依赖版本兼容 (React 19 / Vite / TailwindCSS v4); codewiki 当前是纯 HTML 无框架 | 1~2 周 |
| CRG Python 特色功能 (sentence-transformers, igraph) | CRG | 需决定: TypeScript 重写 vs 子进程调用 | 决策: 1 天; 实现: 1 周 |

### 跨语言决策树

```
CRG 的 Python 依赖如何处理?
│
├─ sentence-transformers (向量模型)
│  ├─ ✅ TypeScript 方案: @xenova/transformers (WASM, 同模型)
│  ├─ ⚠️ 子进程方案: 通过 child_process 调 CRG embed_graph_tool
│  └─ ✅ 外部 API: OpenAI/text-embedding-3-small (云端)
│
├─ igraph (社区检测)
│  └─ ✅ TypeScript 替代: graphology-communities-louvain
│
└─ watchdog (文件监听)
   └─ ✅ codegraph 已有 OS-level 原生监听 (inotify/FSEvents)
```

---

## 融合后的能力矩阵

| 能力 | GitNexus | codegraph | 融合后 |
|------|----------|-----------|--------|
| Tree-sitter 代码解析 | ✅ 15+ 语言 | ✅ 19 语言 | ✅ **19 语言** |
| 非代码文件解析 | ❌ | ❌ | ✅ **YAML/JSON/TOML/Env/Docker/SQL/等** |
| SQLite FTS5 全文搜索 | ⚠️ ladybugdb FTS | ✅ 多通道 BM25 | ✅ **FTS5 + 向量 RRF 混合** |
| 向量语义搜索 | ❌ | ❌ | ✅ **transformers.js 本地嵌入** |
| 模糊搜索回退 | ❌ | ❌ | ✅ **Fuse.js** |
| MCP 工具 | 9 个 | 9 个 | ✅ **18+ 个** |
| 执行流追踪 | ✅ Processes | ❌ | ✅ **Flows + Criticality** |
| 社区检测 | ✅ Communities | ❌ | ✅ **Louvain 聚类** |
| 影响分析 | ✅ 深度遍历 | ✅ BFS 半径 | ✅ **+风险评分 +测试缺口** |
| Wiki 生成 | ✅ 需要 LLM | ❌ | ✅ **社区结构 → Markdown** |
| 增量更新 | ❌ 全量重建 | ✅ 文件级修改 | ✅ **+AST 指纹变更分类** |
| 跨仓库 | ✅ Service | ✅ projectPath | ✅ **projectPath** |
| 图可视化 | ❌ | ❌ | ✅ **React Flow 面板** |
| HTTP API | ✅ Express | ❌ | ✅ **Express + SSE** |
| Q&A | ✅ LLM + 搜索 | ❌ | ✅ **向量搜索 + LLM + 社区上下文** |

---

## 推荐实施路径

### 阶段划分

```
Phase 1 (4~6 周)          Phase 2a (2~3 周)           Phase 2b (2~3 周)           Phase 2c (1~2 周)
┌──────────────┐        ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ codegraph 替换 │──────→│ 向量搜索 + 流追踪 │──────→│ 社区 + Wiki + 面板 │──────→│ 指纹 + 非代码解析 │
│ gitnexus      │        │ (CRG 核心能力)    │        │ (CRG+UA 中间层)   │        │ (UA 核心能力)     │
│               │        │                  │        │                  │        │                  │
│ • HTTP API    │        │ • @xenova 嵌入   │        │ • Louvain 社区    │        │ • AST 指纹        │
│ • 回调替换     │        │ • RRF 混合搜索    │        │ • Wiki 生成       │        │ • 12 非代码解析器  │
│ • Express 路由 │        │ • 执行流追踪      │        │ • React Flow 面板 │        │ • Fuse.js 回退    │
│ • MCP 适配    │        │ • 风险评分       │        │ • hub/bridge 节点 │        │ • 扩展节点类型     │
└──────────────┘        └──────────────────┘        └──────────────────┘        └──────────────────┘
```

### 依赖安装序列

```bash
# Phase 1 依赖 (codegraph + 基础设施)
npm install @colbymchenry/codegraph express cors

# Phase 2a 依赖 (向量 + 搜索增强)
npm install @xenova/transformers          # 本地向量嵌入 (WASM)
npm install fuse.js                       # 模糊搜索回退

# Phase 2b 依赖 (社区 + 图算法)
npm install graphology                    # 图数据结构
npm install graphology-communities-louvain # 社区检测
npm install graphology-betweenness-centrality  # 介数中心性
npm install graphology-hubs               # Hub 检测

# Phase 2c 依赖 (非代码解析)
npm install yaml js-yaml                  # YAML 解析
npm install smol-toml                     # TOML 解析
npm install dockerfile-ast                # Dockerfile 解析
npm install pg-sql-parser                 # SQL 解析
npm install graphql                        # GraphQL 解析
npm install protobuf-parser               # Protobuf 解析
npm install hcl2-parser                    # Terraform/HCL 解析
```

### 文件改动全景

| 文件 | Phase 1 | Phase 2a | Phase 2b | Phase 2c |
|------|---------|----------|----------|----------|
| `engine/src/db/schema.sql` | — | +embeddings, flows | +communities | +fingerprint |
| `engine/src/extraction/non-code/` | — | — | — | +12 parsers |
| `engine/src/extraction/fingerprint.ts` | — | — | — | +UA 指纹 |
| `engine/src/analysis/` | — | +flows, risk | +communities | — |
| `engine/src/search/hybrid-search.ts` | — | +RRF | — | — |
| `engine/src/search/vector-search.ts` | — | +@xenova | — | — |
| `engine/src/search/fuzzy-search.ts` | — | — | — | +Fuse.js |
| `engine/src/graph/flow-tracer.ts` | — | +执行流 | — | — |
| `engine/src/mcp/tools.ts` | — | +search, impact | +flows, wiki | — |
| `engine/src/wiki/` | — | — | +generator | — |
| `server/qa-endpoint.ts` | 重写回调 | +向量搜索 | +社区上下文 | +非代码搜索 |
| `server/codegraph-bridge.ts` | 新建 | — | — | — |
| `dashboard/` | — | — | +React Flow | — |

---

## 技术风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| **`@xenova/transformers` 首次加载慢 (~5s)** | 中 | 缓存模型到 `~/.cache/`; 后台懒加载; 降级到纯 FTS5 |
| **graphology 社区检测在大图上 OOM** | 中 | 限制节点数 < 50000; 分块处理; 使用 SQLite CTE 替代 |
| **CRG Python 特色功能 (sentence-transformers) 放弃后效果下降** | 低 | `@xenova` 加载同模型 (all-MiniLM-L6-v2), 效果等同 |
| **React Flow 面板与纯 HTML 前端冲突** | 中 | dashboard 作为独立子路径 `/dashboard` 加载, 不侵入现有前端 |
| **codegraph fork 与上游更新冲突** | 中 | 核心修改集中在新增模块, 不修改 codegraph 核心接口; 定期 rebase |

---

## 总结

**可行。** 三个仓库的能力互补性很好, 没有根本性的架构冲突:

1. **codegraph** 提供 TypeScript 框架 + SQLite + MCP 基础 — 作为骨架
2. **code-review-graph** 提供向量搜索/流追踪/风险评分 — 作为深度分析层
3. **Understand-Anything** 提供非代码解析/指纹更新/可视化面板 — 作为广度覆盖层

融合后可得到一个**搜索能力超 gitnexus、覆盖从代码到配置文件、自带社区分析和 Wiki 生成、有可视化面板**的完整引擎底座.

关键路径: Phase 2a (向量 + 流追踪) 收益最高, 推荐优先实施。Phase 2c (非代码解析 + 指纹) 可后置或按需分步。

> 调研日期: 2026-05-30 · 版本: v1
