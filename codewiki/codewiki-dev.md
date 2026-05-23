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
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ node dist/cli/index.js wiki /some/repo

# 方式 B：用 tsx 开发（改源码 + 改 shared 后不用 build）
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ npx tsx src/cli/index.ts --help   # 查看命令列表
LD_LIBRARY_PATH=`pwd`/../codewiki/lib/ npx tsx src/cli/index.ts analyze /some/repo   # 如果 tsx 不报错
```

- **改 `gitnexus/` 下的代码** → 直接重新执行命令即可
- **改 `gitnexus-shared/` 下的代码** → 手动跑一次 `cd gitnexus-shared && npm run build`
- `GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1` 跳过 `tree-sitter-dart`/`tree-sitter-proto` 的 `postinstall` 编译
- `tree-sitter-kotlin` 已 vendored（`vendor/tree-sitter-kotlin/`），带有预编译 `.node` 二进制，无需额外编译
- 如需重新编译 kotlin（如换 Node 版本）：`NODE_BIN=~/nodejs/bin node scripts/build-tree-sitter-kotlin.cjs`

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