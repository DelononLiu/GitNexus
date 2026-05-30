# opencodewiki — 任务注册中心

> **分支**: `opencodewiki`（可独立提取为 repo）
> **目标**: 将 opencodewiki 底层引擎从 GitNexus 替换为基于 Tree‑sitter 的开源方案，分阶段演进。
>
> 每个 session 从这里开始。AI 读取此文件定位到具体任务，获取涉及文件列表后直接开工，无需重扫工程。
> **Phase 概述**详见 `PROJECT.md`。

## 任务格式

```markdown
## PX-XX: 任务标题

**涉及文件**: _待调研_ 或 文件路径列表
**调研步骤**: (涉及文件为空时，调研阶段填充)
**调研结果**: (调研后填充，含具体函数/行号)
**状态**: ⬜ 未开始 | 🔍 调研中 | 📋 已调研 | 🛠️ 实现中 | ✅ 已完成
```

---

## Phase 0: 分支与初始化（一次性）

在 GitNexus 仓库中创建 `opencodewiki` 分支，清理无关目录，初始化项目框架。

| 任务 | 说明 | 状态 |
|------|------|------|
| P0-01 | 分支创建 + 无关目录清理 | ✅ 已完成 |
| P0-02 | 初始化项目框架（package.json/tsconfig/start.sh） | ✅ 已完成 |
| P0-03 | 搬运 ACP 模块 | ✅ 已完成 |
| P0-04 | QA 端点适配 | ✅ 已完成 |

### P0-01~04: Phase 0 全量完成

**涉及文件**:
- `.gitignore` — 项目根忽略规则（node_modules, dist, .codegraph, .gitnexus）
- `package.json` — codegraph + express + cors + TypeScript 依赖
- `tsconfig.json` — ES2022 / NodeNext / strict
- `src/server/codegraph-bridge.ts` — Express HTTP API 包装 ToolHandler（9 路由）
- `src/server/qa-endpoint.ts` — SSE 流式问答端点（双模式）
- `src/acp/AcpClient.ts` — ACP 客户端封装
- `src/acp/AgentManager.ts` — Agent 进程管理
- `src/acp/callbacks.ts` — ACP 回调实现
- `src/acp/types.ts` — AcpMessageHandler, FileChange 类型
- `src/acp/index.ts` — 统一导出
- `src/index.ts` — 入口导出
- `qa/index.html` — Q&A 前端页面
- `landing/index.html` — Wiki 概览页面
- `vendor/` — marked / highlight.js / mermaid
- `start.sh` — 启动脚本

**状态**: ✅ 已完成

---

## Phase 1: 底座迁移

将 opencodewiki 的底层代码引擎从 GitNexus 替换为 **codegraph** (`@colbymchenry/codegraph`)，保持 Wiki + QA + 搜索功能不变。

### 迁移策略

- **增量模式**：在 `opencodewiki/` 内开发，**不修改**原 `opencodewiki/` 任何文件
- **独立 repo 视角**：按独立仓库组织，后续可直接抽出

| 任务 | 说明 | 状态 | 优先级 |
|------|------|------|--------|
| P1-01 | 完成 codegraph-bridge Express 路由 + 静态服务 + QA 集成（全功能） | ✅ 已完成 | P0 |
| P1-02 | search 回调从 gitnexus 改为 codegraph API | 📋 已调研 | P0 |
| P1-03 | 更新 systemPrompt 中工具名和引用格式 | 📋 已调研 | P0 |
| P1-04 | ACP Agent 模式 MCP 工具注册切换为 codegraph | ⬜ 未开始 | P1 |
| P1-05 | 跨仓库搜索验证（`listRepos` 回调对接） | ⬜ 未开始 | P1 |

### P1-01: 补全 codegraph-bridge Express 路由 + 静态服务 + QA 集成

**涉及文件**:
- `src/server/codegraph-bridge.ts` — 全功能重写，含 9 路由 + 静态服务 + QA 端点集成

**改动内容**:
- 修复 `ToolHandler` 导入路径为 `@colbymchenry/codegraph/dist/mcp/index.js`
- 添加 `CodeGraph.init()` 懒初始化，自动创建 `.codegraph/` 目录
- 添加静态文件服务：`/vendor/*` → vendor 目录（JS/CSS）
- 添加前端页面路由：`/opencodewiki/` → landing，`/opencodewiki/qa` → QA
- 集成 `createQaEndpoint` 注册 `POST /api/qa`（SSE 流式问答）
- 添加 `GET /api/qa/session/:id` 会话查询
- 实现 `search` 回调调用 codegraph 搜索
- 将 `src/acp/` 移至 `src/server/acp/` 修复模块路径

**状态**: ✅ 已完成

### P1-02: search 回调从 gitnexus 改为 codegraph API

**涉及文件**:
- `src/server/qa-endpoint.ts` — `createQaEndpoint()` 的 `search` 参数是唯一依赖 gitnexus 的回调

**调研步骤**:
1. 读 `PROJECT.md` → `createQaEndpoint` 参数表确认 search 签名
2. 打开 `qa-endpoint.ts` 查看 search 如何被调用

