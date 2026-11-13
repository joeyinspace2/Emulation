import http from 'node:http';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const defaultArtifact = fileURLToPath(new URL('../Emulsion.html', import.meta.url));
const sessionClient = fileURLToPath(new URL('./session-client.js', import.meta.url));
const recipeModel = createRequire(import.meta.url)('../src/recipe.js');
const maxRecipeBytes = 32 * 1024 * 1024;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const revisionOf = bytes => createHash('sha256').update(bytes).digest('hex');
const inline = text => text.replace(/</g, '\\u003c');

function hostOf(request) {
  try { return new URL('http://' + request.headers.host).hostname.toLowerCase(); } catch { return ''; }
}
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRecipeBytes) throw Object.assign(new Error('Recipe is larger than 32 MiB.'), {status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parseRecipe(bytes) {
  let recipe;
  try { recipe = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error('Invalid recipe JSON: ' + error.message); }
  return recipeModel.validate(recipe);
}
// Rename within the directory: a reader never sees a half-written recipe.
async function replaceFile(file, text) {
  const temp = await mkdtemp(path.join(path.dirname(file), '.emulsion-'));
  try {
    await writeFile(path.join(temp, 'recipe'), text, {flag:'wx'});
    await rename(path.join(temp, 'recipe'), file);
  } finally { await rm(temp, {recursive:true, force:true}); }
}

// In-memory editor plus, for a live session, exactly one photo and one recipe.
// Request URLs never become filesystem paths.
// session: {photo, recipe, allowHosts, onBlockedHost}. The photo is read-only;
// the recipe file is the state shared by the open editor and whoever edits the file.
export async function serveApp({ port = 0, artifact = defaultArtifact, session } = {}) {
  let html = await readFile(artifact);
  const token = randomBytes(16).toString('hex'), root = '/session/' + token + '/';
  const allowed = new Set([...loopback, ...(session?.allowHosts || []).map(host => host.toLowerCase())]);
  const blocked = new Set();
  if (session) {
    const page = html.toString('utf8'), end = page.lastIndexOf('</body>');
    if (end < 0) throw new Error('The editor HTML has no closing body tag.');
    const config = {base:'session/' + token + '/', photo:path.basename(session.photo), recipe:path.basename(session.recipe)};
    html = Buffer.from(page.slice(0, end)
      + '<script type="application/json" id="emulsion-session">' + inline(JSON.stringify(config)) + '</script>\n'
      + '<script>\n' + (await readFile(sessionClient, 'utf8')).replace(/<\/script/gi, '<\\/script') + '</script>\n'
      + page.slice(end));
  }
  const headers = type => ({'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'});
  const send = (response, status, type, content, extra = {}) => {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    response.writeHead(status, {...headers(type), 'Content-Length':bytes.length, ...extra});
    response.end(bytes);
  };
  const text = (response, status, message) => send(response, status, 'text/plain; charset=utf-8', message);

  async function sessionRequest(request, response) {
    if (request.url === root + 'photo' && request.method === 'GET') {
      return send(response, 200, 'application/octet-stream', await readFile(session.photo));
    }
    if (request.url !== root + 'recipe') return text(response, 404, 'Not found');
    if (request.method === 'GET') {
      const bytes = await readFile(session.recipe);
      // Whoever writes the file may be mid-save; the editor keeps its state and asks again.
      let recipe;
      try { recipe = parseRecipe(bytes); } catch (error) { return text(response, 422, error.message); }
      return send(response, 200, 'application/json', JSON.stringify(recipe), {'X-Emulsion-Revision':revisionOf(bytes)});
    }
    if (request.method === 'PUT') {
      if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) return text(response, 415, 'Send the recipe as application/json.');
      let recipe;
      try { recipe = parseRecipe(await body(request)); } catch (error) { return text(response, error.status || 422, error.message); }
      // The editor states which file contents its edits started from. A newer file wins.
      const current = revisionOf(await readFile(session.recipe));
      if (request.headers['if-match'] !== current) return text(response, 409, 'The recipe file changed. Its newer edits take priority.');
      const saved = JSON.stringify(recipe, null, 2) + '\n';
      await replaceFile(session.recipe, saved);
      return send(response, 204, 'text/plain', '', {'X-Emulsion-Revision':revisionOf(Buffer.from(saved))});
    }
    return text(response, 405, 'Method not allowed');
  }

  const server = http.createServer((request, response) => {
    if (session) {
      // A site that points its own domain at this loopback port must not read the photo.
      const host = hostOf(request);
      if (!allowed.has(host)) {
        if (!blocked.has(host)) { blocked.add(host); session.onBlockedHost?.(host); }
        return text(response, 403, 'Emulsion preview does not accept the address "' + host + '". Restart preview with --allow-host ' + host + ' to use it.');
      }
      if (request.url.startsWith('/session/')) {
        return void sessionRequest(request, response).catch(error => {
          if (response.headersSent) response.destroy(); else text(response, 500, error.message);
        });
      }
    }
    const known = request.url === '/' || request.url === '/Emulsion.html';
    if (!known || !['GET', 'HEAD'].includes(request.method)) return text(response, 404, 'Not found');
    response.writeHead(200, {...headers('text/html; charset=utf-8'), 'Content-Length':html.length});
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
