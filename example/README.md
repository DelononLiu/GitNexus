# Example — opencodewiki 测试项目

极简 TypeScript 项目（~100 行代码），用于快速测试 analyze + wiki + Q&A 流程。

## 架构概述

本项目是一个任务管理 CLI 工具，采用经典的三层架构设计：

### 1. 表示层（main.ts）
命令行入口，负责解析用户输入的命令和参数，调用业务逻辑层处理，
并将结果格式化后输出。支持的命令包括：添加任务、列出任务、
标记完成、搜索和按优先级过滤。

### 2. 业务逻辑层（store.ts + filter.ts）
- **TaskStore**：内存存储仓库，基于 Map 实现任务的增删改查。
  提供 add、get、list、toggle、remove、clear 等完整 CRUD 接口。
- **filter**：提供按优先级、标签和关键词的搜索过滤功能。

### 3. 数据层（task.ts + serialize.ts）
- **Task 接口**：定义任务的核心数据结构，包含 id、title、done、
  priority、tags 五个字段。
- **serialize**：支持 JSON 序列化/反序列化和 Markdown 格式导出。

### 数据流

```
用户输入 → main.ts（解析命令）
         → store.ts（数据操作）
         → task.ts（数据模型）
         → serialize.ts（格式化输出）
         → 终端显示
```

这种分层架构使各模块职责清晰，便于单元测试和后期扩展。

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
cd opencodewiki/example
gitnexus analyze

# 2. 生成 wiki
gitnexus wiki

# 3. 启动 server（从 GitNexus 根目录）
cd /home/long2015/Code/GitNexus
./opencodewiki/start.sh

# 4. 浏览器打开
# http://localhost:4747/wiki/?repo=example-tasks
# http://localhost:4747/qa/
```
