import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    if (root === resolve('.') && pathname === '/favicon.svg') pathname = '/public/favicon.svg';
    const file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root + sep) || pathname.split('/').some(p => p.startsWith('.'))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Murmuration: http://127.0.0.1:${port}`));
