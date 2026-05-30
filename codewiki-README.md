# CodeWiki — DeepWiki 风格代码问答

基于 GitNexus 索引的独立 Wiki 问答系统。访问 Wiki 页面时底部有输入框，提问后跳转到独立 Q&A 页面。

## 文件结构

```
codewiki/
├── start.sh                 ← 一键启动脚本
├── README.md                ← 本文档
├── PLAN.md                  ← 架构设计
├── qa/index.html            ← Q&A 问答页面
├── server/qa-endpoint.ts    ← SSE 流式 LLM 问答端点（gitnexus 通过 new URL() 动态引用）
└── vendor/                  ← 本地 CDN 资源（无需外网）
    ├── marked.min.js        ← Markdown 渲染
    ├── highlight.min.js     ← 代码高亮
    └── mermaid.min.js       ← 图表渲染
```

## 快速开始

```bash
# 1. (一次性) 安装 gitnexus 依赖
cd gitnexus && npm install && cd ..

# 2. 启动 server
./codewiki/start.sh

# 3. 浏览器打开
#    http://localhost:4747/codewiki/你的项目名          ← Wiki
#    http://localhost:4747/codewiki/你的项目名/qa      ← Q&A
```

## 前置条件

| 条件 | 说明 | 验证方法 |
|------|------|----------|
| GitNexus 索引 | 项目已运行 `gitnexus analyze` | `ls .gitnexus/meta.json` |
| Wiki 已生成 | 项目已运行 `gitnexus wiki` | `ls .gitnexus/wiki/index.html` |
| LLM API Key | 已配置 API key | `cat ~/.gitnexus/config.json` |
| libstdc++ (可选) | 解决 tree-sitter 版本兼容 | 见下方说明 |

### 生成 Wiki 和索引

去你的项目目录执行：

```bash
cd /你的项目目录
gitnexus analyze           # 建立代码索引（如果没做过）
gitnexus wiki              # 生成 Wiki 文档（需要 API key）
```

wiki 生成需要调用 LLM，`~/.gitnexus/config.json` 配置示例：

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
  "model": "glm-4.7",
  "provider": "custom"
}
```

环境变量也可替代：
```bash
export GITNEXUS_API_KEY=your-key
export GITNEXUS_MODEL=glm-4.7
export GITNEXUS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

### libstdc++ 版本问题

系统自带的 `libstdc++.so.6` 可能版本过旧，导致 tree-sitter 加载失败：

```
Error: /usr/lib64/libstdc++.so.6: version `GLIBCXX_3.4.29' not found
```

**解决方案**：准备一个新版 `libstdc++.so.6`（例如 Node.js 发行版自带），然后：

```bash
# 方式一：设置环境变量（start.sh 会自动读取）
export LIBCXX=/path/to/your/libstdc++.so.6

# 方式二：加到 shell 配置文件（永久生效）
echo 'export LD_PRELOAD=/path/to/your/libstdc++.so.6' >> ~/.bashrc
source ~/.bashrc
```

## 测试方法

```bash
# 启动 server
./codewiki/start.sh

# 打开另一个终端测试
curl -i http://localhost:4747/qa/
curl -i 'http://localhost:4747/wiki/?repo=你的项目名'
curl -X POST http://localhost:4747/api/qa \
  -H "Content-Type: application/json" \
  -d '{"question":"Explain the architecture"}'
```

## 已修改的文件

| 文件 | 改动说明 |
|------|----------|
| `gitnexus/src/server/api.ts` | 新增路由：`/wiki/`、`/qa/`、`/vendor/`、`/api/qa`、`/codewiki/*` |
| `gitnexus/src/core/wiki/html-viewer.ts` | Wiki 底部注入 Q&A 输入框 |
