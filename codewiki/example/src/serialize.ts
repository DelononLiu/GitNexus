/**
 * Task serialization (JSON persistence)
 */
import { Task } from './task.js';

export function toJSON(tasks: Task[]): string {
  return JSON.stringify(tasks, null, 2);
}

export function fromJSON(json: string): Task[] {
  return JSON.parse(json);
}

export function exportAsMarkdown(tasks: Task[]): string {
  const lines = ['# Tasks\n'];
  for (const t of tasks) {
    const status = t.done ? '[x]' : '[ ]';
    lines.push(`- ${status} **${t.title}** (${t.priority})`);
    if (t.tags.length) lines.push(`  tags: ${t.tags.join(', ')}`);
  }
  return lines.join('\n');
}
