# opencodewiki — AI Agent 开发指南

> **📖 先读 `PROJECT.md`** — 包含文件索引、API 定义、数据流，避免重复全局搜索。
> **📋 任务在 `TASKS.md`** — 每个任务包含涉及文件、调研结果、状态，新 session 直接定位无需重扫工程。

## 项目定位

opencodewiki — 基于 Tree‑sitter 的开源代码问答系统。底层引擎 [codegraph](https://github.com/colbymchenry/codegraph) (TypeScript + SQLite + MCP)。支持两种问答模式：
- **纯 LLM 模式** — `qa-endpoint` 搜索代码 + 构造 system prompt → 调 LLM API → SSE 流式返回
- **ACP Agent 模式** — Agent 自主决策调用 codegraph MCP 工具 + 平台内置 grep/glob/read

## 项目结构

```
opencodewiki/
├── package.json                    # 依赖: codegraph, express, cors
├── tsconfig.json                   # ES2022 / NodeNext
├── start.sh                        # npx tsx src/server/codegraph-bridge.ts
├── src/
│   ├── server/
│   │   ├── codegraph-bridge.ts     # Express HTTP API 包装 ToolHandler（9 路由）
│   │   └── qa-endpoint.ts          # SSE 流式问答端点（纯 LLM + ACP 双模式）
│   ├── acp/
│   │   ├── AcpClient.ts            # ACP ClientSideConnection 封装
│   │   ├── AgentManager.ts         # Agent 子进程 spawn/管理
│   │   ├── callbacks.ts            # ACP Client 回调（文件读写/路由）
│   │   ├── types.ts                # AcpMessageHandler, FileChange 类型
│   │   └── index.ts                # 统一导出
│   └── index.ts                    # 入口
├── qa/
│   └── index.html                  # Q&A 前端页面（SSE 流式 + Markdown + 代码高亮）
├── home/
│   └── index.html                  # Wiki 概览页面
├── vendor/
│   ├── marked.min.js               # Markdown 渲染
│   ├── highlight.min.js            # 代码高亮
│   └── mermaid.min.js              # 图表渲染
└── docs/
    ├── 调研01-codegraph替换方案.md
    └── 调研02-三合一融合方案.md
```

## 构建与开发

```bash
npm install                     # 安装依赖
npm run dev                     # tsx 启动 codegraph-bridge（端口 4747）
npm run build                   # tsc 编译到 dist/
npm start                       # node 运行 dist/
```

## 开发流程（每次 session 必须遵守）

根据 TASKS.md 中任务的 **涉及文件** 和 **状态** 决定走哪条路：

```
                     ┌──────────────────────────┐
                     │ 读 TASKS.md 定位任务条目   │
                     └──────────┬───────────────┘
                                │
                  ┌─────────────┴─────────────┐
                  │                           │
          涉及文件为空                   涉及文件已填充
                  │                           │
                  ▼                           ▼
     ┌─────────────────────┐    ┌──────────────────────┐
     │ 🔍 调研             │    │ 🛠️ 实现              │
     │                     │    │                      │
     │ 1. 读 PROJECT.md    │    │ 1. 读涉及文件列表     │
     │ 2. 打开目标文件      │    │ 2. 按需求编码         │
     │ 3. 确认接口/类型     │    │ 3. npm run build      │
     │ 4. 填充涉及文件列表   │    │ 4. npm run dev 验证   │
     │ 5. 状态 → 📋 已调研  │    │ 5. 更新 TASKS.md 状态  │
     │ 6. 输出结果，停止     │    │     → ✅ 已完成       │
     └─────────────────────┘    │ 6. 输出总结，停止      │
                                └──────────────────────┘
```

**禁止**: 不要 glob/grep 搜全工程。文件定位只从 `PROJECT.md` 或「涉及文件」列表读取。

### 调研（涉及文件为空）
- 读 `PROJECT.md` → 定位目标文件 → 打开确认接口/类型
- 填充到 `TASKS.md` 的「涉及文件」字段，状态改为 📋 已调研
- 输出结果，**结束会话**

### 实现（涉及文件已填充）
- 只读「涉及文件」列表，**零全局搜索**
- 按需求编码 → `npx tsc --noEmit` → `npm run dev` 验证
- 更新 `TASKS.md` 状态为 ✅ 已完成
- 按以下格式输出，**结束会话**：

  ```
  <一句话说明是否完成>
  修改原因：需求 或 问题
  修改方案：如何修改的，涉及哪些文件/改动
  自验结果：脚本自测或人工评审的结果
  验收步骤：人工验证功能或问题的简要步骤
  ```

### 任务条目格式

```markdown
## PX-XX: 任务标题

**涉及文件**: _待调研_
**调研步骤**:
1. 读 PROJECT.md → 定位目标文件
2. 打开确认接口/类型

**调研结果**:
- `src/server/xxx.ts` — 导出函数、类型

**状态**: ⬜ 未开始
```

---

## 开发约定

> **🚨 严禁自动提交代码** — 任何情况下 AI 不得自行执行 `git commit`。必须等待用户明确要求提交后，再执行操作。

1. **不要添加多余的 error handling** — 只在系统边界（外部 API、用户输入）做校验
2. **不要写注释** — 除非有非显而易见的 WHY（隐藏约束、微妙的不变性、特定 bug 的 workaround）
3. **使用中文**
4. **使用 TypeScript** — ES2022 + NodeNext 模块
5. **纯 LLM 模式和 ACP 模式需要同时保持可用** — 改动 `qa-endpoint.ts` 时确保双模式不破坏

---

## 常见操作指引

### 提交代码

用户要求提交时，使用 `/gci` 命令，AI 会自动完成分析、stage、commit 全流程。

提交消息遵循 `type: 简短描述` 格式：
- `feat` — 新功能 | `fix` — 修复 bug | `refactor` — 重构 | `docs` — 文档 | `chore` — 构建/工具
- 简短描述不超过 50 字，正文说明**为什么**改
- 使用中文

### 新增 API 路由

1. 在 `src/server/codegraph-bridge.ts` 中添加 `app.post('/api/xxx', handler)`
2. 在 `PROJECT.md` 的 API 章节记录新路由
3. 如果涉及搜索结果格式变更，同步更新 `qa-endpoint.ts`

### 修改问答流程

核心改动点在 `qa-endpoint.ts` 的 `createQaEndpoint()`：
- `resolveRepo` — 仓库解析回调
- `resolveLLMConfig` — LLM 配置回调
- `search` — 搜索回调（codegraph 替换 gitnexus 的唯一改动点）
- 修改 `systemPrompt` 字符串（引用格式、规则）

---

## 阶段钩子（kcode-hooks）

```
## kcode-hooks:execute
npm run build

## kcode-hooks:self_verify
npx tsc --noEmit
```
