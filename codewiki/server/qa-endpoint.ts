import fs from 'fs/promises';
import path from 'path';

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

    if (!question) {
      res.status(400).json({ error: 'Missing "question" in request body' });
      return;
    }

    let wikiContext = '';
    const entry = await resolveRepo(repoName);
    if (entry) {
      const overviewPath = path.join(entry.storagePath, 'wiki', 'overview.md');
      try {
        wikiContext = await fs.readFile(overviewPath, 'utf-8');
      } catch {}
    }

    let searchResults: any[] = [];
    let searchContent = '';
    try {
      searchResults = await search(question, repoName);
      if (searchResults.length > 0) {
        const repoBase = entry ? path.dirname(entry.storagePath) : null;
        const topResults = searchResults.slice(0, 5);
        const lines: string[] = [];
        for (const r of topResults) {
          lines.push(`${r.label ?? 'File'}: ${r.name ?? r.filePath?.split('/').pop() ?? '?'}` +
            ` — ${r.filePath}${r.startLine ? `:${r.startLine}` : ''}`);
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
            } catch {}
          }
        }
        searchContent = lines.join('\n');
      }
    } catch {}

    let llmConfig: any;
    try {
      llmConfig = await resolveLLMConfig();
    } catch {
      res.status(500).json({
        error:
          'Failed to resolve LLM configuration. Set GITNEXUS_API_KEY or configure ~/.gitnexus/config.json',
      });
      return;
    }

    if (!llmConfig?.apiKey) {
      res.status(500).json({ error: 'LLM API key not configured.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

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

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error');
        res.write(`data: ${JSON.stringify({ type: 'error', message: `LLM API error: ${errText.slice(0, 500)}` })}\n\n`);
        res.end();
        return;
      }

      if (!response.body) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'LLM returned no response body' })}\n\n`);
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      let buffer = '';

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
              res.write(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`);
            }
          } catch {}
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err: any) {
      if (!aborted) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message ?? 'Unknown error' })}\n\n`);
        res.end();
      }
    }
  };
}
