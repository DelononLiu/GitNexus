/**
 * Task data model
 */

export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
}

export function createTask(title: string, priority: Task['priority'] = 'medium'): Task {
  return {
    id: crypto.randomUUID(),
    title,
    done: false,
    priority,
    tags: [],
  };
}
