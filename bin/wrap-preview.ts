#!/usr/bin/env node
// Turns a finished build into a branch preview: the sitedrift review viewer over every page, then
// the CSP filled again so it covers the viewer. sitedrift wraps only a Workers CI build of a branch
// other than main, so the deploy job sets WORKERS_CI=1 on this step alone and the build itself
// never wraps.
import path from 'node:path';
import { installCloudflarePreview } from 'sitedrift';
import { buildOutDir, headersTemplate, workerConfig } from '../src/lib/build-output.ts';
import { CSP_INLINE_MARKER } from '../src/lib/csp.ts';
import { readJson } from '../src/lib/json.ts';
import { DEFAULT_BRANCH, SITE, SITE_ORIGIN } from '../src/lib/site-config.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { buildCsp } from './build-csp.ts';
import { cli } from './lib/args.ts';

// Every top-level key @astrojs/cloudflare writes to dist/server/wrangler.json. The upload runs
// wrangler on the deploy config a pull request's build wrote, beside the Cloudflare token, and
// wrangler executes `build.command` from it, so any other key (`build` first) is refused.
const ADAPTER_KEYS = new Set([
  'configPath', 'userConfigPath', 'topLevelName', 'definedEnvironments', 'compatibility_date', 'compatibility_flags',
  'jsx_factory', 'jsx_fragment', 'rules', 'name', 'main', 'triggers', 'assets', 'workers_dev', 'preview_urls', 'vars',
  'secrets', 'durable_objects', 'workflows', 'migrations', 'exports', 'kv_namespaces', 'cloudchamber', 'send_email',
  'queues', 'connect', 'r2_buckets', 'd1_databases', 'vectorize', 'ai_search_namespaces', 'ai_search', 'agent_memory',
  'hyperdrive', 'services', 'analytics_engine_datasets', 'dispatch_namespaces', 'mtls_certificates', 'pipelines', 'k2',
  'secrets_store_secrets', 'artifacts', 'unsafe_hello_world', 'flagship', 'worker_loaders', 'ratelimits', 'vpc_services',
  'vpc_networks', 'logfwdr', 'upload_source_maps', 'observability', 'python_modules', 'previews', 'dev', 'no_bundle',
]);

interface WorkerConfig {
  name?: unknown;
  main?: unknown;
  assets?: { directory?: unknown };
}

// What is wrong with a deploy config for the upload: an unknown key, another Worker's name, or a
// script or asset directory outside the build.
export function configProblems(config: WorkerConfig & Record<string, unknown>, root: string): string[] {
  const server = path.join(root, path.dirname(workerConfig));
  const inside = (value: unknown, dir: string) => typeof value === 'string' && !path.relative(dir, path.resolve(server, value)).startsWith('..');
  return [
    ...Object.keys(config).filter((key) => !ADAPTER_KEYS.has(key)).map((key) => `the key "${key}" is not one the adapter writes`),
    ...(config.name === SITE.worker ? [] : [`it names the Worker ${JSON.stringify(config.name)}, not "${SITE.worker}"`]),
    ...(inside(config.main, server) ? [] : ['its main script is outside the build']),
    ...(path.resolve(server, String(config.assets?.directory)) === path.join(root, buildOutDir) ? [] : [`its assets directory is not ${buildOutDir}`]),
  ];
}

export type WrapResult = { installed: true; files: number; branch: string; scriptHashes: string[]; styleHashes: string[] } | { installed: false; reason: string };

// The deploy's wrap of the build under root: refuses a deploy config it should not upload, then
// wraps when env names a Workers CI preview branch and fills the CSP again.
export async function wrapPreview(root: string, env: NodeJS.ProcessEnv): Promise<WrapResult> {
  const problems = configProblems(readJson(path.join(root, workerConfig)), root);
  if (problems.length > 0) throw new Error(`${workerConfig} is not the adapter's deploy config for this site: ${problems.join('; ')}`);

  const dir = path.join(root, buildOutDir);
  const wrap = installCloudflarePreview({
    dir,
    live: SITE_ORIGIN,
    brand: SITE.owner,
    productionBranch: DEFAULT_BRANCH,
    // Every inline tag the viewer writes carries the marker build-csp hashes.
    nonce: CSP_INLINE_MARKER,
    env,
  });
  if (!wrap.installed) return { installed: false, reason: wrap.reason };
  const { scriptHashes, styleHashes } = await buildCsp(dir, path.join(root, headersTemplate));
  return { installed: true, files: wrap.files, branch: wrap.branch, scriptHashes, styleHashes };
}

if (import.meta.main) {
  cli({ usage: 'usage: WORKERS_CI=1 WORKERS_CI_BRANCH=<branch> node bin/wrap-preview.ts' });
  const result = await wrapPreview(siteRoot, process.env);
  if (!result.installed) {
    console.error(`wrap-preview: nothing wrapped (${result.reason})\nfix: set WORKERS_CI=1 and WORKERS_CI_BRANCH to a branch other than ${DEFAULT_BRANCH}`);
    process.exit(1);
  }
  console.log(`wrap-preview: ${result.files} pages wrapped for ${result.branch}; the CSP covers ${result.scriptHashes.length} inline script and ${result.styleHashes.length} inline style hash(es)`);
}
