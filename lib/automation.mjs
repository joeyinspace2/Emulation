import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { serveApp } from './server.mjs';

async function browserExecutable(chromium, explicit) {
  const requested = explicit || process.env.EMULSION_BROWSER;
  if (requested) {
    const resolved = path.resolve(requested);
    await access(resolved, constants.X_OK);
    return resolved;
  }
  for (const candidate of [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new Error('Chromium is unavailable. Run npx playwright install chromium or set EMULSION_BROWSER to a browser executable.');
}

export async function withPhoto(image, options, operation) {
  // Only the explicitly requested source is read; the browser receives bytes, not a directory handle.
  if (!(await stat(image)).isFile()) throw new Error('Input image must be a regular file.');
  const bytes = await readFile(image);
  const { chromium } = await import('playwright');
  const executablePath = await browserExecutable(chromium, options.browser);
  let server, browser, context;
  try {
    server = await serveApp();
    const args = options.softwareGl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    browser = await chromium.launch({ executablePath, headless: true, args });
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    // No remote requests, including requests accidentally introduced by future app code.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === new URL(server.url).origin ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(server.url, {waitUntil:'load'});
    await page.waitForFunction(() => !!window.Emulsion);
    await page.evaluate(() => window.Emulsion.ready);
    await page.evaluate(async ({name, base64}) => {
      const binary = atob(base64), data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      await window.Emulsion.openFiles([new File([data], name)]);
      const state = window.Emulsion.inspect();
      if (!state.current?.loaded || !state.current.width || !state.current.height) throw new Error('Input image did not decode at full resolution.');
    }, {name:path.basename(image),base64:bytes.toString('base64')});
    return await operation(page);
  } finally {
    // Every resource is attempted even when an earlier close rejects.
    await Promise.allSettled([context?.close(), browser?.close()]);
    await server?.close();
  }
}

export async function inspectPhoto(image, options) {
  return withPhoto(image, options, page => page.evaluate(() => window.Emulsion.inspect()));
}

export async function renderPhoto(image, recipe, output, options) {
  return withPhoto(image, options, async page => {
    await page.evaluate(recipe => window.Emulsion.applyRecipe(recipe), recipe);
    const result = await page.evaluate(async output => {
      const {blob, width, height} = await window.Emulsion.render(output);
      if (blob.type !== output.type) throw new Error('Renderer returned an unexpected MIME type.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const chunks = [];
      for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
      return {base64:btoa(chunks.join('')),width,height,type:blob.type};
    }, output);
    if (!Number.isInteger(result.width) || result.width < 1 || !Number.isInteger(result.height) || result.height < 1) throw new Error('Renderer returned invalid dimensions.');
    return {...result, bytes:Buffer.from(result.base64, 'base64')};
  });
}
