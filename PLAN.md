# opencodewiki — DeepWiki-style Q&A for GitNexus

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
│  Q&A 页面 (opencodewiki/qa/index.html)   │
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
opencodewiki/
├── PLAN.md                    ← 本文档
├── README.md                  ← 快速开始
├── start.sh                   ← 一键启动脚本
├── qa/
│   └── index.html             ← 独立 Q&A 页面（~200 行）
│       ├─ HTML 结构（chat container）
│       ├─ DeepWiki 风格 CSS
│       └─ JS（SSE 流式 + Markdown 渲染 + 多轮对话）
├── server/
│   └── qa-endpoint.ts         ← SSE 流式 LLM 端点
│       ├─ POST /api/qa handler
│       ├─ 直接调用 LLM API（fetch + SSE 解析）
│       └─ 复用 llm-client.ts 配置（resolveLLMConfig）
└── vendor/
    ├── marked.min.js          ← Markdown 渲染
    ├── highlight.min.js       ← 代码高亮
    └── mermaid.min.js         ← 图表渲染

gitnexus/src/
├── server/
│   └── api.ts                 ← 加 ~145 行路由
│       ├─ GET/POST /api/qa    → SS 流式问答 + session
│       ├─ GET /wiki/          → 静态 serve .gitnexus/wiki/
│       ├─ GET /vendor/        → 静态 serve opencodewiki/vendor/
│       ├─ GET /opencodewiki/:repo → Wiki 概览
│       └─ GET /opencodewiki/:repo/qa, /opencodewiki/qa/:id → Q&A 页面
│
└── core/
    └── wiki/
        ├── html-viewer.ts     ← 底部注入输入框 DOM（~15 行）
        └── llm-client.ts      ← 复用（不改）
```

## Data Flow

### Wiki → Q&A 跳转
1. User 打开 `http://localhost:4747/opencodewiki/项目名` → 服务端返回 wiki/index.html
2. 页底输入框，user 输入问题 → 回车
3. 浏览器跳转 `/opencodewiki/项目名/qa?q=问题内容`

### Q&A 页面加载
1. `qa/index.html` 读取 URL 参数 `?q=xxx`
2. 自动将问题填入对话历史
3. 自动调用 `POST /api/qa` 发送请求

### Q&A 后端处理
1. `qa-endpoint.ts` 收到 `{ question, history, repo }`（`api.ts` 通过 `new URL()` 动态 import）
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

### GET /wiki/*
Static file serving for wiki content (index.html + .md files). Per-repo: `?repo=xxx`.

### GET /qa/
Static file serving for Q&A page (`opencodewiki/qa/index.html`).

### GET /opencodewiki/:repo
Wiki overview page for a specific repo.

### GET /opencodewiki/:repo/qa
Q&A page scoped to a repo. Wiki input form submits here.

### GET /opencodewiki/qa/:id
Q&A page with session ID for URL sharing / restore.

## Wiki 页底输入框

在 `html-viewer.ts` 的 `buildHTML()` 函数中注入（`projectName` 来自 wiki 生成时的参数）：

```html
<div class="qa-entry">
  <form action="/opencodewiki/PROJECT_NAME/qa" method="GET" class="qa-form">
    <input type="text" name="q" placeholder="Ask anything about this codebase..." autocomplete="off">
    <button type="submit">Ask</button>
  </form>
</div>
```

配套 CSS（固定底部栏，居中于 wiki 内容宽度）：
```css
.qa-entry{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
  width:100%;max-width:740px;z-index:20;padding:0 16px}
.qa-form{display:flex;align-items:center;gap:8px;background:var(--bg);
  border:1px solid var(--border);border-radius:10px;padding:8px 12px;
  box-shadow:0 4px 24px rgba(0,0,0,.06)}
.qa-form input[type="text"]{flex:1;border:none;background:transparent;
  outline:none;font-size:14px;color:var(--text);padding:4px 0;line-height:1.5}
.qa-form input[type="text"]::placeholder{color:var(--text-muted)}
.qa-form button{padding:8px 20px;background:var(--primary);color:#fff;
  border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer}
.qa-form button:hover{opacity:.88}
```

## Implementation Order

| # | Task | File | Lines |
|---|------|------|-------|
| 1 | Q&A 后端 SSE 端点 | `opencodewiki/server/qa-endpoint.ts` | 80 |
| 2 | Q&A 前端页面 | `opencodewiki/qa/index.html` | 200 |
| 3 | api.ts 加路由 | `gitnexus/src/server/api.ts` | 15 |
| 4 | wiki 页底输入框 | `gitnexus/src/core/wiki/html-viewer.ts` | 15 |

Total: ~310 lines

## Dependencies

- **LLM**: 复用 `gitnexus/src/core/wiki/llm-client.ts` 的 `resolveLLMConfig()`
- **Markdown**: CDN `marked.js`（wiki html-viewer 已有）
- **Code highlighting**: CDN `highlight.js`
- **Server**: Express.js（gitnexus serve 已有）
- **No new npm packages needed**
