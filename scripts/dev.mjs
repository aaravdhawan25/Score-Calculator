// Local dev server: serves /public and runs the /api functions the same way
// Vercel does. `npm run dev` (needs OPENAI_API_KEY) or `npm run dev:mock`.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
    try {
      const mod = await import(join(root, 'api', `${name}.js`));
      let raw = '';
      for await (const chunk of req) raw += chunk;
      req.body = raw ? JSON.parse(raw) : undefined;
      return mod.default(req, res);
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  let file = normalize(join(pub, url.pathname));
  if (!file.startsWith(pub)) { res.statusCode = 403; return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(port, () => console.log(`Tipline running at http://localhost:${port}${process.env.MOCK_AI === '1' ? ' (mock AI)' : ''}`));
