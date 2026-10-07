// Ambient types for the untyped packages bin/ imports (only the surface used).

declare module 'branding-engine' {
  export interface Browser {
    close(): Promise<void>;
  }

  export interface CardColors {
    panel: string;
    panelDeep: string;
    onPanel: string;
    accent: string;
    textSoft: string;
    textMuted: string;
  }

  export interface CardOptions {
    width: number;
    height: number;
    photoWidth: number;
    eyebrow: string;
    name: string;
    tagline: string;
    meta: string;
    url: string;
    photoPath: string;
    outPath: string;
    colors: CardColors;
  }

  export interface MarkSet {
    faviconSvg: string;
    markSvg: string;
    favicon32: Buffer;
    favicon192: Buffer;
    appleTouchIcon: Buffer;
    mark512: Buffer;
    mark1024: Buffer;
    markTransparent: Buffer;
    faviconIco: Buffer;
  }

  export function launchBrowser(): Promise<Browser>;
  export function renderCard(browser: Browser, options: CardOptions): Promise<void>;
  export function renderMarkSet(options: { hex: string; onColor: string; glyph: string }): Promise<MarkSet>;
  export function wordmarkSvg(options: { tileHex: string; text: string; glyph: string; caps?: boolean }): string;
}

declare module 'severino-brand' {
  export interface ThemePair {
    primary: string;
    deep: string;
  }

  export interface WebContract {
    schema: number;
    digest: string;
    identity: Record<string, unknown>;
    surfaces: { light: string; dark: string };
    cardColors: Record<string, string>;
    primaryByTheme: { light: ThemePair; dark: ThemePair };
    designSystemCss: string;
  }

  export interface SyncTarget {
    file: string;
    label: string;
    inner: string;
  }

  export const webContract: WebContract;
  export function toJs(value: unknown, depth?: number): string;
  export function syncTargets(
    targets: readonly SyncTarget[],
    options?: { root?: string; log?: (line: string) => void; check?: boolean },
  ): number;
}
