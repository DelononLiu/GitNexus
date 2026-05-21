# CodeWiki — DeepWiki-style Q&A for GitNexus

## Architecture Overview

```
User opens wiki
     │
     ▼
┌─────────────────────────────────────┐
│  Wiki 页面 (gitnexus wiki 生成)       │
│  html-viewer.ts → index.html         │
│                                       │
│  ┌────────┬────────────────────┐     │
│  │ Nav    │ Content (Markdown) │     │
│  │ 280px  │ flex:1             │     │
│  └────────┴────────────────────┘     │
│                                       │
│  ┌──────────────────────────────┐    │
│  │ Ask about this code...  [→]  │    │  ← wiki-footer 注入
│  └────────────┬─────────────────┘    │
└───────────────┼──────────────────────┘
                │ GET /qa/?q=xxx
                ▼
┌─────────────────────────────────────┐
│  Q&A 页面 (codewiki/qa/index.html)   │
│                                       │
│  [对话历史 · 流式打字 · 代码高亮]      │
│  [引用跳转 · Markdown · 多轮对话]     │
│                                       │
│  ┌──────────────────────────────┐    │
│  │ Follow-up...           [Send]│    │
│  └──────────────────────────────┘    │
│         ▲                            │
│         │ SSE fetch                  │
│         ▼                            │
│  POST /api/qa (后端代理)              │
│  ├─ 解析 → 调 LLM API → SSE 流回     │
│  └─ 复用 wiki/llm-client.ts          │
└─────────────────────────────────────┘
```

## File Structure

```
codewiki/
├── PLAN.md                    ← 本文档
├── QA.md                      ← 本项目说明
├── qa/
│   └── index.html             ← 独立 Q&A 页面（~200 行）
│       ├─ HTML 结构（chat container）
│       ├─ DeepWiki 风格 CSS
│       └─ JS（SSE 流式 + Markdown 渲染 + 多轮对话）
├── server/
│   └── qa-endpoint.ts         ← SSE 流式 LLM 端点（~80 行）
│       ├─ POST /api/qa handler
│       ├─ 直接调用 LLM API（fetch + SSE 解析）
│       └─ 复用 llm-client.ts 配置（resolveLLMConfig）
└── wiki-footer/
    └── inject.js              ← 注入 wiki 页底的输入框脚本（~30 行）

gitnexus/src/
├── server/
│   └── api.ts                 ← 加 3 条路由（~15 行）
│       ├─ GET /api/wiki       → 静态 serve .gitnexus/wiki/
│       ├─ GET /api/qa         → 静态 serve codewiki/qa/
│       └─ POST /api/qa        → 流式问答
│
└── core/
    └── wiki/
        ├── html-viewer.ts     ← 底部注入输入框 DOM（~15 行）
        └── llm-client.ts      ← 复用（不改）
```

## Data Flow

### Wiki → Q&A 跳转
1. User 打开 `http://localhost:4747/api/wiki/` → 服务端返回 wiki/index.html
2. 页底输入框，user 输入问题 → 回车
3. 浏览器跳转 `/api/qa/?q=问题内容`

### Q&A 页面加载
1. `qa/index.html` 读取 URL 参数 `?q=xxx`
2. 自动将问题填入对话历史
3. 自动调用 `POST /api/qa` 发送请求

### Q&A 后端处理
1. `qa-endpoint.ts` 收到 `{ question, history, repo }`
2. 通过 `resolveRepo(repo)` 获取仓库配置
3. 读取 wiki 概述（overview.md）作为系统上下文
4. 调用 `resolveLLMConfig()` 获取 LLM 配置（API key、model、baseUrl）
5. 向 LLM API 发起 fetch streaming 请求
6. SSE 格式推送 token：
   ```
   data: {"type":"token","content":"Hello"}
   
   data: {"type":"done"}
   ```

### Q&A 前端渲染
1. SSE 监听 → 收到 token → 追加到当前 AI 回复
2. 回复完成后调用 `marked.parse()` 渲染 Markdown
3. 代码块用 `highlight.js` 高亮
4. 多轮对话：每次将完整 history 发给后端

## API 定义

### POST /api/qa
```
Request:
{
  question: string,
  history: { role: 'user'|'assistant', content: string }[],
  repo?: string
}

Response: SSE stream
data: {"type":"token","content":"..."}
data: {"type":"done"}
data: {"type":"error","message":"..."}
```

### GET /api/wiki/*
Static file serving for wiki content (index.html + .md files).

### GET /api/qa/*
Static file serving for Q&A page (index.html).

## Wiki 页底输入框

在 `html-viewer.ts` 的 `buildHTML()` 函数中注入：

```html
<div class="qa-entry">
  <form action="/api/qa/" method="GET">
    <input name="q" placeholder="Ask about this codebase..." autocomplete="off">
    <button type="submit">Ask</button>
  </form>
</div>
```

配套 CSS（与现有 wiki 样式一致）：
```css
.qa-entry {
  margin-top: 32px; padding-top: 24px;
  border-top: 1px solid var(--border);
}
.qa-entry form { display: flex; gap: 8px; }
.qa-entry input {
  flex: 1; padding: 10px 14px;
  border: 1px solid var(--border); border-radius: 8px;
  font-size: 14px; outline: none;
}
.qa-entry input:focus { border-color: var(--primary); }
.qa-entry button {
  padding: 10px 20px; background: var(--primary); color: #fff;
  border: none; border-radius: 8px; cursor: pointer; font-size: 14px;
}
```

## Implementation Order

| # | Task | File | Lines |
|---|------|------|-------|
| 1 | Q&A 后端 SSE 端点 | `codewiki/server/qa-endpoint.ts` | 80 |
| 2 | Q&A 前端页面 | `codewiki/qa/index.html` | 200 |
| 3 | api.ts 加路由 | `gitnexus/src/server/api.ts` | 15 |
| 4 | wiki 页底输入框 | `gitnexus/src/core/wiki/html-viewer.ts` | 15 |

Total: ~310 lines

## Dependencies

- **LLM**: 复用 `gitnexus/src/core/wiki/llm-client.ts` 的 `resolveLLMConfig()`
- **Markdown**: CDN `marked.js`（wiki html-viewer 已有）
- **Code highlighting**: CDN `highlight.js`
- **Server**: Express.js（gitnexus serve 已有）
- **No new npm packages needed**