**调研结果**:
- `search: (query, repo?) => Promise<{sources, flows?}>` — 接收搜索词和仓库名，返回源码片段和执行流
- 调用点：`qa-endpoint.ts:612`（单仓库）和 `:607`（跨仓库）
- 当前上层（暂未接入）预期通过 `codegraph_search` + `codegraph_context` 组合实现
- sources 格式兼容 codegraph 返回的 `{ filePath, label, startLine, endLine, name }`

**状态**: 📋 已调研

### P1-03: 更新 systemPrompt 中工具名和引用格式

**涉及文件**:
- `src/server/qa-endpoint.ts:753` — 硬编码的 gitnexus 工具引用 `gitnexus_query → gitnexus_cypher → gitnexus_context → grep`

**调研步骤**:
1. 读 `PROJECT.md` → 确认期望的工具名
2. 打开 `qa-endpoint.ts` 定位 systemPrompt 字符串

**调研结果**:
- 第 753 行包含硬编码搜索链路：`gitnexus_query → gitnexus_cypher → gitnexus_context → grep`
- 改为：`codegraph_search → codegraph_context → codegraph_impact → (平台 grep)`
- 引用路径格式：`relative/path/file.ts:line`（当前已适配 codegraph 的相对路径）

**状态**: 📋 已调研

---

## Phase 2: 运行磨合（预留）

Phase 2 预留给 Phase 1 迁移后的稳定性测试、问题修复、性能优化、以及日常使用中暴露的兼容性问题修复。

此阶段不引入新功能，只打磨。

| 任务 | 说明 | 状态 |
|------|------|------|
| P2-01 | 稳定性测试 + 问题修复 | ⬜ 未开始 |

---

## Phase 3: 三合一座舱底座

以 codegraph 的 TypeScript + SQLite + MCP 为骨架，将 **code-review-graph** 和 **Understand-Anything** 的关键能力用 TypeScript 重新实现注入 codegraph。

| 任务 | 说明 | 状态 | 优先级 |
|------|------|------|--------|
| P3-01 | 向量嵌入 + RRF 混合搜索 | ⬜ 未开始 | P0 |
| P3-02 | 执行流追踪 | ⬜ 未开始 | P0 |
| P3-03 | 社区检测 (Leiden/Louvain) | ⬜ 未开始 | P1 |
| P3-04 | Wiki 生成 | ⬜ 未开始 | P1 |
| P3-05 | 影响分析风险评分 | ⬜ 未开始 | P1 |
| P3-06 | 非代码解析器 ×12 | ⬜ 未开始 | P1 |
| P3-07 | 指纹增量更新 | ⬜ 未开始 | P2 |
| P3-08 | Fuse.js 模糊搜索回退 | ⬜ 未开始 | P2 |
| P3-09 | Q&A 向量搜索增强 | ⬜ 未开始 | P2 |

### P3-01: 向量嵌入 + RRF 混合搜索

**涉及文件**: _待调研_

**调研步骤**:
1. 读 `PROJECT.md` → 确认 codegraph 现有搜索架构
2. 调研 `@xenova/transformers` 集成方式
3. 确认 codegraph 的 FTS5 schema

**功能描述**:
- 使用 `@xenova/transformers` 运行 all-MiniLM-L6-v2 生成向量嵌入
- RRF (Reciprocal Rank Fusion) 融合 FTS5 BM25 + 向量余弦相似度
- `hybrid_search` MCP 工具

**状态**: ⬜ 未开始

### P3-02: 执行流追踪

**涉及文件**: _待调研_

**调研步骤**:
1. 读 `PROJECT.md` → 确认 codegraph Graph API 和 traversal 机制
2. 调研 entry point 检测策略

**功能描述**:
- 复用 codegraph `Graph.traversal.ts` BFS
- 新增 entry point 检测（main函数、路由注册、事件监听）
- 输出 `flows` 表和 `flow_memberships` 表

**状态**: ⬜ 未开始

---

## 时间线总览

```
Phase 1 (4~6 周)   →   Phase 2 (X 周)   →   Phase 3 (6~10 周)   →   Phase 4 (待定)
                         ↑                        ↑
                   运行磨合 / 问题修复          ACP Agent 模式可移除
```

| Phase | 内容 | 预估 |
|-------|------|------|
| **Phase 0** | 分支创建 + 目录清理 + 初始化 | ✅ 已完成 |
| **Phase 1** | codegraph 替换 gitnexus，HTTP Bridge + qa-endpoint 改造 | 🛠️ 进行中 |
| **Phase 2** | 迁移后磨合、Bug 修复、性能优化 | 待定 |
| **Phase 3** | 融合 CRG + UA 能力：向量搜索/社区/Wiki/面板/非代码解析/指纹 | 6~10 周 |
| **Phase 4** | （预留）纯 LLM 模式效果达标后，移除 ACP Agent 模式 | 待定 |

## 约定

- **状态标记**: ⬜ 未开始 | 🔍 调研中 | 📋 已调研 | 🛠️ 实现中 | ✅ 已完成
- 调研阶段填充 `调研步骤` 和 `调研结果`，实现阶段只读「涉及文件」列表
- 详情见 `AGENTS.md > 开发流程`
