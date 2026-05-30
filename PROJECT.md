# opencodewiki — 开源代码问答系统

opencodewiki 是一个基于 Tree‑sitter 的开源代码问答系统，支持**纯 LLM 模式**和**ACP Agent 模式**两种问答方式。底层引擎使用 [codegraph](https://github.com/colbymchenry/codegraph)（TypeScript + SQLite + MCP）。

> 本项目是 `opencodewiki` 分支，从 GitNexus 项目中独立出来的 CodeWiki 演进版本。

---

## 目录结构

```
opencodewiki/
├── package.json                     # 依赖: codegraph, express, cors
├── tsconfig.json                    # ES2022 / NodeNext / strict
├── start.sh                         # npx tsx 启动脚本
├── src/
│   ├── server/
│   │   ├── codegraph-bridge.ts      # Express HTTP API 包装 ToolHandler
│   │   └── qa-endpoint.ts          # SSE 流式问答端点（双模式）
│   ├── acp/
│   │   ├── AcpClient.ts            # ACP ClientSideConnection 封装
│   │   ├── AgentManager.ts         # Agent 子进程 spawn/管理
│   │   ├── callbacks.ts            # ACP Client 回调实现
│   │   ├── types.ts                # AcpMessageHandler, FileChange 类型
│   │   └── index.ts                # 统一导出
│   └── index.ts                    # 入口（导出 createQaEndpoint）
├── qa/
│   └── index.html                  # Q&A 前端（SSE 流式 + Markdown + 代码高亮）
├── landing/
│   └── index.html                  # Wiki 概览页面
├── vendor/
│   ├── marked.min.js               # Markdown 渲染
│   ├── highlight.min.js            # 代码高亮
│   └── mermaid.min.js              # 图表渲染
├── docs/
│   ├── 调研01-codegraph替换方案.md
│   └── 调研02-三合一融合方案.md
├── AGENTS.md                       # AI Agent 开发指南
├── PROJECT.md                      # 本文档
└── TASKS.md                        # 任务注册中心
```

---

## API 定义

### `src/server/codegraph-bridge.ts`

HTTP API 包装 codegraph 的 `ToolHandler`，共 9 条路由：

| 路由 | 后端调用 | 说明 |
|------|----------|------|
| `POST /api/search` | `handler.execute('codegraph_search', body)` | 代码搜索 |
| `POST /api/context` | `handler.execute('codegraph_context', body)` | 符号上下文 |
| `POST /api/impact` | `handler.execute('codegraph_impact', body)` | 影响分析 |
| `GET /api/status` | `handler.execute('codegraph_status', {})` | 索引状态 |
| `POST /api/files` | `handler.execute('codegraph_files', body)` | 文件列表 |
| `POST /api/callers` | `handler.execute('codegraph_callers', body)` | 调用者查询 |
| `POST /api/callees` | `handler.execute('codegraph_callees', body)` | 被调用者查询 |
| `POST /api/node` | `handler.execute('codegraph_node', body)` | 节点详情 |
| `POST /api/explore` | `handler.execute('codegraph_explore', body)` | 探索分析 |

启动：`npx tsx src/server/codegraph-bridge.ts`（端口 4747，可通过 `PORT` 环境变量配置）

### `src/server/qa-endpoint.ts`

SSE 流式问答端点，支持双模式。

**`POST /api/qa`**

```
Request:
{
  question: string,                    // 必填
  history?: { role, content }[],       // 多轮对话历史
  repo?: string,                       // 指定仓库（空则跨仓库搜索）
  sessionId?: string                   // 续接已有会话
}

Response: SSE stream
data: {"type":"session","id":"uuid"}
data: {"type":"sources","sources":[...]}
data: {"type":"token","content":"..."}
data: {"type":"reasoning","content":"..."}  // ACP 模式
data: {"type":"done"}
data: {"type":"error","message":"..."}
```

**核心函数 `createQaEndpoint()`**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `resolveRepo` | `(repoName?) => Promise<{storagePath, name}>` | 仓库解析 |
| `resolveLLMConfig` | `() => Promise<{apiKey, baseUrl, model, ...}>` | LLM 配置 |
| `search` | `(query, repo?) => Promise<{sources, flows?}>` | **唯一依赖 codegraph 的回调** |
| `listRepos?` | `() => Promise<{name}[]>` | 仓库列表（跨仓库模式） |

**环境变量**：

| 变量 | 作用 |
|------|------|
| `OPENCODEWIKI_ACP_ENABLE=true` | 启用 ACP Agent 模式 |
| `OPENCODEWIKI_ACP_CROSS_ROOT=true` | ACP 跨仓库根目录模式 |
| `GITNEXUS_QA_DATA_DIR` | QA session 持久化目录（默认 `~/.gitnexus/qa-sessions`） |

**两种问答模式**：

1. **纯 LLM 模式**（默认）— `qa-endpoint` 搜索代码 + 构造 system prompt → 调 LLM API → SSE 流式返回
2. **ACP Agent 模式**（`OPENCODEWIKI_ACP_ENABLE=true`）— Agent 自主决策调用 codegraph MCP 工具 + 平台内置 grep/glob/read

---

## 数据流

### QA 提问全流程

```
用户提问 → POST /api/qa
  → resolveRepo → 读取 wiki/overview.md（系统上下文）
  → 中文检测 → 翻译英文 → 构造双语搜索语句
  → 调 search() 回调（codegraph 搜索）
  → 遍历每个搜索结果 → 从磁盘读实际代码片段
  → classifyQuestion → 选结构模板（overview/feature/debug/compare/api/general）
  → 构造 systemPrompt（wiki + 源码片段 + execution flows + 规则）
  → 调 LLM API（streaming）→ SSE 流式返回
```

### 源码引用解析

```
LLM 回答 → 正则提取 file:line 引用
  → 按候选路径列表尝试读取磁盘文件
  → 取引用行上下各 2 行作为 snippet
  → 追加到 sources → SSE 推送给前端
```

### ACP Agent 模式

```
qa-endpoint → 为每个 repo 维护 AcpClient（ACP 进程）
  → 用户提问 → client.createSession() → 拿到 acpSessionId
  → client.sendPrompt(acpSessionId, prompt, handler)
  → Agent 自主调用 codegraph MCP tools + grep/glob/read
  → 流式 text/reasoning/tool_call ← SSE
  → 回答完成后解析引用 → 追加 sources
```

### Session 管理

```
QA session（内存 Map + ~/.gitnexus/qa-sessions/ 持久化）
  ├─ sessionId (uuid)
  ├─ messages[]（多轮对话消息）
  ├─ sources[]（搜索/引用结果）
  ├─ acpSessionId（ACP 模式）
  └─ TTL: 30 分钟 / 清理间隔: 5 分钟 / 每 repo 最多 20 session
```

---

## 文件详细索引

### `src/server/codegraph-bridge.ts`

| 导出 | 说明 |
|------|------|
| Express app | `app.listen(PORT)` 启动 HTTP 服务 |

9 条 POST/GET 路由，全部通过 `ToolHandler.execute()` 调用 codegraph MCP 工具。

### `src/server/qa-endpoint.ts`

| 导出 | 说明 |
|------|------|
| `createQaEndpoint(resolveRepo, resolveLLMConfig, search, listRepos?)` | 创建 SSE 流式问答处理器 |
| `getSession(id)` | 获取 QA session |

**内部类型**：

```typescript
interface QaMessage { role: string; content: string }
interface QaSession {
  id: string; messages: QaMessage[]; sources: any[];
  repo?: string; acpSessionId?: string;
  createdAt: string; updatedAt: string;
}
```

**关键辅助函数**：

| 函数 | 说明 |
|------|------|
| `classifyQuestion(question)` | 返回 'overview'/'feature'/'debug'/'compare'/'api'/'general' |
| `structureGuide(type)` | 按问题类型返回回答结构指引 |
| `translateToEnglish(question, llmConfig)` | 中文→英文搜索词翻译 |
| `extractFileRefs(text)` | 正则提取 `file:line` 引用 |
| `resolveAnswerSources(content, ...)` | 解析完整源码 snippet |

### `src/acp/AcpClient.ts`

| 方法 | 说明 |
|------|------|
| `constructor(cwd)` | 设置工作目录，创建 AgentManager |
| `connect()` | 启动 `kilo acp` 子进程 + 建立 ACP 连接 |
| `createSession()` | 创建 ACP session，返回 sessionId |
| `sendPrompt(sessionId, text, handler)` | 发送 prompt + 流式回调 |
| `cancel(sessionId)` | 取消指定 session 的 prompt |
| `closeSession(sessionId)` | 关闭 ACP session |
| `dispose()` | 关闭所有资源 |

### `src/acp/AgentManager.ts`

| 方法 | 说明 |
|------|------|
| `startAgent(command, args)` | spawn 子进程 |
| `stopAgent()` | 终止进程 |

### `src/acp/callbacks.ts`

`opencodewikiACPClient` implements ACP Client 接口，维护会话级 handler Map，支持：
- `setSessionHandler(sessionId, handler)` — 注册流式回调
- 文件读写回调（`writeTextFile` / `readTextFile`）
- `requestPermission` — MVP auto-accept

### `src/acp/types.ts`

```typescript
interface AcpMessageHandler {
  onText: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (toolCallId, title, kind, status) => void;
  onToolCallUpdate?: (toolCallId, status, content?, title?, kind?) => void;
  onPlan?: (entries) => void;
  onError: (error: string) => void;
  onDone: (stopReason?: string) => void;
}

interface FileChange {
  filePath: string;
  original: string;
  modified: string;
}
```

---

## 问题分类与回答模板

| 类型 | 触发关键词 | 结构要求 |
|------|-----------|----------|
| overview | 介绍/什么是/架构/architecture/overview | 摘要 → ## Architecture（mermaid）→ ## Features → ## Usage |
| feature | 实现/功能/用法/usage | 直接回答 → ## Implementation（代码片段）→ 步骤说明 |
| debug | 报错/错误/失败/error/bug/fix/为什么 | 原因 → ## Root Cause → ## Solution（代码修复） |
| compare | 区别/差异/vs/difference/对比 | 一句结论 → 对比表格 → ## Analysis（取舍分析） |
| api | 函数/方法/api/interface/class/参数 | 功能说明 → ## Signature（类型签名）→ ## Parameters → ## Example |
| general | 其他 | 一句回答 → ## 分类展开（bullet points + 短段落） |

---

## 构建命令

```bash
npm run build       # npx tsc 编译
npm run dev         # npx tsx 启动开发服务器
npm start           # node dist/ 运行编译产物
npx tsc --noEmit    # 仅类型检查
```

---

## 迁移计划

详见 `TASKS.md` 的四阶段路线图：

| Phase | 内容 | 状态 |
|-------|------|------|
| **Phase 0** | 分支创建 + 目录清理 + 初始化 | ✅ 已完成 |
| **Phase 1** | codegraph 替换 gitnexus，HTTP Bridge + qa-endpoint 改造 | ⬜ 进行中 |
| **Phase 2** | 运行磨合 / Bug 修复 / 性能优化 | ⬜ 未开始 |
| **Phase 3** | 融合 CRG + UA 能力（向量搜索/社区/Wiki/面板/非代码解析） | ⬜ 未开始 |
| **Phase 4** | （预留）纯 LLM 模式效果达标后，移除 ACP Agent 模式 | ⬜ 未开始 |
