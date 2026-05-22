#!/bin/bash
# CodeWiki 完整初始化脚本
# 从 npm install 到 analyze + wiki + 服务器启动
# 用法: ./codewiki/bootstrap.sh /path/to/target/repo [--lang english]
#
# 前置条件:
#   1. Node.js 22 (https://nodejs.org/dist/)
#   2. 本仓库已 clone 到本地
#   3. 目标仓库已 clone 到本地

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="${NODE_BIN:-$HOME/nodejs/node-v22.22.2-linux-x64/bin}"
TARGET="${1:-}"
LANG="${2:---lang chinese}"

if [ -z "$TARGET" ]; then
  echo "用法: $0 /path/to/target/repo [--lang english]"
  exit 1
fi
if [ ! -d "$TARGET" ]; then
  echo "错误: 目标目录不存在: $TARGET"
  exit 1
fi

export PATH="$NODE_BIN:$PATH"

echo "=== 1. 安装依赖 ==="
cd "$REPO_DIR/gitnexus-shared"
npm install --ignore-scripts
cd "$REPO_DIR/gitnexus"
npm install --ignore-scripts

echo "=== 2. 编译 gitnexus-shared ==="
cd "$REPO_DIR/gitnexus-shared"
npx tsc

echo "=== 3. 编译 gitnexus ==="
cd "$REPO_DIR/gitnexus"
rm -rf dist
npx tsc --rootDir .. --outDir dist

# 重组 dist 目录
node -e '
const fs=require("fs"),p=require("path"),d="dist";
const s=p.join(d,"gitnexus/src");
for(const e of fs.readdirSync(s)){
  const src=p.join(s,e),dst=p.join(d,e);
  if(fs.existsSync(dst))fs.rmSync(dst,{recursive:true});
  fs.renameSync(src,dst);
}
fs.rmSync(p.join(d,"gitnexus"),{recursive:true});
if(fs.existsSync(p.join(d,"codewiki")))fs.renameSync(p.join(d,"codewiki"),p.join(d,"_codewiki"));
'

# 复制 shared 模块并重写 import
node -e '
const fs=require("fs"),p=require("path"),d="dist",sd=p.join(d,"_shared");
fs.cpSync("../gitnexus-shared/dist",sd,{recursive:true});
(function w(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const f=p.join(dir,e.name);
    if(e.isDirectory()){w(f);continue}
    if(!f.endsWith(".js")&&!f.endsWith(".d.ts"))continue;
    let c=fs.readFileSync(f,"utf-8"),m=false;
    if(c.includes("gitnexus-shared")){
      const r=p.relative(p.dirname(f),sd).split(p.sep).join("/")+"/index.js";
      c=c.replace(/from\s+["\x27"]gitnexus-shared["\x27"]/g,"from \x27"+r+"\x27")
        .replace(/import\(\s*["\x27"]gitnexus-shared["\x27"]\s*\)/g,"import(\x27"+r+"\x27)");
      m=true;
    }
    if(f.endsWith("server/api.js")){
      c=c.replace(/\.\.\/\.\.\/codewiki\/server\/qa-endpoint\.js/g,"../_codewiki/server/qa-endpoint.js");
      m=true;
    }
    if(m)fs.writeFileSync(f,c);
  }
})(d);
fs.chmodSync(p.join(d,"cli/index.js"),0o755);
'

echo "=== 4. 确保目标为 git 仓库 ==="
if ! git -C "$TARGET" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$TARGET" init
  echo "  已创建 git 仓库"
fi

echo "=== 5. 分析代码 (analyze) ==="
node "$REPO_DIR/gitnexus/dist/cli/index.js" analyze "$TARGET"

echo "=== 6. 生成 Wiki ==="
node "$REPO_DIR/gitnexus/dist/cli/index.js" wiki "$TARGET" "$LANG"

echo ""
echo "=== 完成 ==="
echo "Wiki 页面: $TARGET/.gitnexus/wiki/index.html"
echo ""
echo "启动服务器:"
echo "  cd $REPO_DIR && bash codewiki/start.sh"
echo "然后访问: http://localhost:4747/codewiki/$(basename "$TARGET")"
