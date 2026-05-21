import fs from 'fs/promises';
import path from 'path';

// ── Session store ──────────────────────────────────────────────
interface QaMessage { role: string; content: string }
interface QaSession {
  id: string;
  messages: QaMessage[];
  repo?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessions = new Map<string, QaSession>();
let sessionSeq = 0;

function generateSessionId(): string {
  sessionSeq++;
  return String(sessionSeq);
}

export function getSession(id: string): QaSession | undefined {
  return sessions.get(id);
}

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (data && Object.keys(data).length > 0) {
    console.error(`[${ts}] [qa] [${level}] ${msg} ${JSON.stringify(data)}`);
  } else {
    console.error(`[${ts}] [qa] [${level}] ${msg}`);
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
  search: (query: string, repo?: string) => Promise<any[]>,
) {
  return async (req: any, res: any) => {
    const question = req.body?.question?.trim();
    const history: { role: string; content: string }[] = req.body?.history ?? [];
    const repoName = req.body?.repo ?? (req.query?.repo as string | undefined);
    let sessionId: string | undefined = req.body?.sessionId;

    if (!question) {
      log('warn', 'missing question in request body');
      res.status(400).json({ error: 'Missing "question" in request body' });
      return;
    }

    log('info', `Q&A request`, { repo: repoName ?? '(all)', sessionId: sessionId ?? '(new)', question: question.slice(0, 80) });

    // Load or create session
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) {
      sessionId = generateSessionId();
      session = { id: sessionId, messages: [], repo: repoName, createdAt: new Date(), updatedAt: new Date() };
      sessions.set(sessionId, session);
      log('info', `created new session`, { sessionId });
    }

    let wikiContext = '';
    const entry = await resolveRepo(repoName);
    if (entry) {
      log('info', `resolved repo`, { name: entry.name, storagePath: entry.storagePath });
      const overviewPath = path.join(entry.storagePath, 'wiki', 'overview.md');
      try {
        wikiContext = await fs.readFile(overviewPath, 'utf-8');
        log('info', `wiki context loaded`, { bytes: wikiContext.length });
      } catch {
        log('warn', 'failed to read wiki overview', { path: overviewPath });
      }
    } else {
      log('warn', `repo not found`, { repoName });
    }

    let searchResults: any[] = [];
    let searchContent = '';
    let sources: any[] = [];
    try {
      searchResults = await search(question, repoName);
      log('info', `search completed`, { total: searchResults.length, top: Math.min(searchResults.length, 5) });
      if (searchResults.length > 0) {
        const repoBase = entry ? path.dirname(entry.storagePath) : null;
        const topResults = searchResults.slice(0, 5);
        const lines: string[] = [];
        for (const r of topResults) {
          lines.push(`${r.label ?? 'File'}: ${r.name ?? r.filePath?.split('/').pop() ?? '?'}` +
            ` — ${r.filePath}${r.startLine ? `:${r.startLine}` : ''}`);
          const sourceEntry: any = {
            filePath: r.filePath,
            label: r.label ?? 'File',
            startLine: r.startLine,
            endLine: r.endLine,
            fileName: r.filePath?.split('/').pop() ?? '?',
            snippet: '',
          };
          if (repoBase && r.filePath) {
            const srcPath = path.join(repoBase, r.filePath);
            try {
              const srcContent = await fs.readFile(srcPath, 'utf-8');
              const srcLines = srcContent.split('\n');
              const start = r.startLine ? Math.max(0, r.startLine - 2) : 0;
              const end = r.endLine ? Math.min(srcLines.length, r.endLine + 2) : Math.min(srcLines.length, start + 20);
              const snippet = srcLines.slice(start, end).map((l: string, i: number) =>
                `${start + i + 1}: ${l}`).join('\n');
              lines.push(`\`\`\`\n${snippet}\n\`\`\``);
              sourceEntry.snippet = snippet;
            } catch {
              log('warn', 'failed to read source file for snippet', { filePath: r.filePath });
            }
          }
          sources.push(sourceEntry);
        }
        searchContent = lines.join('\n');
      }
    } catch (e) {
      log('error', 'search failed', { error: (e as Error)?.message });
    }

    log('info', `built sources for frontend`, { count: sources.length });

    let llmConfig: any;
    try {
      llmConfig = await resolveLLMConfig();
      log('info', `LLM config resolved`, { model: llmConfig?.model, provider: llmConfig?.provider ?? 'default' });
    } catch (e) {
      log('error', 'failed to resolve LLM config', { error: (e as Error)?.message });
      res.status(500).json({
        error:
          'Failed to resolve LLM configuration. Set GITNEXUS_API_KEY or configure ~/.gitnexus/config.json',
      });
      return;
    }

    if (!llmConfig?.apiKey) {
      log('error', 'LLM API key missing from resolved config');
      res.status(500).json({ error: 'LLM API key not configured.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Emit session ID so frontend can update URL
    res.write(`data: ${JSON.stringify({ type: 'session', id: sessionId })}\n\n`);

    res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
    log('info', `sources event emitted`, { count: sources.length });

    // Store user message in session
    session.messages.push({ role: 'user', content: question });
    session.updatedAt = new Date();

    const systemPrompt = `You are Nexus, a Code Analysis Agent with access to a Knowledge Graph. Your responses MUST be grounded.

## ⚠️ MANDATORY: GROUNDING
Every factual claim MUST include a citation.
- File refs: [[src/auth.ts:45-60]] (line range with hyphen)
- NO citation = NO claim. Say "I didn't find evidence" instead of guessing.

## 🧠 CORE PROTOCOL
You are an investigator. For each question:
1. **Search** → Review the search results and wiki context below
2. **Read** → Reference actual file content and line numbers
3. **Cite** → Ground every finding with [[file:line]]
4. **Validate** → Ensure each claim is supported by evidence

## 📊 GRAPH SCHEMA
Nodes: File, Folder, Function, Class, Interface, Method, Community, Process
Relations: CodeRelation with type: CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS, MEMBER_OF, STEP_IN_PROCESS

## 📐 GRAPH SEMANTICS
- CALLS: Method invocation OR constructor injection
- IMPORTS: File-level import/include statement
- EXTENDS/IMPLEMENTS: Class inheritance

## 🎯 OUTPUT STYLE
Think like a senior architect. Be concise—no fluff.
- Use tables for comparisons/rankings
- Use mermaid diagrams for flows/dependencies
- Use code blocks with language identifiers
- End with **TL;DR** (short summary of the response)
- If you don't know something, say so

## 📄 SEARCH RESULTS
${searchContent.slice(0, 5000) || 'No specific search results found for this query.'}

## 📚 WIKI CONTEXT
${wikiContext ? wikiContext.slice(0, 3000) : 'No wiki documentation available.'}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: question },
    ];

    const baseUrl = `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const authHeaders: Record<string, string> =
      llmConfig.provider === 'azure'
        ? { 'api-key': llmConfig.apiKey }
        : { Authorization: `Bearer ${llmConfig.apiKey}` };

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
    req.on('close', () => {
      aborted = true;
    });

    log('info', `streaming LLM response`, { model: llmConfig.model });

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error');
        log('error', `LLM API returned error`, { status: response.status, body: errText.slice(0, 200) });
        res.write(`data: ${JSON.stringify({ type: 'error', message: `LLM API error: ${errText.slice(0, 500)}` })}\n\n`);
        res.end();
        return;
      }

      if (!response.body) {
        log('error', 'LLM returned empty response body');
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'LLM returned no response body' })}\n\n`);
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';
      let tokenCount = 0;
      let assistantContent = '';

      while (true) {
        if (aborted) { log('warn', 'client aborted stream'); reader.cancel(); break; }
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
              tokenCount++;
              assistantContent += delta;
              res.write(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`);
            }
          } catch {
            log('debug', 'failed to parse SSE chunk', { chunk: data.slice(0, 100) });
          }
        }
      }

      log('info', `stream complete`, { tokens: tokenCount, sessionId, totalMsgs: session.messages.length });
      if (assistantContent) {
        session.messages.push({ role: 'assistant', content: assistantContent });
        session.updatedAt = new Date();
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err: any) {
      if (!aborted) {
        log('error', 'LLM stream failed', { error: err.message });
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message ?? 'Unknown error' })}\n\n`);
        res.end();
      }
    }
  };
}
