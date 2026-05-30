import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ToolHandler } from '@colbymchenry/codegraph/dist/mcp/index.js';
import { CodeGraph } from '@colbymchenry/codegraph';
import { createQaEndpoint, getSession } from './qa-endpoint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

const vendorDir = path.resolve(rootDir, 'vendor');
const qaIndexFile = path.resolve(rootDir, 'src', 'qa', 'index.html');
const landingIndexFile = path.resolve(rootDir, 'src', 'landing', 'index.html');

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

async function sendLandingPage(_req: any, res: any) {
  try {
    const content = await fs.readFile(landingIndexFile, 'utf-8');
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Landing page not found');
  }
}

app.get('/opencodewiki/qa', sendQaPage);
app.get('/opencodewiki/qa/', sendQaPage);
app.get('/opencodewiki', sendLandingPage);
app.get('/opencodewiki/', sendLandingPage);

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

const resolveRepo = async (repoName?: string) => {
  return { storagePath: rootDir, name: repoName || 'opencodewiki' };
};

const resolveLLMConfig = async () => ({
  apiKey: process.env.GITNEXUS_API_KEY || process.env.OPENAI_API_KEY || '',
  baseUrl: process.env.GITNEXUS_API_BASE || 'https://api.openai.com/v1',
  model: process.env.GITNEXUS_MODEL || 'gpt-4o-mini',
  maxTokens: 4096,
  temperature: 0.3,
  provider: process.env.GITNEXUS_PROVIDER || 'openai',
});

const search = async (query: string, repo?: string) => {
  try {
    const result = await handler.execute('codegraph_search', { query, repo });
    const sources: any[] = [];
    if (result?.content?.[0]?.text) {
      try {
        const parsed = JSON.parse(result.content[0].text);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            sources.push({
              filePath: item.filePath || item.path || '',
              fileName: item.fileName || item.name || path.basename(item.filePath || item.path || ''),
              startLine: item.startLine || item.line || 1,
              endLine: item.endLine || item.line || 1,
              snippet: item.snippet || item.text || '',
            });
          }
        }
      } catch {
        sources.push({ filePath: result.content[0].text, fileName: path.basename(result.content[0].text), startLine: 1, endLine: 1 });
      }
    }
    return { sources, flows: undefined };
  } catch {
    return { sources: [], flows: undefined };
  }
};

const listRepos = async () => [{ name: 'opencodewiki' }];

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

app.listen(PORT, () => {
  console.log(`opencodewiki server running on http://localhost:${PORT}`);
});
