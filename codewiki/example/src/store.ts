/**
 * In-memory task storage
 */
import { Task, createTask } from './task.js';

export class TaskStore {
  private tasks: Map<string, Task> = new Map();

  add(title: string, priority: 'low' | 'medium' | 'high' = 'medium'): Task {
    const task = createTask(title, priority);
    this.tasks.set(task.id, task);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  toggle(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const toggled = { ...task, done: !task.done };
    this.tasks.set(id, toggled);
    return toggled;
  }

  remove(id: string): boolean {
    return this.tasks.delete(id);
  }

  clear(): void {
    this.tasks.clear();
  }
}
