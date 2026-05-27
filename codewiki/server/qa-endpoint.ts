import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ServerResponse } from 'http';
import { AcpClient } from './acp/AcpClient.js';
import type { AcpMessageHandler } from './acp/types.js';

interface QaMessage { role: string; content: string }
interface QaSession {
  id: string;
  messages: QaMessage[];
  sources: any[];
  repo?: string;
  acpSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

const sessions = new Map<string, QaSession>();

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_REPO = 20;
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function getDataDir(): string {
  return process.env.GITNEXUS_QA_DATA_DIR || path.join(os.homedir(), '.gitnexus', 'qa-sessions');
}

function sessionFilePath(id: string): string {
  return path.join(getDataDir(), id + '.json');
}

function generateSessionId(): string {
  return crypto.randomUUID();
}

function sessionToJson(s: QaSession): Record<string, unknown> {
  return { id: s.id, repo: s.repo, messages: s.messages, sources: s.sources, acpSessionId: s.acpSessionId, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

function sessionFromJson(data: Record<string, unknown>): QaSession {
  return {
    id: data.id as string,
    repo: data.repo as string | undefined,
    messages: (data.messages || []) as QaMessage[],
    sources: (data.sources || []) as any[],
    acpSessionId: data.acpSessionId as string | undefined,
    createdAt: data.createdAt as string,
    updatedAt: data.updatedAt as string,
  };
}

async function saveSession(session: QaSession): Promise<void> {
  try {
    const dir = getDataDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(sessionFilePath(session.id), JSON.stringify(sessionToJson(session)), 'utf-8');
  } catch (e) {
    log('error', 'failed to save session', { id: session.id, error: (e as Error)?.message });
  }
}

async function loadSessions(): Promise<void> {
  const dir = getDataDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const now = Date.now();
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const content = await fs.readFile(path.join(dir, f), 'utf-8');
        const data = JSON.parse(content);
        const session = sessionFromJson(data);
        const age = now - new Date(session.updatedAt).getTime();
        if (age > SESSION_MAX_AGE_MS) {
          await fs.unlink(path.join(dir, f)).catch(() => {});
          continue;
        }
        sessions.set(session.id, session);
      } catch {}
    }
    log('info', 'loaded sessions', { count: sessions.size, dir });
  } catch (e) {
    log('warn', 'no sessions dir', { dir, error: (e as Error)?.message });
  }
}

async function cleanupStaleSessions(): Promise<void> {
  const now = Date.now();
  const dir = getDataDir();
  for (const [id, session] of sessions) {
    const age = now - new Date(session.updatedAt).getTime();
    if (age > SESSION_TTL_MS) {
      closeAcpSession(session);
      sessions.delete(id);
      try { await fs.unlink(sessionFilePath(id)); } catch {}
    }
  }
  // Remove orphaned disk files
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      if (!sessions.has(id)) {
        try { await fs.unlink(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

function closeAcpSession(session: QaSession): void {
  const repoName = session.repo;
  const acpSessionId = session.acpSessionId;
  if (!repoName || !acpSessionId) return;
  const client = repoClients.get(repoName);
  if (client) {
    client.closeSession(acpSessionId);
    const active = repoActiveSessions.get(repoName);
    if (active) active.delete(acpSessionId);
  }
  session.acpSessionId = undefined;
}

loadSessions();
setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

export function getSession(id: string): QaSession | undefined {
  return sessions.get(id);
}

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [qa] [' + level + '] ' + line);
}

const ACP_ENABLED = process.env.CODEWIKI_ACP_ENABLE === 'true';

const repoClients = new Map<string, AcpClient>();
const repoActiveSessions = new Map<string, Set<string>>();

async function initRepoClient(repoName: string, repoBase: string): Promise<AcpClient | null> {
  const existing = repoClients.get(repoName);
  if (existing?.connected) return existing;

  const client = new AcpClient(repoBase);
  const ok = await client.connect();
  if (!ok) {
    log('error', 'ACP init failed', { repo: repoName, error: client.lastError });
    return null;
  }
  repoClients.set(repoName, client);
  repoActiveSessions.set(repoName, new Set());
  log('info', 'ACP repo client ready', { repo: repoName });
  return client;
}

function buildPrompt(
  question: string,
  systemPrompt: string,
  isFirstTurn: boolean,
): string {
  const parts: string[] = [];
  if (isFirstTurn) {
    parts.push('<system>\n' + systemPrompt + '\n</system>');
  }
  parts.push('<user>\n' + question + '\n</user>');
  return parts.join('\n\n');
}

async function acpPrompt(
  client: AcpClient,
  acpSessionId: string,
  question: string,
  systemPrompt: string,
  isFirstTurn: boolean,
  res: ServerResponse,
): Promise<string> {
  const prompt = buildPrompt(question, systemPrompt, isFirstTurn);
  let content = '';

  const handler: AcpMessageHandler = {
    onText: (text: string) => {
      content += text;
      res.write('data: ' + JSON.stringify({ type: 'token', content: text }) + '\n\n');
    },
    onReasoning: (text: string) => {
      res.write('data: ' + JSON.stringify({ type: 'reasoning', content: text }) + '\n\n');
    },
    onToolCall: (toolCallId, title, kind, status) => {
      log('info', 'ACP tool_call', { toolCallId, title, kind, status });
    },
    onToolCallUpdate: (toolCallId, status, content, title, kind) => {
      if (content) {
        log('info', 'ACP tool result', { toolCallId, status, len: content.length });
      }
    },
    onPlan: (entries) => {},
    onError: (error: string) => {
      res.write('data: ' + JSON.stringify({ type: 'error', message: error }) + '\n\n');
    },
    onDone: () => {},
  };

  await client.sendPrompt(acpSessionId, prompt, handler);
  return content;
}

const FILE_REF_RE = /([\w./-]+(?:\.[a-zA-Z][\w.-]*)):(\d+)(?:-(\d+))?/g;

function extractFileRefs(text: string): { fileName: string; filePath: string; startLine: number; endLine: number }[] {
  const refs: { fileName: string; filePath: string; startLine: number; endLine: number }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_REF_RE.lastIndex = 0;
  while ((m = FILE_REF_RE.exec(text)) !== null) {
    const filePath = m[1];
    const fileName = filePath.split('/').pop() || filePath;
    const startLine = parseInt(m[2], 10);
    const endLine = m[3] ? parseInt(m[3], 10) : startLine;
    const key = fileName + ':' + startLine;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ fileName, filePath, startLine, endLine });
    }
  }
  return refs;
}

