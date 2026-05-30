/**
 * 任务过滤与搜索
 *
 * 提供基于优先级、标签和关键词的过滤功能。
 */
import { Task } from './task.js';

/**
 * 按优先级过滤任务
 */
export function byPriority(tasks: Task[], priority: string): Task[] {
  return tasks.filter((t) => t.priority === priority);
}

/**
 * 按标签筛选任务
 */
export function byTag(tasks: Task[], tag: string): Task[] {
  return tasks.filter((t) => t.tags.includes(tag));
}

/**
 * 关键词搜索
 *
 * 对任务标题和标签进行模糊匹配，不区分大小写。
 */
export function search(tasks: Task[], query: string): Task[] {
  const lower = query.toLowerCase();
  return tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(lower) ||
      t.tags.some((tag) => tag.toLowerCase().includes(lower)),
  );
}
