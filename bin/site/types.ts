// The `site` CLI's machine contract: every command under --json prints exactly
// one SiteResult on stdout. Exported for callers that drive the CLI and parse
// its output.
import type { ContentDiff } from '../content-diff.ts';
import type { CheckedDocument } from '../content-sync/sync.ts';
import type { PreflightCheck } from '../lib/preflight.ts';
import type { TechnologyTag } from '../../src/lib/technology-groups.ts';
import type { CspCounts, HeaderCheck, PiiRows, SchemaApply } from '../lib/site-ops.ts';
import type {
  FrontmatterResult, LinkResult, PlanResult, PublishReadiness, TagUsage, WriteupDashboard, WriteupListing, writeupContract,
} from '../lib/writeups/store.ts';

export const EXIT = { ok: 0, failed: 1, usage: 2, preflight: 3, timeout: 4 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

// What every command returns besides its own fields: the suggested next
// command, or null when the workflow is done.
interface Step {
  next: string | null;
}

// A repo script fronted by a command: streamed for people, captured under --json.
export interface ScriptRun {
  ok: boolean;
  exitCode: number;
  output?: string;
}

export interface NewResult extends Step {
  slug: string;
  path: string;
  url: string;
  next: string;
}

export interface ValidateResult extends Step {
  documents: CheckedDocument[];
  checked: number;
  failing: number;
}

export interface DevResult extends Step {
  drafts: boolean;
  // Astro detached the server (it does when it detects an agent caller);
  // url and pid come from .astro/dev.json.
  background: boolean;
  url: string | null;
  pid: number | null;
  exitCode: number;
}

export interface PublishCommitted {
  changed: true;
  branch: string;
  commit: string;
  message: string;
  diff: ContentDiff;
  body: string;
}

// cleanup: what removing the temporary worktree and branch left behind, each
// with the command that removes it. Absent when cleanup finished.
export type PublishResult = Step & { ok: true; cleanup?: string[] } & (
  | { status: 'nothing-to-publish'; changed: false; diff: ContentDiff; next: null }
  | (PublishCommitted & { status: 'dry-run'; dryRun: true; next: string })
  | (PublishCommitted & { status: 'pr-opened'; pr: string; next: string })
);

export interface Verified {
  slug: string;
  ok: boolean;
  url?: string;
  removed?: true;
  status?: number;
}

export type HqSync = { ran: false } | { ran: true; ok: true } | { ran: true; ok: false; retry: string };

export interface LandResult extends Step {
  ok: true;
  status: 'landed';
  pr: string;
  number: number;
  sha: string;
  diff: ContentDiff;
  verified: Verified[];
  hq: HqSync;
  next: null;
}

export interface VerifyResult extends Step, ScriptRun {
  slug: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
  title: string;
  headRefName: string;
}

export interface StatusResult extends Step {
  repo: string;
  branch: string | null;
  dirty: number;
  ahead: number | null;
  behind: number | null;
  deps: { ok: boolean; drift: string[] };
  vault: { path: string; ok: boolean };
  built: boolean;
  draftsOverlay: boolean;
  contentPrs: PullRequestRef[] | null;
}

export interface FeaturedEntry {
  slot: number;
  slug: string;
  title: string;
}

export interface FeaturedListing {
  order: FeaturedEntry[];
  flaggedDrafts: { slug: string; title: string }[];
}

export type FeaturedResult = Step & FeaturedListing & { moved?: { slug: string; slot: number } };

export interface TechResult extends Step {
  catalog: string;
  groups: { name: string; tags: TechnologyTag[] }[];
  next: null;
}

export interface SeoResult extends Step, ScriptRun {
  page: string;
  next: null;
}

export interface DraftAltResult extends Step, ScriptRun {
  slug: string;
  applied: boolean;
}

export type WriteupsResult = Step & WriteupListing & { next: null };
export type DashboardResult = Step & WriteupDashboard & { next: null };
export type TagResult = Step & TagUsage & { next: null };
export type PrepareResult = Step & PublishReadiness;
export type ApplyPlanResult = Step & PlanResult;
export type SetResult = Step & FrontmatterResult;
export type LinkCommandResult = Step & LinkResult;
export type ContractResult = Step & ReturnType<typeof writeupContract> & { next: null };
export type ContactResult = Step & PiiRows & { next: null };
export type CspResult = Step & (({ mode: 'count' } & CspCounts) | ({ mode: 'list' } & PiiRows)) & { next: null };
export type D1ApplyResult = Step & SchemaApply & { next: null };
export type HeadersResult = Step & HeaderCheck & { next: null };

// Each command's own fields.
export interface CommandResults {
  new: NewResult;
  validate: ValidateResult;
  dev: DevResult;
  publish: PublishResult;
  land: LandResult;
  verify: VerifyResult;
  status: StatusResult;
  featured: FeaturedResult;
  tech: TechResult;
  seo: SeoResult;
  'draft-alt': DraftAltResult;
  writeups: WriteupsResult;
  dashboard: DashboardResult;
  tag: TagResult;
  prepare: PrepareResult;
  'apply-plan': ApplyPlanResult;
  set: SetResult;
  link: LinkCommandResult;
  contract: ContractResult;
  contact: ContactResult;
  csp: CspResult;
  'd1-apply': D1ApplyResult;
  headers: HeadersResult;
  // Interactive: it exits from inside the TUI and never prints a result.
  manage: never;
}

export type CommandName = keyof CommandResults;

// One command's document: the envelope plus the command's own fields. status
// is the command's own when it reports one (publish, land), 'ok' otherwise.
export type SiteSuccessOf<C extends CommandName> = { ok: true; command: C; status: string } & CommandResults[C];

export type SiteSuccess = { [C in CommandName]: SiteSuccessOf<C> }[CommandName];

// --help under --json: the usage as data; command is 'help' for the command list.
export interface SiteHelp {
  ok: true;
  command: CommandName | 'help';
  status: 'help';
  usage: string;
  summary: string;
  help: string | null;
  options: { name: string; type: 'string' | 'boolean'; default?: unknown }[];
  positionals: [number, number];
  commands?: { name: CommandName; summary: string; usage: string; interactive: boolean }[];
  exitCodes: typeof EXIT;
  next: null;
}

export interface SiteFailure {
  ok: false;
  command: string | undefined;
  status: 'failed';
  error: { message: string; code: ExitCode; fix: string | null };
  // The partial result the failing step attached (preflight checks, a failing
  // validation's documents, the PR being landed).
  preflight?: PreflightCheck[];
  [partial: string]: unknown;
}

export type SiteResult = SiteSuccess | SiteHelp | SiteFailure;
