# opencodewiki

基于 Tree‑sitter 的开源代码问答系统。

引擎 [codegraph](https://github.com/colbymchenry/codegraph) 作为 git submodule 管理（`engine/codegraph/`），方便本地修改和版本固定。

## 目录

```
├── engine/codegraph/       codegraph 引擎源码（git submodule，固定 commit）
├── src/
│   ├── server/
│   │   ├── codegraph-bridge.ts   HTTP API
│   │   └── qa-endpoint.ts        SSE 流式问答
│   ├── home/               首页
│   ├── qa/                 Q&A 页面
│   └── vendor/             CDN 资源
└── package.json            codegraph 依赖指向 "file:./engine/codegraph"
```

## 快速开始

```bash
# 1. 克隆项目（含子模块）
git clone --recurse-submodules https://github.com/your/opencodewiki.git
# 已克隆的也可以：
# git submodule update --init --depth 1

# 2. 安装依赖
npm install

# 3. 配置 LLM 密钥
mkdir -p ~/.opencodewiki
# 编辑 ~/.opencodewiki/config.json:
# {"apiKey":"sk-xxx","baseUrl":"https://api.openai.com/v1","model":"gpt-4o-mini"}

# 4. 构建 codegraph 引擎
cd engine/codegraph && npm install && npm run build && cd ../..

# 5. 初始化 codegraph 索引（使用本地引擎，指向 engine/codegraph/）
node engine/codegraph/dist/bin/codegraph.js init ~/Code/example
node engine/codegraph/dist/bin/codegraph.js index ~/Code/example

# 6. 启动服务
npm run dev
# opencodewiki server running on http://localhost:4747
```

## 引擎更新

```bash
cd engine/codegraph
git pull origin master          # 拉新版本
npm install && npm run build    # 重新构建
cd ../..
git add engine/codegraph
git commit -m "chore: update codegraph to <新版本>"
```

更新后重新初始化索引：
```bash
node engine/codegraph/dist/bin/codegraph.js init
node engine/codegraph/dist/bin/codegraph.js index
```

## 页面

| 地址 | 说明 |
|------|------|
| http://localhost:4747/ | 首页 / 仓库列表 |
| http://localhost:4747/qa | Q&A 问答 |

## API

### 问答

| 方法 | 路由 | 说明 |
|------|------|------|
| `POST` | `/api/qa` | SSE 流式问答（`{ question, repo?, sessionId?, history? }`） |
| `GET` | `/api/qa/session/:id` | 会话历史 |

### 仓库管理

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/repos` | 列出已注册仓库（含索引统计） |
| `POST` | `/api/repos` | 注册仓库 `{ name, path }`（path 需有 `.codegraph/`） |
| `DELETE` | `/api/repos/:name` | 移除注册 |

### CodeGraph 工具

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/status` | 索引状态 |
| `POST` | `/api/search` | 代码搜索 |
| `POST` | `/api/context` | 符号上下文 |
| `POST` | `/api/impact` | 影响分析 |
| `POST` | `/api/callers` | 调用者 |
| `POST` | `/api/callees` | 被调用者 |
| `POST` | `/api/node` | 节点详情 |
| `POST` | `/api/explore` | 探索分析 |
| `POST` | `/api/files` | 文件列表 |

## 配置

所有配置通过 `~/.opencodewiki/config.json`，格式示例：

```json
{
  "apiKey": "sk-xxx",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "provider": "openai"
}
```

支持的环境变量（覆盖 config.json）：

| 变量 | 对应字段 | 默认值 |
|------|---------|--------|
| `OPENAI_API_KEY` | apiKey | — |
| `LLM_BASE_URL` | baseUrl | `https://api.openai.com/v1` |
| `LLM_MODEL` | model | `gpt-4o-mini` |

仓库列表存储在 `~/.opencodewiki/registry.json`。

## 任务跟踪

见 `TASKS.md`。
