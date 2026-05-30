/**
 * 任务 CLI — 主入口
 *
 * 架构说明：
 * 本应用采用分层架构，分为三层：
 * 1. 表示层（main.ts）— 命令行解析与用户交互
 * 2. 业务逻辑层（store.ts + filter.ts）— 任务存储与查询
 * 3. 数据层（task.ts + serialize.ts）— 模型定义与序列化
 *
 * 这种分层架构使各模块职责清晰，便于测试和维护。
 */
import { TaskStore } from './store.js';
import { byPriority, search } from './filter.js';
import { exportAsMarkdown } from './serialize.js';

const store = new TaskStore();

function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';

  switch (command) {
    case 'add': {
      // 添加新任务
      const title = args.slice(1).join(' ');
      if (!title) { console.error('用法: task add <标题>'); return; }
      const task = store.add(title);
      console.log(`已添加任务: ${task.id} — ${task.title}`);
      break;
    }
    case 'list': {
      // 列出所有任务
      const tasks = store.list();
      if (tasks.length === 0) { console.log('暂无任务。'); return; }
      console.log(exportAsMarkdown(tasks));
      break;
    }
    case 'done': {
      // 切换任务完成状态
      const id = args[1];
      if (!id) { console.error('用法: task done <id>'); return; }
      const task = store.toggle(id);
      if (task) console.log(`已切换: ${task.title} (完成: ${task.done})`);
      else console.error('未找到该任务。');
      break;
    }
    case 'search': {
      // 搜索任务
      const query = args.slice(1).join(' ');
      const results = search(store.list(), query);
      console.log(exportAsMarkdown(results));
      break;
    }
    case 'priority': {
      // 按优先级过滤
      const level = args[1] as 'low' | 'medium' | 'high';
      const filtered = byPriority(store.list(), level);
      console.log(exportAsMarkdown(filtered));
      break;
    }
    default:
      console.log(`支持的命令: add, list, done, search, priority`);
  }
}

main();
