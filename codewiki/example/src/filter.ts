/**
 * Task priority filtering
 */
import { Task } from './task.js';

export function byPriority(tasks: Task[], priority: string): Task[] {
  return tasks.filter((t) => t.priority === priority);
}

export function byTag(tasks: Task[], tag: string): Task[] {
  return tasks.filter((t) => t.tags.includes(tag));
}

export function search(tasks: Task[], query: string): Task[] {
  const lower = query.toLowerCase();
  return tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(lower) ||
      t.tags.some((tag) => tag.toLowerCase().includes(lower)),
  );
}
