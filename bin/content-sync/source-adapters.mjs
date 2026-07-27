import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFrontmatter } from '../../src/lib/frontmatter.mjs';

const execFileAsync = promisify(execFile);

async function readable(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

export function createVaultSource({ vaultRoot, includeDrafts = false }) {
  const pagesRoot = path.join(vaultRoot, '06 Pages');
  const writeupsRoot = path.join(vaultRoot, '05 Writeups');

  async function entries(root, { files = false } = {}) {
    const result = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
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

export function createResumeSource({ lifeVaultRoot, includeDrafts = false }) {
  const sourceFile = path.join(lifeVaultRoot, 'Career', 'resume.md');
  let cached;
  return {
    sourceFile,
    async load() {
      cached ??= parseFrontmatter(await fs.readFile(sourceFile, 'utf8'));
      return !includeDrafts && cached.data.published !== true ? null : cached;
    },
  };
}

export function createEducationSource({ command = 'severino-edu-mcp' } = {}) {
  let cached;
  return {
    async load() {
      if (cached) return cached;
      let stdout;
      try {
        ({ stdout } = await execFileAsync(command, ['export']));
      } catch (error) {
        let detail;
        try { detail = JSON.parse(error.stdout).errors?.join('\n  '); }
        catch { detail = error.stderr?.trim() || error.message; }
        throw new Error(
          `education export failed (${command} export):\n  ${detail}\n` +
          'Install/update with: uv tool install --reinstall ~/Documents/Code/Assets/severino-edu-mcp',
        );
      }
      cached = JSON.parse(stdout);
      return cached;
    },
  };
}
