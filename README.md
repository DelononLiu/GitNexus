# opencodewiki

CodeWiki 的演进版本——基于 Tree‑sitter 的开源代码问答系统。

底层引擎: [codegraph](https://github.com/colbymchenry/codegraph) (TypeScript + SQLite + MCP)

## 架构

```
src/
├── server/
│   ├── codegraph-bridge.ts   HTTP API (Express 包装 codegraph ToolHandler)
│   └── qa-endpoint.ts        SSE 流式问答端点
├── acp/                      ACP Agent 模式 (可选)
├── qa/                       Q&A 前端页面
├── landing/                  Wiki 概览页面
└── vendor/                   CDN 资源 (marked, highlight.js, mermaid)
```

## 快速开始

```bash
npm install
npm run dev
```

详见 `TASKS.md`。
