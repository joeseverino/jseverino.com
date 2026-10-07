import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFrontmatter, type ParsedFrontmatter } from '../../src/lib/frontmatter.ts';
import { PAGES_FOLDER, WRITEUPS_FOLDER } from '../lib/local-paths.ts';
import type { EducationDataset } from './education.ts';

const execFileAsync = promisify(execFile);

// The vault lives in iCloud Drive, which leaves numbered conflict copies
// ("home 2.md", "some-writeup 2/") beside the real entry. They are never sources.
export const isConflictCopy = (name: string): boolean => / \d+(?:\.[^.]+)?$/.test(name);

async function readable(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
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
      if (!(await readable(sourceFile))) continue;
      const parsed = parseFrontmatter(await fs.readFile(sourceFile, 'utf8'));
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
      cached ??= parseFrontmatter(await fs.readFile(sourceFile, 'utf8'));
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

export function createEducationSource({ command = 'severino-vault-mcp' } = {}): EducationSource {
  let cached: EducationDataset | undefined;
  return {
    async load() {
      if (cached) return cached;
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(command, ['export', 'education']));
      } catch (caught) {
        const error = caught as ExecError;
        let detail: string | undefined;
        try { detail = (JSON.parse(error.stdout ?? '') as { errors?: string[] }).errors?.join('\n  '); }
        catch { detail = error.stderr?.trim() || error.message; }
        throw new Error(
          `education export failed (${command} export education):\n  ${detail}\n` +
          'Install/update with: tools reinstall severino-vault-mcp',
        );
      }
      cached = JSON.parse(stdout) as EducationDataset;
      return cached;
    },
  };
}
