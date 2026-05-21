# Example — CodeWiki 测试项目

极简 TypeScript 项目（~100 行代码），用于快速测试 analyze + wiki 流程。

## 文件结构

```
example/
├── package.json
├── src/
│   ├── main.ts       ← 入口，解析 CLI 参数
│   ├── task.ts       ← 数据模型（Task 接口）
│   ├── store.ts      ← TaskStore 存储类
│   ├── filter.ts     ← 过滤/搜索函数
│   └── serialize.ts  ← JSON/Markdown 序列化
```

## 快速测试

```bash
# 1. 分析示例项目
cd codewiki/example
gitnexus analyze

# 2. 生成 wiki
gitnexus wiki

# 3. 启动 server（从 GitNexus 根目录）
cd /home/long2015/Code/GitNexus
./codewiki/start.sh

# 4. 浏览器打开
# http://localhost:4747/wiki/?repo=example-tasks
# http://localhost:4747/qa/
```
