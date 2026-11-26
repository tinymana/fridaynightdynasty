/** A local stand-in for the online server, using the real API code with in-memory storage. Usage: npm run mock:online [port] */
import { createServer } from 'node:http';
import { MemoryStore, createApi } from '@fnd/online';

const port = Number(process.argv[2] ?? 8790);
const api = createApi(new MemoryStore());
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS).end('ok');
    return;
  }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    let body: unknown = {};
    try {
      body = JSON.parse(raw);
    } catch { /* handled as a bad request by the API */ }
    const r = await api(body);
    res.writeHead(r.status, { ...CORS, 'Content-Type': 'application/json' }).end(JSON.stringify(r.data));
  });
}).listen(port, () => console.log(`mock online server on http://localhost:${port}`));
