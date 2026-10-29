#!/usr/bin/env node

// Screenshots of the built site as production serves it, at each width and color scheme, for a
// look at a layout change before calling it done. Fails on a page that scrolls sideways or does
// not load.

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { buildOutDir, workerConfig } from '../src/lib/build-output.ts';
import { errorMessage } from '../src/lib/error-message.ts';
import { fromCheckoutCache, fromRoot, siteRoot } from '../src/lib/site-root.ts';
import { sitemapUrls } from '../src/lib/sitemap.ts';
import { cli, exitWith, flag } from './lib/args.ts';
import { mapLimit } from './lib/map-limit.ts';
import { spawnResult } from './lib/run.ts';

const USAGE = `usage: mise run dev:look [options] <page>... | all

A page is a path (/resume/, /portfolio/building-a-homelab/; resume is /resume/), 404 for the
not-found page, or all: every route in the build's sitemap and the not-found page.

  mise run dev:look /resume/
  mise run dev:look --widths 390 --schemes dark / /about/
  mise run dev:look --eval probe.ts /contact/

Options:
  --widths <list>   Comma-separated widths in CSS pixels (default 390,768,1440)
  --schemes <list>  Comma-separated color schemes, light and dark (default light,dark)
  --eval <file>     Run the function <file> exports as default on each page at each width and
                    scheme, after it has drawn and before the screenshot, and print what it returns.
                    It receives { path, width, scheme }, as in
                    export default () => document.querySelector('h1')?.getBoundingClientRect().toJSON()
  --build           Rebuild first (mise run build:browser's build); without it, the existing build
                    is served, and built only when there is none

Writes <page>-<width>-<scheme>.png full-page, with viewport-height slices beside it
(<page>-<width>-<scheme>.1.png, .2.png, ...), to .cache/look/, cleared each run.
Exits 1 when a page scrolls sideways or fails to load.`;

const NOT_FOUND = '404';
const outDir = fromCheckoutCache('look');

// The height and input of the device class a width belongs to: a phone, a tablet, a laptop.
const viewport = (width: number) =>
  width < 600
    ? { height: 844, isMobile: true, hasTouch: true }
    : width < 1200
      ? { height: 1024, isMobile: false, hasTouch: true }
      : { height: 900, isMobile: false, hasTouch: false };

type Pass = ReturnType<typeof viewport> & { width: number; scheme: 'light' | 'dark' };

const list = (value: string, name: string): string[] => {
  const items = value.split(',').map((item) => item.trim());
  if (items.some((item) => !item)) throw new Error(`--${name}: an empty item in ${value}`);
  return items;
};

interface Target {
  label: string;
  // The path requested: for the not-found page, one no route serves.
  path: string;
  status: number;
  // The file name its shots take: / is home, /portfolio/x/ is portfolio-x.
  name: string;
}

const target = (page: string): Target => {
  if (page === NOT_FOUND) return { label: 'not-found', path: '/dev-look-not-found/', status: 404, name: 'not-found' };
  const pathname = page.startsWith('/') ? page : `/${page}/`;
  return { label: pathname, path: pathname, status: 200, name: pathname.replace(/^\/|\/$/g, '').replaceAll('/', '-') || 'home' };
};

async function sitemapPaths(): Promise<string[]> {
  const read = (url: string) => fs.promises.readFile(path.join(siteRoot, buildOutDir, new URL(url, 'https://site.invalid').pathname), 'utf8');
  return (await sitemapUrls('/sitemap-index.xml', read)).map((url) => new URL(url).pathname);
}

const freePort = async (): Promise<number> => {
  const probe = http.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => probe.once('listening', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

// `astro preview` serves the build through the Cloudflare adapter's local Worker runtime, as
// `mise run preview` does. In a process group of its own, so the Worker runtime it starts stops
// with it, and --ignore-lock keeps it in the foreground beside any other preview.
function startPreview(port: number): { server: ChildProcess; stop: () => void; log: () => string } {
  const server = spawn('astro', ['preview', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock'], {
    cwd: siteRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout?.on('data', (chunk) => {
    log += chunk;
  });
  server.stderr?.on('data', (chunk) => {
    log += chunk;
  });
  const stop = () => {
    if (server.exitCode !== null || server.signalCode !== null || server.pid === undefined) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // The group is already gone.
    }
  };
  process.on('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stop();
      process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
    });
  }
  return { server, stop, log: () => log };
}

async function waitForServer(origin: string, server: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`astro preview exited with ${server.exitCode}:\n${log()}`);
    try {
      await fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`astro preview did not answer at ${origin} within 2 minutes:\n${log()}`);
}

// Lazy images load and every font and image has drawn, so a shot never catches a blank portrait.
const settle = (page: Page) =>
  page.evaluate(async () => {
    for (const image of document.querySelectorAll('img[loading="lazy"]')) (image as HTMLImageElement).loading = 'eager';
    // Through the page once, for whatever loads or reveals on scroll.
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise(requestAnimationFrame);
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  });

// The elements that reach past the viewport's sides, widest first, unless an ancestor that
// clips or scrolls them stays inside it.
const overflow = (page: Page) =>
  page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const outside = (element: Element) => {
      const { left, right } = element.getBoundingClientRect();
      return right > viewportWidth + 0.5 || left < -0.5;
    };
    const clipped = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowX) && !outside(parent)) return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll('body *')]
      .filter(
        (element) => element.getBoundingClientRect().width > 0 && outside(element) && getComputedStyle(element).visibility !== 'hidden' && !clipped(element),
      )
      .map((element) => {
        const { left, right } = element.getBoundingClientRect();
        const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`);
        return { name: [element.localName, element.id && `#${element.id}`, ...classes].join(''), left: Math.round(left), right: Math.round(right) };
      })
      .sort((a, b) => b.right - b.left - (a.right - a.left));
    return { scrollWidth: document.documentElement.scrollWidth, viewportWidth, offenders: offenders.slice(0, 5) };
  });

