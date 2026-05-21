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
    try {
      searchResults = await search(question, repoName);
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

    const searchContext =
      searchResults.length > 0
        ? `\n## Relevant Code\n\n${searchResults
            .slice(0, 15)
            .map(
              (r: any, i: number) =>
                `${i + 1}. ${r.label ?? 'File'}: ${r.name ?? r.filePath?.split('/').pop() ?? '?'}\n   File: ${r.filePath}${r.startLine ? `:${r.startLine}-${r.endLine ?? ''}` : ''}`,
            )
            .join('\n')}`
        : '';

    const systemPrompt = `You are a helpful code assistant analyzing a software project. Answer questions based on the codebase and your knowledge.

${wikiContext ? `## Wiki Overview\n\n${wikiContext.slice(0, 3000)}\n` : ''}${searchContext}
When answering:
- Use Markdown formatting
- Use code blocks with language identifiers
- Reference specific files and line numbers: [[file:line]]
- Be concise and accurate
- If you don't know something, say so`;

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
