/**
 * 任务数据模型
 *
 * 这是整个系统的核心数据架构。Task 定义了任务的基本结构，
 * 包含标题、完成状态、优先级和标签等字段。
 */
export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
}

/**
 * 创建新任务
 *
 * 工厂函数，生成一个带唯一 ID 的任务对象。
 * 默认优先级为 medium。
 */
export function createTask(title: string, priority: Task['priority'] = 'medium'): Task {
  return {
    id: crypto.randomUUID(),
    title,
    done: false,
    priority,
    tags: [],
  };
}
