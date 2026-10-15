import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('.');
const types = {'.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css'};
const port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + sep) || path.split('/').some(part => part.startsWith('.')) || path.includes('/node_modules/')) {
      res.writeHead(403).end(); return;
    }
    const content = await readFile(file);
    res.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'}).end(content);
  } catch {res.writeHead(404).end('Not found');}
}).listen(port, '127.0.0.1', () => console.log(`Study workspace: http://127.0.0.1:${port}`));