// The full page, then viewport-height slices of it beside it when it is taller than one screen.
// Returns the number of slices.
async function shoot(page: Page, file: string, height: number): Promise<number> {
  const options = { fullPage: true, animations: 'disabled', caret: 'hide' } as const;
  await page.screenshot({ ...options, path: file });
  const { width, total } = await page.evaluate(() => ({ width: document.documentElement.clientWidth, total: document.documentElement.scrollHeight }));
  if (total <= height) return 0;
  const slices = Math.ceil(total / height);
  for (let part = 1; part <= slices; part++) {
    const y = (part - 1) * height;
    await page.screenshot({ ...options, path: file.replace(/\.png$/, `.${part}.png`), clip: { x: 0, y, width, height: Math.min(height, total - y) } });
  }
  return slices;
}

async function look(): Promise<number> {
  const { values, positionals } = cli({
    usage: USAGE,
    allowPositionals: true,
    options: {
      widths: { type: 'string', default: '390,768,1440' },
      schemes: { type: 'string', default: 'light,dark' },
      eval: { type: 'string' },
      build: flag,
    },
  });
  if (positionals.length === 0) throw new Error(`name a page or all\n\n${USAGE}`);
  const widths = list(values.widths, 'widths').map((width) => {
    const number = Number(width);
    if (!Number.isInteger(number) || number < 200) throw new Error(`--widths: ${width} is not a width in CSS pixels`);
    return number;
  });
  const schemes = list(values.schemes, 'schemes').map((scheme) => {
    if (scheme !== 'light' && scheme !== 'dark') throw new Error(`--schemes: ${scheme} is neither light nor dark`);
    return scheme;
  });
  // mise runs the task from the repository root; the file is named from where it was run.
  const probe = values.eval ? (await import(pathToFileURL(path.resolve(process.env.MISE_ORIGINAL_CWD ?? '', values.eval)).href)).default : undefined;
  if (values.eval && typeof probe !== 'function') throw new Error(`--eval: ${values.eval} exports no default function`);

  if (values.build || !fs.existsSync(fromRoot(buildOutDir)) || !fs.existsSync(fromRoot(workerConfig))) {
    console.log('dev:look: building (mise run build:browser)');
    const { code } = spawnResult(process.execPath, ['tests/browser-test-env.ts', 'build'], { cwd: siteRoot, stdio: 'inherit' });
    if (code !== 0) return code;
  }
  const pages = positionals.includes('all') ? [...(await sitemapPaths()), NOT_FOUND] : positionals;
  const targets = [...new Map(pages.map((page) => [target(page).path, target(page)])).values()];

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const preview = startPreview(port);
  const browser = await chromium.launch();
  const started = Date.now();

  // Each failure prints beside the page's shots as it happens, and again in the closing summary.
  const lookAtPage = async (page: Page, { label: pageLabel, path: pathname, status, name }: Target, { width, scheme, height }: Pass): Promise<string[]> => {
    const label = `${pageLabel} ${width} ${scheme}`;
    const fail = (why: string): string => {
      const failure = `${label}: ${why}`;
      console.error(`dev:look: ${failure}`);
      return failure;
    };
    try {
      const response = await page.goto(`${origin}${pathname}`);
      if (response?.status() !== status) return [fail(`status ${response?.status()}, expected ${status}`)];
      await settle(page);
      const failures: string[] = [];
      const { scrollWidth, viewportWidth, offenders } = await overflow(page);
      if (scrollWidth > viewportWidth) {
        const named = offenders.map((offender) => `${offender.name} [${offender.left}, ${offender.right}]`).join(', ');
        failures.push(fail(`scrolls sideways, ${scrollWidth}px wide in a ${viewportWidth}px viewport${named ? `: ${named}` : ''}`));
      }
      if (probe) console.log(`${label}: ${JSON.stringify(await page.evaluate(probe, { path: pathname, width, scheme }))}`);
      const file = path.join(outDir, `${name}-${width}-${scheme}.png`);
      const slices = await shoot(page, file, height);
      console.log(slices ? `${file} (slices .1.png to .${slices}.png)` : file);
      return failures;
    } catch (error) {
      return [fail(errorMessage(error))];
    }
  };

  // One browser context per width and scheme, each walking every page.
  const lookAt = async (pass: Pass): Promise<string[]> => {
    const { width, height, scheme, isMobile, hasTouch } = pass;
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, isMobile, hasTouch });
    const page = await context.newPage();
    const failures: string[] = [];
    for (const each of targets) failures.push(...(await lookAtPage(page, each, pass)));
    await context.close();
    return failures;
  };

  const passes: Pass[] = widths.flatMap((width) => schemes.map((scheme) => ({ width, scheme, ...viewport(width) })));
  let failures: string[];
  try {
    await waitForServer(origin, preview.server, preview.log);
    // Three passes at a time, which a laptop's cores and memory hold beside the server.
    failures = (await mapLimit(passes, 3, lookAt)).flat();
  } finally {
    await browser.close();
    preview.stop();
  }

  const pageCount = `${targets.length} page${targets.length === 1 ? '' : 's'}`;
  console.log(`dev:look: ${pageCount} at ${widths.join(', ')} in ${schemes.join(' and ')}, ${((Date.now() - started) / 1000).toFixed(1)}s, in ${outDir}`);
  for (const failure of failures) console.error(`dev:look: ${failure}`);
  return failures.length ? 1 : 0;
}

await exitWith('dev:look', look);