async function findFileByBasename(dir: string, basename: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === basename) return fullPath;
      if (entry.isDirectory()) {
        const found = await findFileByBasename(fullPath, basename);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

async function resolveAnswerSources(
  content: string,
  existingSources: any[],
  repoBase: string | null,
): Promise<any[]> {
  const refs = extractFileRefs(content);
  if (!repoBase || refs.length === 0) return existingSources;

  const merged = [...existingSources];
  const existingKeys = new Set<string>();
  for (const s of existingSources) {
    const k = s.fileName + ':' + (s.startLine ?? '');
    existingKeys.add(k);
  }

  let refId = existingSources.length;
  for (const ref of refs) {
    const key = ref.fileName + ':' + ref.startLine;
    if (existingKeys.has(key)) continue;

    const candidatePaths = [
      path.join(repoBase, ref.filePath),
      path.join(repoBase, ref.fileName),
      path.join(repoBase, 'src', ref.fileName),
      path.join(repoBase, 'lib', ref.fileName),
    ];
    let snippet = '';
    let filePath = '';
    for (const cp of candidatePaths) {
      try {
        const stat = await fs.stat(cp);
        if (stat.isFile()) {
          filePath = cp;
          const srcContent = await fs.readFile(cp, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
          break;
        }
      } catch {}
    }
    if (!snippet) {
      const found = await findFileByBasename(repoBase, ref.fileName);
      if (found) {
        try {
          filePath = found;
          const srcContent = await fs.readFile(found, 'utf-8');
          const srcLines = srcContent.split('\n');
          const start = Math.max(0, ref.startLine - 2);
          const end = Math.min(srcLines.length, ref.endLine + 2);
          snippet = srcLines.slice(start, end).map((l, i) => (start + i + 1) + ': ' + l).join('\n');
        } catch {}
      }
    }
    if (!snippet) continue;

    existingKeys.add(key);
    merged.push({
      filePath: filePath ? path.relative(repoBase, filePath) : ref.fileName,
      label: 'File',
      startLine: ref.startLine,
      endLine: ref.endLine,
      fileName: ref.fileName,
      snippet,
      refId: refId++,
    });
  }
  return merged;
}

type QuestionType = 'overview' | 'feature' | 'debug' | 'compare' | 'api' | 'general';

function classifyQuestion(question: string): QuestionType {
  const q = question.trim().toLowerCase();
  if (/^(介绍|什么是|overview|describe|explain|tell me about|what is|架构|architecture|简介)/.test(q)) return 'overview';
  if (/(区别|差异|vs\b|versus|compared|对比|不同|difference|pros|cons|tradeoff)/.test(q)) return 'compare';
  if (/(报错|错误|失败|error|fail|bug|crash|exception|为什么|why|原因|cause|解决|fix|排查|trouble)/.test(q)) return 'debug';
  if (/(函数|方法|api\b|interface|class|function|method|参数|返回|signature|params?|returns?)/.test(q)) return 'api';
  return 'general';
}

function structureGuide(type: QuestionType): string {
  const guides: Record<QuestionType, string[]> = {
    overview: [
      '- Start with a 1-sentence summary (no heading).',
      '- Use ## Architecture with a mermaid diagram for the high-level structure.',
      '- Use ## Features with a bullet list of key capabilities.',
      '- Use ## Usage with code blocks for examples.',
    ],
    feature: [
      '- Answer directly (1 sentence, no heading).',
      '- Use ## Implementation (or ## Details) with key code snippets.',
      '- Use bullet points for steps or considerations.',
    ],
    debug: [
      '- State the cause directly (1 sentence, no heading).',
      '- Use ## Root Cause explaining what triggers the issue.',
      '- Use ## Solution with code blocks for the fix.',
    ],
    compare: [
      '- Start with a 1-sentence verdict (no heading).',
      '- Use a markdown table for side-by-side comparison.',
      '- Use ## Analysis explaining trade-offs and when to use each.',
    ],
    api: [
      '- Start with 1 sentence on what it does (no heading).',
      '- Use ## Signature with the type signature in a code block.',
      '- Use ## Parameters as a bullet list.',
      '- Use ## Example with a usage code block.',
    ],
    general: [
      '- Start with a 1-sentence direct answer (no heading).',
      '- Organize the rest into ## sections by topic.',
      '- Prefer bullet points and short paragraphs.',
    ],
  };
  return guides[type].join('\n');
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function buildSearchQuery(question: string, translation: string): string {
  return question + ' ' + translation;
}

async function translateToEnglish(question: string, llmConfig: any): Promise<string> {
  try {
    const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const authHeaders =
      llmConfig.provider === 'azure'
        ? { 'api-key': llmConfig.apiKey }
        : { Authorization: 'Bearer ' + llmConfig.apiKey };
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: 'Translate Chinese to English search keywords for code. Keep English names unchanged. Return ONLY keywords.' },
          { role: 'user', content: question },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as any;
    return data?.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return '';
  }
}

export function createQaEndpoint(
  resolveRepo: (repoName?: string) => Promise<{ storagePath: string; name: string } | undefined>,
  resolveLLMConfig: () => Promise<{
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
    provider?: string;
  }>,
  search: (query: string, repo?: string) => Promise<{ sources: any[]; flows?: string }>,
  listRepos?: () => Promise<{ name: string }[]>,
) {
  // Eager init: pre-start ACP clients for all indexed repos
  if (ACP_ENABLED && listRepos) {
    listRepos().then(repos => {
      for (const repo of repos) {
        resolveRepo(repo.name).then(entry => {
          if (entry) {
            const repoBase = path.dirname(entry.storagePath);
            initRepoClient(repo.name, repoBase);
          }
        });
      }
    });
  }

  return async (req: any, res: any) => {
    const question = req.body?.question?.trim();
    const history: { role: string; content: string }[] = req.body?.history ?? [];
    const repoName = req.body?.repo ?? (req.query?.repo as string | undefined);
    let sessionId: string | undefined = req.body?.sessionId;

    if (!question) {
      res.status(400).json({ error: 'Missing "question" in request body' });
      return;
    }

    log('info', 'Q&A request', { repo: repoName ?? '(all)', sessionId: sessionId ?? '(new)', question: question.slice(0, 80) });

    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessionId = generateSessionId();
      session = { id: sessionId, messages: [], sources: [], repo: repoName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      sessions.set(sessionId, session);
      saveSession(session);
    }

    let wikiContext = '';
    const entry = await resolveRepo(repoName);
    if (entry) {
      const overviewPath = path.join(entry.storagePath, 'wiki', 'overview.md');
      try {
        wikiContext = await fs.readFile(overviewPath, 'utf-8');
      } catch {}
    }

    let llmConfig: any = undefined;
    try {
      llmConfig = await resolveLLMConfig();
    } catch {}
    const hasLLM = !!llmConfig?.apiKey;

    if (!ACP_ENABLED && !hasLLM) {
      res.status(500).json({
        error: 'Failed to resolve LLM configuration. Set GITNEXUS_API_KEY or configure ~/.gitnexus/config.json',
      });
      return;
    }

    // For Chinese questions, append an English translation to help BM25 and
    // the English-only embedding model match code. One search, dual language.
    let searchQuery = question;
    if (hasChinese(question) && hasLLM) {
      const en = await translateToEnglish(question, llmConfig);
      if (en) searchQuery = buildSearchQuery(question, en);
    }

    let sources: any[] = [];
    let searchContent = '';
    let flowsText = '';
    try {
      const { sources: searchResults, flows: rawFlows = '' } = await search(searchQuery, repoName);
      flowsText = rawFlows;
      if (searchResults.length > 0) {
        const repoBase = entry ? path.dirname(entry.storagePath) : null;
        const topResults = searchResults.slice(0, 5);
        const lines: string[] = [];
        for (const r of topResults) {
          lines.push((r.label ?? 'File') + ': ' + (r.name ?? r.filePath?.split('/').pop() ?? '?') +
            ' — ' + r.filePath + (r.startLine ? ':' + r.startLine : ''));
          const refId = sources.length;
          const sourceEntry: any = {
            filePath: r.filePath,
            label: r.label ?? 'File',
            startLine: r.startLine,
            endLine: r.endLine,
            fileName: r.filePath?.split('/').pop() ?? '?',
            snippet: '',
            refId,
          };
          if (repoBase && r.filePath) {
            const srcPath = path.join(repoBase, r.filePath);
            try {
              const srcContent = await fs.readFile(srcPath, 'utf-8');
              const srcLines = srcContent.split('\n');
              const start = r.startLine ? Math.max(0, r.startLine - 2) : 0;
              const end = r.endLine ? Math.min(srcLines.length, r.endLine + 2) : Math.min(srcLines.length, start + 20);
              const snippet = srcLines.slice(start, end).map((l: string, i: number) =>
                (start + i + 1) + ': ' + l).join('\n');
              lines.push('```\n' + snippet + '\n```');
              sourceEntry.snippet = snippet;
            } catch {}
          }
          sources.push(sourceEntry);
        }
        searchContent = lines.join('\n');
      }
    } catch (e) {
      log('error', 'search failed', { error: (e as Error)?.message });
    }

    log('info', 'built sources count=' + sources.length);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write('data: ' + JSON.stringify({ type: 'session', id: sessionId }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'sources', sources }) + '\n\n');

    session.messages.push({ role: 'user', content: question });
    session.updatedAt = new Date().toISOString();
    saveSession(session);

    const qType = classifyQuestion(question);
    const structure = structureGuide(qType);

    const sourceRefs = sources.map((s, i) =>
      s.fileName + (s.startLine ? ':' + s.startLine + (s.endLine && s.endLine !== s.startLine ? '-' + s.endLine : '') : '')
    ).join(', ');

    const systemPrompt = 'You are codewiki, a code analyst. Answer the question in DeepWiki style.\n\n' +
      '## RULES\n' +
      structure + '\n' +
      '- Always answer in Chinese.\n' +
      '- Use mermaid diagrams for architecture flows when relevant.\n' +
      '- Use code blocks for commands or examples.\n' +
      '- End with ## Notes (caveats, related context).\n' +
      '- Keep paragraphs short (2-4 sentences).\n' +
      '- Do not restate the question.\n' +
      '- If unsure, say so.\n' +
      '- 禁止写文件，所有内容直接输出。\n' +
      '- 禁止使用 Explore Task。\n' +
      '- **问题相关信息搜索链路：gitnexus_query（自然语言探索执行流）→ gitnexus_cypher（精确图模式验证）→ gitnexus_context（单符号深度分析）→ grep（纯文本 fallback/提取）**\n' + 
      '- 每个回答至少包含 2 个引用，最多包含 6 个引用。\n' +
      '- 引用格式：在句子末尾用 (fileName:line) 引用，如 "该函数接收两个参数 (gitnexus/src/core/search/hybrid-search.ts:175)"\n' +
      '- 范围引用用 (fileName:start-end)，如 (schema.ts:4-9)\n' +
      '- **重要：每个括号内只放一个文件+一个范围，绝对禁止逗号分隔多个范围。** 错误示例：(file.ts:1,5,10) 或 (file.ts:1-3,5-8)。如果要引用多个范围，请分开成多个括号引用。\n' +
      '- 引用文件路径使用相对路径，如 gitnexus/src/core/search/bm25-index.ts:60。**绝对禁止只写文件名**，错误示例：bm25-index.ts:60。引用必须紧贴句子末尾，不要插在句子中间。\n' + 
      '> 引用不要用反引号包裹！错误示例：\`(file.ts:1)\`。正确：(file.ts:1)。\n\n';

    if (ACP_ENABLED) {
      const repoName = entry?.name;
      let acpSessionId = session.acpSessionId;

      if (repoName) {
        let client = repoClients.get(repoName);
        if (!client) {
          const repoBase = path.dirname(entry!.storagePath);
          client = await initRepoClient(repoName, repoBase);
        }

        if (client) {
          // Max session check
          const activeSessions = repoActiveSessions.get(repoName);
          if (activeSessions && activeSessions.size >= MAX_SESSIONS_PER_REPO) {
            res.write('data: ' + JSON.stringify({ type: 'error', message: 'Too many active sessions, please try again later' }) + '\n\n');
            res.end();
            return;
          }

          // Create ACP session if this QA session doesn't have one yet
          if (!acpSessionId) {
            acpSessionId = await client.createSession();
            if (acpSessionId) {
              session.acpSessionId = acpSessionId;
              activeSessions?.add(acpSessionId);
              saveSession(session);
            }
          }

          if (acpSessionId) {
            let aborted = false;
            req.on('close', () => { aborted = true; client.cancel(acpSessionId!); });

            try {
              const isFirstTurn = session.messages.length <= 1;
              const content = await acpPrompt(client, acpSessionId, question, systemPrompt, isFirstTurn, res);
              if (content && !aborted) {
                session.messages.push({ role: 'assistant', content });
                session.updatedAt = new Date().toISOString();
                const repoBase = entry ? path.dirname(entry.storagePath) : null;
                const resolvedSources = await resolveAnswerSources(content, sources, repoBase);
                const finalSources = resolvedSources.length > sources.length ? resolvedSources : sources;
                session.sources = finalSources;
                saveSession(session);
                if (resolvedSources.length > sources.length) {
                  res.write('data: ' + JSON.stringify({ type: 'sources', sources: resolvedSources }) + '\n\n');
                }
              }
              res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
              res.end();
            } catch (err: any) {
              if (!aborted) {
                log('error', 'ACP prompt failed', { error: err.message });
                res.write('data: ' + JSON.stringify({ type: 'error', message: err.message ?? 'ACP request failed' }) + '\n\n');
                res.end();
              }
            }
            return;
          }
        }
      }
      log('warn', 'ACP not available, falling back to LLM', { hasLLM });
    }

    if (!hasLLM) {
      res.write('data: ' + JSON.stringify({ type: 'error', message: 'No LLM or ACP backend available' }) + '\n\n');
      res.end();
      return;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: question },
    ];

    const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const authHeaders: Record<string, string> =
      llmConfig.provider === 'azure'
        ? { 'api-key': llmConfig.apiKey }
        : { Authorization: 'Bearer ' + llmConfig.apiKey };

    const reqBody: Record<string, unknown> = {
      model: llmConfig.model,
      messages,
      stream: true,
      max_completion_tokens: llmConfig.maxTokens ?? 16384,
    };
    if (llmConfig.temperature !== undefined) {
      reqBody.temperature = llmConfig.temperature;
    }

    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error');
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'LLM API error: ' + errText.slice(0, 500) }) + '\n\n');
        res.end();
        return;
      }

      if (!response.body) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'LLM returned no response body' }) + '\n\n');
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        if (aborted) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              res.write('data: ' + JSON.stringify({ type: 'token', content: delta }) + '\n\n');
            }
          } catch {}
        }
      }

      if (assistantContent) {
        session.messages.push({ role: 'assistant', content: assistantContent });
        session.updatedAt = new Date().toISOString();
        const repoBase = entry ? path.dirname(entry.storagePath) : null;
        const resolvedSources = await resolveAnswerSources(assistantContent, sources, repoBase);
        const finalSources = resolvedSources.length > sources.length ? resolvedSources : sources;
        session.sources = finalSources;
        saveSession(session);
        if (resolvedSources.length > sources.length) {
          res.write('data: ' + JSON.stringify({ type: 'sources', sources: resolvedSources }) + '\n\n');
        }
      }
      res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
      res.end();
    } catch (err: any) {
      if (!aborted) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: err.message ?? 'Unknown error' }) + '\n\n');
        res.end();
      }
    }
  };
}
