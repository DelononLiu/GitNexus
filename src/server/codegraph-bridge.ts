import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ToolHandler } from '@colbymchenry/codegraph/dist/mcp/index.js';
import { CodeGraph } from '@colbymchenry/codegraph';
import { createQaEndpoint, getSession, listSessions, listFrequentQuestions } from './qa-endpoint.js';

const opencodewikiDir = path.join(os.homedir(), '.opencodewiki');
const registryFile = path.join(opencodewikiDir, 'registry.json');

interface RegistryEntry {
  name: string;
  path: string;
  indexedAt: string;
}

async function loadRegistry(): Promise<RegistryEntry[]> {
  try {
    await fs.access(registryFile);
    const raw = await fs.readFile(registryFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRegistry(entries: RegistryEntry[]): Promise<void> {
  await fs.mkdir(opencodewikiDir, { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify(entries, null, 2), 'utf-8');
}

async function getCodegraphStatsFor(projectPath: string) {
  try {
    const result = await handler.execute('codegraph_status', { projectPath });
    const text = result?.content?.[0]?.text || '';
    const files = parseInt(text.match(/\*\*Files indexed:\*\*\s*(\d+)/)?.[1] || '0', 10);
    const nodes = parseInt(text.match(/\*\*Total nodes:\*\*\s*(\d+)/)?.[1] || '0', 10);
    const edges = parseInt(text.match(/\*\*Total edges:\*\*\s*(\d+)/)?.[1] || '0', 10);
    return { files, nodes, edges };
  } catch {
    return { files: 0, nodes: 0, edges: 0 };
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadEnv() {
  const envFile = path.resolve(__dirname, '..', '..', '.env');
  try {
    const text = await fs.readFile(envFile, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
await loadEnv();
const rootDir = path.resolve(__dirname, '..', '..');

const vendorDir = path.resolve(rootDir, 'vendor');
const qaIndexFile = path.resolve(rootDir, 'src', 'qa', 'index.html');
const homeIndexFile = path.resolve(rootDir, 'src', 'home', 'index.html');

async function initHandler(): Promise<ToolHandler> {
  const codegraphDir = path.join(rootDir, '.codegraph');
  let cg: CodeGraph | null = null;
  try {
    await fs.access(codegraphDir);
    cg = await CodeGraph.open(rootDir);
  } catch {
    try {
      cg = await CodeGraph.init(rootDir, { index: false });
    } catch {}
  }
  return new ToolHandler(cg);
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4747', 10);

app.use('/vendor', async (req, res, next) => {
  const filePath = path.join(vendorDir, req.path.replace(/^\//, ''));
  if (!filePath.startsWith(vendorDir)) return res.status(403).end();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const ct = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.type(ct).send(content);
  } catch { next(); }
});

async function sendQaPage(_req: any, res: any) {
  try {
    const content = await fs.readFile(qaIndexFile, 'utf-8');
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Q&A page not found');
  }
}

async function sendHomePage(_req: any, res: any) {
  try {
    const content = await fs.readFile(homeIndexFile, 'utf-8');
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Home page not found');
  }
}

app.get('/qa', sendQaPage);
app.get('/qa/', sendQaPage);
app.get('/qa/*', sendQaPage);
app.get('/', sendHomePage);
app.get('/:repoName/qa', sendQaPage);

const handler = await initHandler();

app.post('/api/search', async (req, res) => {
  const result = await handler.execute('codegraph_search', req.body);
  res.json(result);
});

app.post('/api/context', async (req, res) => {
  const result = await handler.execute('codegraph_context', req.body);
  res.json(result);
});

app.post('/api/impact', async (req, res) => {
  const result = await handler.execute('codegraph_impact', req.body);
  res.json(result);
});

app.get('/api/status', async (_req, res) => {
  const result = await handler.execute('codegraph_status', {});
  res.json(result);
});

app.post('/api/files', async (req, res) => {
  const result = await handler.execute('codegraph_files', req.body);
  res.json(result);
});

app.post('/api/callers', async (req, res) => {
  const result = await handler.execute('codegraph_callers', req.body);
  res.json(result);
});

app.post('/api/callees', async (req, res) => {
  const result = await handler.execute('codegraph_callees', req.body);
  res.json(result);
});

app.post('/api/node', async (req, res) => {
  const result = await handler.execute('codegraph_node', req.body);
  res.json(result);
});

app.post('/api/explore', async (req, res) => {
  const result = await handler.execute('codegraph_explore', req.body);
  res.json(result);
});

async function loadSavedConfig(): Promise<Record<string, string>> {
  const configDir = path.join(os.homedir(), '.opencodewiki');
  const configFile = path.join(configDir, 'config.json');
  try {
    await fs.access(configFile);
    const raw = await fs.readFile(configFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const resolveLLMConfig = async () => {
  const saved = await loadSavedConfig();
  return {
    apiKey: process.env.OPENAI_API_KEY || saved.apiKey || '',
    baseUrl: process.env.LLM_BASE_URL || saved.baseUrl || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || saved.model || 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.3,
    provider: saved.provider || 'openai',
  };
};

function parseSearchText(text: string): { filePath: string; startLine: number; endLine: number; name?: string }[] {
  const results: { filePath: string; startLine: number; endLine: number; name?: string }[] = [];
  const lines = text.split('\n');
  let currentName: string | undefined;
  for (const line of lines) {
    const headerMatch = line.match(/^###\s+(.+?)\s+\((\w+)\)\s*$/);
    if (headerMatch) {
      currentName = headerMatch[1];
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('##') && !trimmed.startsWith('*') && !trimmed.startsWith('Error') && !trimmed.startsWith('>') && !trimmed.startsWith('```')) {
      const lineNumMatch = trimmed.match(/^(.+?):(\d+)$/);
      if (lineNumMatch) {
        results.push({ filePath: lineNumMatch[1], startLine: parseInt(lineNumMatch[2], 10), endLine: parseInt(lineNumMatch[2], 10), name: currentName });
      } else if (trimmed.startsWith('/') || trimmed.startsWith('src/') || trimmed.startsWith('.')) {
        results.push({ filePath: trimmed, startLine: 1, endLine: 1, name: currentName });
      }
      currentName = undefined;
    }
  }
  return results;
}

function searchRepoPath(repoName?: string): string | undefined {
  if (!repoName || repoName === 'opencodewiki') return undefined;
  const registry = loadRegistrySync();
  return registry.find(r => r.name === repoName)?.path;
}

function loadRegistrySync(): RegistryEntry[] {
  try {
    return JSON.parse(fsSync.readFileSync(registryFile, 'utf-8'));
  } catch {
    return [];
  }
}

const search = async (query: string, repo?: string) => {
  try {
    const args: Record<string, unknown> = { query };
    const projectPath = searchRepoPath(repo);
    if (projectPath) args.projectPath = projectPath;
    const searchResult = await handler.execute('codegraph_search', args);
    const sources: any[] = [];
    if (searchResult?.content?.[0]?.text) {
      const results = parseSearchText(searchResult.content[0].text);
      for (const item of results) {
        sources.push({
          filePath: item.filePath,
          fileName: path.basename(item.filePath),
          startLine: item.startLine,
          endLine: item.endLine,
          snippet: '',
        });
      }
    }
    return { sources, flows: undefined };
  } catch {
    return { sources: [], flows: undefined };
  }
};

const resolveRepo = async (repoName?: string) => {
  if (!repoName) return { storagePath: path.join(rootDir, 'opencodewiki'), name: 'opencodewiki' };
  const registry = await loadRegistry();
  const entry = registry.find(r => r.name === repoName);
  if (entry) return { storagePath: path.join(entry.path, repoName), name: repoName };
  return { storagePath: path.join(rootDir, repoName), name: repoName };
};

const listRepos = async () => {
  const registry = await loadRegistry();
  const results = [{ name: 'opencodewiki', stats: await getCodegraphStatsFor(rootDir) }];
  for (const entry of registry) {
    if (!results.find(r => r.name === entry.name)) {
      const stats = await getCodegraphStatsFor(entry.path);
      results.push({ name: entry.name, stats: { files: stats.files, nodes: stats.nodes, processes: 0 } });
    }
  }
  return results;
};

app.get('/api/repos', async (_req, res) => {
  const repos = await listRepos();
  res.json(repos);
});

app.post('/api/repos', async (req, res) => {
  const { name, path: repoPath } = req.body;
  if (!name || !repoPath) { res.status(400).json({ error: 'Missing name or path' }); return; }
  const absPath = path.resolve(repoPath);
  try {
    await fs.access(path.join(absPath, '.codegraph'));
  } catch {
    res.status(400).json({ error: 'No .codegraph directory found at ' + absPath + '. Run `npx codegraph init` first.' });
    return;
  }
  const registry = await loadRegistry();
  if (registry.find(r => r.name === name)) {
    res.status(409).json({ error: 'Repo "' + name + '" already registered' });
    return;
  }
  const entry: RegistryEntry = { name, path: absPath, indexedAt: new Date().toISOString() };
  registry.push(entry);
  await saveRegistry(registry);
  const stats = await getCodegraphStatsFor(absPath);
  res.status(201).json({ ...entry, stats });
});

app.delete('/api/repos/:name', async (req, res) => {
  const registry = await loadRegistry();
  const idx = registry.findIndex(r => r.name === req.params.name);
  if (idx === -1) { res.status(404).json({ error: 'Repo not found' }); return; }
  registry.splice(idx, 1);
  await saveRegistry(registry);
  res.json({ removed: true });
});

const qaHandler = createQaEndpoint(resolveRepo, resolveLLMConfig, search, listRepos);
app.post('/api/qa', qaHandler);

app.get('/api/qa/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  res.json({
    id: session.id, messages: session.messages, sources: session.sources,
    repo: session.repo, createdAt: session.createdAt, updatedAt: session.updatedAt,
  });
});

app.get('/api/qa/sessions/latest', (_req, res) => {
  res.json(listSessions('latest', 10));
});

app.get('/api/qa/sessions/frequent', (_req, res) => {
  res.json(listFrequentQuestions(3));
});

const knownRepos = async () => {
  const reg = await loadRegistry();
  const names = reg.map(r => r.name);
  if (!names.includes('opencodewiki')) names.unshift('opencodewiki');
  return names;
};

async function sendWikiPage(repoName: string, _req: any, res: any) {
  const allRepos = await knownRepos();
  const repos = await listRepos();
  const repo = repos.find(r => r.name === repoName);
  if (!repo) { res.status(404).type('text').send('Repo "' + repoName + '" not found'); return; }
  const stats = repo.stats;
  const reg = await loadRegistry();
  const entry = reg.find(r => r.name === repoName);
  const repoPath = entry?.path || rootDir;
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${repoName} — OpenCodeWiki</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
body{background:#f5f5f7;color:#111}
.header{position:sticky;top:0;z-index:30;background:#fff;border-bottom:1px solid #e5e7eb;padding:14px 24px;display:flex;align-items:center;gap:12px}
.header h1{font-size:16px;font-weight:600}
.header a{color:#007aff;text-decoration:none;font-size:14px;margin-left:auto}
.main{max-width:800px;margin:0 auto;padding:32px 24px 100px}
.stats{display:flex;gap:16px;margin:20px 0 32px}
.stat-box{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;flex:1;text-align:center}
.stat-box .num{font-size:24px;font-weight:700;color:#007aff}
.stat-box .label{font-size:12px;color:#888;margin-top:4px}
.repo-list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
.repo-list a{padding:6px 14px;border-radius:20px;border:1px solid #e5e7eb;text-decoration:none;font-size:13px;color:#555;background:#fff}
.repo-list a.active{background:#007aff;color:#fff;border-color:#007aff}
.bottom-bar{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:100%;max-width:640px;z-index:20;padding:0 16px}
.input-box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:10px 16px;display:flex;align-items:flex-end;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.input-box:focus-within{border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.18)}
.input-box textarea{flex:1;border:none;outline:none;font-size:16px;resize:none;overflow:hidden;padding:3px 0;min-height:56px;line-height:1.6;font-family:inherit}
.input-box textarea::placeholder{color:#aaa}
.input-box button{padding:8px 22px;background:#007aff;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}
.input-box button:hover{opacity:.88}
.input-box textarea::-webkit-scrollbar{width:4px}
.input-box textarea::-webkit-scrollbar-thumb{background:#bbb;border-radius:2px}
.input-box textarea::-webkit-scrollbar-button{display:none}
</style></head>
<body>
<div class="header">
  <h1 style="color:#007aff;display:inline"><a href="/" style="color:inherit;text-decoration:none">OpenCodeWiki</a></h1>
  <span style="font-size:13px;color:#888">${repoName}</span>
</div>
<div class="main">
  <div class="repo-list">${allRepos.map(n => '<a href="/' + encodeURIComponent(n) + '"' + (n === repoName ? ' class="active"' : '') + '>' + n + '</a>').join('')}</div>
  <div class="stats">
    <div class="stat-box"><div class="num">${stats.files}</div><div class="label">Files</div></div>
    <div class="stat-box"><div class="num">${stats.nodes}</div><div class="label">Symbols</div></div>
    <div class="stat-box"><div class="num">${stats.edges ?? '-'}</div><div class="label">Relations</div></div>
  </div>
</div>
<div class="bottom-bar">
  <div class="input-box">
    <form action="/qa" method="get" style="display:flex;align-items:flex-end;gap:8px;width:100%">
      <input type="hidden" name="repo" value="${repoName}">
      <textarea name="q" placeholder="${repoName} 相关问题..." autocomplete="off" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.form.submit()}"></textarea>
      <button type="submit">Ask</button>
    </form>
  </div>
</div>
</body></html>`;
  res.type('html').send(html);
}

app.get('/:repoName', async (req, res, next) => {
  const names = await knownRepos();
  if (names.includes(req.params.repoName)) {
    await sendWikiPage(req.params.repoName, req, res);
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`OpenCodeWiki server running on http://localhost:${PORT}`);
});
