import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { type ParsedFrontmatter, parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { readJson } from '../../src/lib/json.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { assertMatches, type JsonSchema } from '../lib/json-schema.ts';
import { PAGES_FOLDER, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import type { EducationDataset } from './education.ts';

const execFileAsync = promisify(execFile);

// The vault lives in iCloud Drive, which leaves numbered conflict copies
// ("home 2.md", "some-writeup 2/") beside the real entry. They are never sources.
export const isConflictCopy = (name: string): boolean => / \d+(?:\.[^.]+)?$/.test(name);

// The file's text, or undefined when there is no such file.
async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export interface SourceEntry {
  slug: string;
  sourceDir: string;
  sourceFile: string;
  parsed: ParsedFrontmatter;
}

export function createVaultSource({ vaultRoot, includeDrafts = false }: { vaultRoot: string; includeDrafts?: boolean }) {
  const pagesRoot = path.join(vaultRoot, PAGES_FOLDER);
  const writeupsRoot = path.join(vaultRoot, WRITEUPS_FOLDER);

  async function entries(root: string, { files = false } = {}): Promise<SourceEntry[]> {
    const result: SourceEntry[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.') || isConflictCopy(entry.name)) continue;
      if (files ? !entry.isFile() : !entry.isDirectory()) continue;
      const slug = files ? path.basename(entry.name, '.md') : entry.name;
      const sourceDir = files ? root : path.join(root, entry.name);
      const sourceFile = files ? path.join(root, entry.name) : path.join(sourceDir, 'index.md');
      const text = await readIfPresent(sourceFile);
      if (text === undefined) continue;
      const parsed = parseFrontmatter(text);
      if (!includeDrafts && parsed.data.published !== true) continue;
      result.push({ slug, sourceDir, sourceFile, parsed });
    }
    return result;
  }

  return {
    pagesRoot,
    writeupsRoot,
    technologyGroups: path.join(pagesRoot, '_technology-groups.md'),
    pages: () => entries(pagesRoot, { files: false }),
    writeups: () => entries(writeupsRoot),
  };
}

export function createResumeSource({ lifeVaultRoot, includeDrafts = false }: { lifeVaultRoot: string; includeDrafts?: boolean }) {
  const sourceFile = path.join(lifeVaultRoot, 'Career', 'resume.md');
  let cached: ParsedFrontmatter | undefined;
  return {
    sourceFile,
    async load(): Promise<ParsedFrontmatter | null> {
      if (!cached) {
        const text = await readIfPresent(sourceFile);
        if (text === undefined) throw new Error(`resume source not found: ${sourceFile} (set LIFE_VAULT_DIR)`);
        cached = parseFrontmatter(text);
      }
      return !includeDrafts && cached.data.published !== true ? null : cached;
    },
  };
}

export interface EducationSource {
  load(): Promise<EducationDataset>;
}

// execFile's rejection: an Error carrying the child's output.
interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
}

type EducationExport = (EducationDataset & { ok: true }) | { ok: false; errors: string[] };

// Held to public/schemas/education-export-v1.json, whichever way it arrives.
function parseExport(text: string, label: string): EducationDataset {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not JSON`);
  }
  assertMatches<EducationExport>(readJson<JsonSchema>(path.join(siteRoot, 'public/schemas/education-export-v1.json')), data, label);
  if (!data.ok) throw new Error(`${label} reports:\n  ${data.errors.join('\n  ')}`);
  return data;
}

// The errors a failed export reports on stdout, when it printed its JSON.
function reportedErrors(stdout: string | undefined): string[] | undefined {
  try {
    return (JSON.parse(stdout ?? '') as { errors?: string[] }).errors;
  } catch {
    return undefined;
  }
}

const EXPORT_COMMAND = 'severino-vault-mcp';

// `file` is an export a trusted runner supplies (EDUCATION_EXPORT_FILE); without one the
// export is made by running the vault MCP's CLI, the local default.
export function createEducationSource({ file }: { file?: string | undefined } = {}): EducationSource {
  let cached: EducationDataset | undefined;
  return {
    async load() {
      if (cached) return cached;
      if (file) {
        cached = parseExport(await fs.readFile(file, 'utf8'), file);
        return cached;
      }
      const label = `${EXPORT_COMMAND} export education`;
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(EXPORT_COMMAND, ['export', 'education']));
      } catch (caught) {
        const error = caught as ExecError;
        const detail = reportedErrors(error.stdout)?.join('\n  ') ?? (error.stderr?.trim() || error.message);
        throw new Error(`education export failed (${label}):\n  ${detail}\nInstall/update with: tools reinstall ${EXPORT_COMMAND}`);
      }
      cached = parseExport(stdout, label);
      return cached;
    },
  };
}
