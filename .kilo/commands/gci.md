---
description: 分析改动并提交 git commit
---

根据 AGENTS.md 中的 Git 提交规范执行：

## 1. 调研（单次 Shell）

运行一条命令获取全部状态：
```
git status --porcelain && echo "===DIFF===" && git diff && echo "===STAGED===" && git diff --cached && echo "===LOG===" && git log --oneline -5
```

## 2. 分析

检查输出中是否有敏感文件（.env、credentials.json 等），有则警告不要提交。根据改动内容分析性质和范围，草拟提交消息。

## 消息格式

```
<type>: <简短描述>

[可选正文说明为什么改]
```

**类型**：`feat` — 新功能 | `fix` — 修复 bug | `refactor` — 重构 | `docs` — 文档 | `chore` — 构建/工具

**规则**：简短描述不超过 50 字，使用中文

## 3. 执行（单次 Shell）

```
git add -A && git commit -m "<消息>" && git status --short
```

## 原则
- 不要自动 push
- 如果提交被 hook 拒绝，修复问题后重新提交（不要 amend）
