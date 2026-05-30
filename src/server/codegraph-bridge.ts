import express from 'express';
import cors from 'cors';
import { ToolHandler } from '@colbymchenry/codegraph';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4747', 10);

const handler = new ToolHandler();

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

app.listen(PORT, () => {
  console.log(`opencodewiki server running on http://localhost:${PORT}`);
});
