import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const landingIndexFile = fileURLToPath(
  new URL('../../../../codewiki/landing/index.html', import.meta.url),
);

export async function sendLandingPage(req: any, res: any) {
  try {
    const content = await readFile(landingIndexFile, 'utf-8');
    res.type('html').send(content);
  } catch {
    res.status(404).type('text').send('Landing page not found at ' + landingIndexFile);
  }
}
