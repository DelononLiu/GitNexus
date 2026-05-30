/**
 * 任务序列化与持久化
 *
 * 支持 JSON 序列化和反序列化，以及 Markdown 格式导出。
 */
import { Task } from './task.js';

/**
 * 将任务列表序列化为 JSON 字符串
 */
export function toJSON(tasks: Task[]): string {
  return JSON.stringify(tasks, null, 2);
}

/**
 * 从 JSON 字符串反序列化任务列表
 */
export function fromJSON(json: string): Task[] {
  return JSON.parse(json);
}

/**
 * 将任务列表导出为 Markdown 表格格式
 */
export function exportAsMarkdown(tasks: Task[]): string {
  const lines = ['# 任务列表\n'];
  for (const t of tasks) {
    const status = t.done ? '[x]' : '[ ]';
    lines.push(`- ${status} **${t.title}** (${t.priority === 'low' ? '低' : t.priority === 'high' ? '高' : '中'})`);
    if (t.tags.length) lines.push(`  标签: ${t.tags.join(', ')}`);
  }
  return lines.join('\n');
}
