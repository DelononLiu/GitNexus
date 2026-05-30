# OpenCodeWiki Q&A — File Reference Linkification Issues

**Date:** 2026-05-27
**Scope:** `OpenCodeWiki/server/qa-endpoint.ts` + `OpenCodeWiki/qa/index.html`

## Summary

Q&A answers contained file references like `(hybrid-search.ts:175-181)` that were displayed as plain text and not clickable. Three layered bugs prevented the linkification pipeline from working end to end.

---

## Bug 1: Backticks in system prompt → CODE tag filter

### Symptom
Frontend `processFileRefs` never matched any file references.

### Root Cause
The system prompt specified reference format with backticks:

```
引用格式：在句子末尾用 `(fileName:line)` 引用单个文件
```

The LLM faithfully copied this: `` `(README.md:30-38)` ``. When `marked.parse()` rendered the markdown, backtick-wrapped text became `<code>` elements. The TreeWalker in `processFileRefs` had a filter that skipped `CODE` and `PRE` tag children, so the references were invisible to the regex.

### Fix
Two changes:
1. **Prompt** (`qa-endpoint.ts:527-531`) — removed backticks from all reference examples and added an explicit ban: `> 引用不要用反引号包裹！错误示例：\`(file.ts:1)\`。正确：(file.ts:1)。`
2. **Frontend** (`qa/index.html:459`) — changed TreeWalker filter from skip-CODE/PRE to `null` (accept all text nodes).

### Evidence
ACP content sample log confirmed the LLM output had backtick-wrapped refs.
Frontend log `[pfr] patterns: ['README.md', 'AGENTS.md']` showed sources existed, regex should match, but toReplace count was 0.

---

## Bug 2: Basename-only references → file not found on disk

### Symptom
Backend `resolveAnswerSources` extracted file references but couldn't find them on disk:
```
resolveAnswerSources file not found {"fileName":"local-backend.ts","candidatePaths":["/home/.../local-backend.ts","/home/.../src/local-backend.ts","/home/.../lib/local-backend.ts"]}
```

### Root Cause
The LLM output contained only basenames (e.g., `hybrid-search.ts:175` instead of `gitnexus/src/core/search/hybrid-search.ts:175`). The candidate path lookup only tried `{repoBase}/`, `{repoBase}/src/`, and `{repoBase}/lib/`, which couldn't reach deeply nested files like `gitnexus/src/mcp/local/local-backend.ts`.

### Fix
Two changes:
1. **Recursive search** (`qa-endpoint.ts:213-227`) — added `findFileByBasename(dir, basename)` that walks the repo tree (skipping `.`-prefixed dirs and `node_modules`) to locate files by name.
2. **Prompt** (`qa-endpoint.ts:530`) — strengthened the instruction: `引用文件路径使用相对路径，如 gitnexus/src/core/search/bm25-index.ts:60。**绝对禁止只写文件名**，错误示例：bm25-index.ts:60。`

### Evidence
Server logs showed `candidatePaths` all missing for basename-only refs, while `findFileByBasename` successfully resolved them.

---

## Bug 3: `extractFileRefs` lost full path → pure-basename lookup

### Symptom
The backend could receive a full-path reference like `gitnexus/src/core/lbug/schema.ts:4-9` but only the basename `schema.ts` was used for file resolution.

### Root Cause
`extractFileRefs` used `m[1].split('/').pop()` to extract only the basename from the regex match, discarding the full path. The `resolveAnswerSources` function then had no way to try the full path as a candidate.

### Fix
`extractFileRefs` (`qa-endpoint.ts:194-211`) now returns `{ fileName, filePath, startLine, endLine }`:
```js
const filePath = m[1];                    // full match: "gitnexus/src/.../schema.ts"
const fileName = filePath.split('/').pop(); // basename:  "schema.ts"
```

`resolveAnswerSources` candidate paths now include:
```js
path.join(repoBase, ref.filePath),  // full path first
path.join(repoBase, ref.fileName),  // basename fallback
path.join(repoBase, 'src', ref.fileName),
path.join(repoBase, 'lib', ref.fileName),
```

---

## Frontend Enhancement

`processFileRefs` (`qa/index.html:439-483`) was also improved:

| Change | Reason |
|--------|--------|
| `nameToRef` maps both `fileName` and `filePath` to `refId` | Match full-path references in answer text |
| Patterns sorted by length descending | Prefer full-path match over basename match |
| Display text: `basename:line-endLine` | Shorter, cleaner link labels |
| CODE/PRE filter removed | Bug 1 root cause - backtick refs rendered as `<code>` |

---

## Debugging Methodology

1. **Frontend console logs** (`[qa sources]`, `[pfr]` patterns/match/toReplace) — confirmed sources arrive but TreeWalker found no text nodes.
2. **Backend server logs** (`[qa] [debug] resolveAnswerSources`) — confirmed refs extracted but files not found at candidate paths.
3. **ACP content sample log** — revealed the LLM output contains backtick-wrapped references: `` `(README.md:30-38)` ``.

The three bugs formed a chain: each fix alone was insufficient because the next bug blocked the pipeline. Only all three fixed together produced working end-to-end linkification.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Recursive search slow on large repos | Low | Skips `node_modules`; ≤6 refs per answer |
| CODE/`<pre>` text falsely linkified | Low | LLM doesn't put refs inside code blocks in practice |
| Code duplication (snippet reading) | Medium | Acceptable for now; extract helper if refactored |

## Changelog

| Date | Change |
|------|--------|
| 2026-05-27 | Initial case study: Bug 1 (backtick/CODE filter), Bug 2 (basename-only file not found), Bug 3 (lost full path) |
