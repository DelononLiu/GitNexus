/**
 * Task CLI — main entry point
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
      const title = args.slice(1).join(' ');
      if (!title) { console.error('Usage: task add <title>'); return; }
      const task = store.add(title);
      console.log(`Added task: ${task.id} — ${task.title}`);
      break;
    }
    case 'list': {
      const tasks = store.list();
      if (tasks.length === 0) { console.log('No tasks.'); return; }
      console.log(exportAsMarkdown(tasks));
      break;
    }
    case 'done': {
      const id = args[1];
      if (!id) { console.error('Usage: task done <id>'); return; }
      const task = store.toggle(id);
      if (task) console.log(`Toggled: ${task.title} (done: ${task.done})`);
      else console.error('Task not found.');
      break;
    }
    case 'search': {
      const query = args.slice(1).join(' ');
      const results = search(store.list(), query);
      console.log(exportAsMarkdown(results));
      break;
    }
    case 'priority': {
      const level = args[1] as 'low' | 'medium' | 'high';
      const filtered = byPriority(store.list(), level);
      console.log(exportAsMarkdown(filtered));
      break;
    }
    default:
      console.log(`Commands: add, list, done, search, priority`);
  }
}

main();
