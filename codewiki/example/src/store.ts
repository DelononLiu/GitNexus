/**
 * 内存任务存储
 * 
 * 基于 Map 实现的任务仓库，负责任务的增删改查。
 * 后续可扩展为文件持久化或数据库存储。
 */
import { Task, createTask } from './task.js';

export class TaskStore {
  private tasks: Map<string, Task> = new Map();

  /**
   * 添加新任务到仓库
   */
  add(title: string, priority: 'low' | 'medium' | 'high' = 'medium'): Task {
    const task = createTask(title, priority);
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * 根据 ID 获取任务
   */
  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * 获取所有任务
   */
  list(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 切换任务的完成状态
   */
  toggle(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const toggled = { ...task, done: !task.done };
    this.tasks.set(id, toggled);
    return toggled;
  }

  /**
   * 删除任务
   */
  remove(id: string): boolean {
    return this.tasks.delete(id);
  }

  /**
   * 清空所有任务
   */
  clear(): void {
    this.tasks.clear();
  }
}
