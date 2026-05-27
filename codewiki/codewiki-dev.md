### 一、开发模式

```bash
# ====== 初始安装（一次性的） ======
cd gitnexus-shared && npm install && npm run build && cd ..

cd gitnexus
npm install --ignore-scripts

#
node node_modules/@ladybugdb/core/install.js

# ====== 日常开发 ======
cd gitnexus

# 方式 A：用 dist 测试（推荐，不受 tsx 兼容性影响）
node scripts/build.js
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ node dist/cli/index.js analyze /some/repo
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ node dist/cli/index.js wiki --lang chinese /some/repo
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ npm run serve


# 方式 B：用 tsx 开发（改源码 + 改 shared 后不用 build）
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ npx tsx src/cli/index.ts --help   # 查看命令列表
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ npx tsx src/cli/index.ts analyze /some/repo   # 如果 tsx 不报错
```

- **改 `gitnexus/` 下的代码** → 直接重新执行命令即可
- **改 `gitnexus-shared/` 下的代码** → 手动跑一次 `cd gitnexus-shared && npm run build`
- `GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1` 跳过 `tree-sitter-dart`/`tree-sitter-proto` 的 `postinstall` 编译
- `tree-sitter-kotlin` 已 vendored（`vendor/tree-sitter-kotlin/`），带有预编译 `.node` 二进制，无需额外编译
- 如需重新编译 kotlin（如换 Node 版本）：`NODE_BIN=~/nodejs/bin node scripts/build-tree-sitter-kotlin.cjs`
- 启动 server 后自带 CodeWiki Q&A 功能：`http://localhost:4747/codewiki/<repo>/qa`
- build 时注意 `node scripts/build.js` 依赖 `node` 在 PATH 中（worktree 内需 `export PATH=...`）

### 二、打包 dist 模式

```bash
# ====== 初始安装（同上） ======
cd gitnexus-shared && npm install && npm run build && cd ..
cd gitnexus && GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 npm install && cd ..

# ====== 每次打包前 ======
cd gitnexus-shared && npm run build && cd ..   # shared 有改动才需要
cd gitnexus && node scripts/build.js           # 编译 → 复制 → 重写

# 验证产物
node gitnexus/dist/cli/index.js --help

# 构建 Docker 镜像
docker build -f Dockerfile -t gitnexus:dev .
```

**注意**：
- `npm prune --omit=dev` 不在打包命令里，那是 Dockerfile 里 builder 阶段做的。本地 dev/test 不需要跑它。
- `tree-sitter-kotlin` 已 vendored（`vendor/tree-sitter-kotlin/`），自带预编译二进制。如需重新编译（换 Node 版本）：`NODE_BIN=~/nodejs/bin node scripts/build-tree-sitter-kotlin.cjs`
- 如果 `npx tsx` 报 `ERR_MODULE_NOT_FOUND`（tsx ESM 钩子兼容问题），改用方式 A 的 `node dist/cli/index.js`

### 三、多用户 Session 管理设计

**目标：** 支持多用户并发 QA，每个用户有自己的 ACP session，防止会话冲突。

**架构：**

```
服务启动
  └─ 遍历 indexed repos → 每个 repo 启动 ACP 进程 + 创建 AcpClient
                           存入 Map<repoName, AcpClient>

用户提问 (POST /api/qa)
  ├─ 无 sessionId → 创建 QA session
  │   ├─ 检查该 repo 的活跃 ACP session 数 ≤ maxSessionsPerRepo
  │   ├─ repoClients.get(repo).createSession() → 拿到 acpSessionId
  │   └─ 存入 QA session
  ├─ 有 sessionId → 恢复 QA session → 取 acpSessionId
  └─ client.sendPrompt(acpSessionId, question, handler, res)
      └─ ACP 在每个 session 上独立并行，无 busy 锁

后台定时器 (每 5min)
  └─ 扫描所有 QA session，闲置超过 30min 的：
      ├─ closeSession(acpSessionId)
      ├─ 从 repoActiveSessions 移除
      └─ 删除 QA session
```

**约束条件：**

| 参数 | 值 |
|------|-----|
| maxSessionsPerRepo | 20 |
| sessionTTL | 30 分钟 |
| cleanupInterval | 5 分钟 |

**改动文件：**

| 文件 | 改动 |
|------|------|
| `server/acp/AcpClient.ts` | 去掉 `sessionId` 单例、去掉 `_busy`；`ensureSession` → `createSession()`；`sendPrompt(text,handler)` → `sendPrompt(sessionId,text,handler)`；`cancel(sessionId)`；`closeSession(sessionId)` |
| `server/acp/callbacks.ts` | `sessionHandler` 从单 handler 改为 `Map<sessionId, AcpMessageHandler>`，按 sessionId 路由回调 |
| `server/qa-endpoint.ts` | 加 `Map<repoName, AcpClient>` 启动时初始化；QA session 加 `acpSessionId` 字段；session 数上限检查；TTL 清理定时器；`cancel` 用 `acpSessionId` |
| `../gitnexus/src/server/api.ts` | 加 `listRepos` 回调传给 `createQaEndpoint`，供启动时预创建各 repo 的 AcpClient |

**Session 生命周期：**

```
createSession() ─→ idle ─→ acquire (绑定 QA session) ─→ used ─→ release (closeSession)
                              ↑                                  ↓
                          池中预创建                         超时清理
```