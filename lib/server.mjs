import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const defaultArtifact = fileURLToPath(new URL('../Emulsion.html', import.meta.url));

// An in-memory, single-resource server: requests never become filesystem paths.
export async function serveApp({ port = 0, artifact = defaultArtifact } = {}) {
  const html = await readFile(artifact);
  const server = http.createServer((request, response) => {
    const allowed = request.url === '/' || request.url === '/Emulsion.html';
    if (!allowed || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Not found'); return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
