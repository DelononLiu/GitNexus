import fs from 'fs/promises';
import path from 'path';

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
  const line = data ? msg + ' ' + JSON.stringify(data) : msg;
  console.error('[' + ts + '] [qa] [' + level + '] ' + line);
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
) {
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
      session = { id: sessionId, messages: [], repo: repoName, createdAt: new Date(), updatedAt: new Date() };
      sessions.set(sessionId, session);
    }

    let wikiContext = '';
    const entry = await resolveRepo(repoName);
    if (entry) {
      const overviewPath = path.join(entry.storagePath, 'wiki', 'overview.md');
      try {
        wikiContext = await fs.readFile(overviewPath, 'utf-8');
      } catch {}
    }

    let llmConfig: any;
    try {
      llmConfig = await resolveLLMConfig();
    } catch (e) {
      res.status(500).json({
        error: 'Failed to resolve LLM configuration. Set GITNEXUS_API_KEY or configure ~/.gitnexus/config.json',
      });
      return;
    }

    if (!llmConfig?.apiKey) {
      res.status(500).json({ error: 'LLM API key not configured.' });
      return;
    }

    // For Chinese questions, append an English translation to help BM25 and
    // the English-only embedding model match code. One search, dual language.
    let searchQuery = question;
    if (hasChinese(question)) {
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
    session.updatedAt = new Date();

    const qType = classifyQuestion(question);
    const structure = structureGuide(qType);

    const systemPrompt = 'You are Nexus, a code analyst. Answer the question in DeepWiki style.\n\n' +
      '## RULES\n' +
      structure + '\n' +
      '- Always answer in Chinese.\n' +
      '- Use mermaid diagrams for architecture flows when relevant.\n' +
      '- Use code blocks for commands or examples.\n' +
      '- End with ## Notes (caveats, related context).\n' +
      '- End with ### Citations:\n' +
      '  **File:** path (Lstart-end)\n' +
      '  ```\n' +
      '  snippet\n' +
      '  ```\n' +
      '- Keep paragraphs short (2-4 sentences).\n' +
      '- Do not restate the question.\n' +
      '- If unsure, say so.\n\n' +
      '## ABOUT THIS QUERY\n' +
      'The user asked in Chinese. For search purposes, an English translation was appended to the original question. The SEARCH RESULTS below come from this bilingual query. Base your answer on the actual source code and flows shown in SEARCH RESULTS and EXECUTION FLOWS — not on general knowledge.\n\n' +
      '## SEARCH RESULTS\n' +
      (searchContent.slice(0, 5000) || 'No specific search results found for this query.') + '\n\n' +
      '## EXECUTION FLOWS\n' +
      (flowsText || 'No process flows found for this query.') + '\n\n' +
      '## WIKI CONTEXT\n' +
      (wikiContext ? wikiContext.slice(0, 3000) : 'No wiki documentation available.');

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
        session.updatedAt = new Date();
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
