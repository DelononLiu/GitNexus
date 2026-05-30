---
description: 合并当前分支到 main 并 rebase
---

将当前分支合并到 main，然后 rebase 当前分支到最新 main，保持线性历史。

## 1. 记录当前分支名

```
BRANCH=$(git branch --show-current)
echo "当前分支: $BRANCH"
```

## 2. 合并到 main

切到 main worktree（项目根目录）合并：

```
git merge $BRANCH --no-edit
```

## 3. Rebase 当前分支

回到当前 worktree，rebase 到最新 main：

```
git rebase main
```

## 4. 验证

```
git rev-list --left-right --count main...HEAD
```

输出 `0 0` 即完成。

## 原则

- 不要 push
- 完成后 main 和当前分支指向同一 commit
- 如果有冲突，在当前 worktree 解决后继续 rebase
