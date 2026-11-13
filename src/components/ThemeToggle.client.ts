// ThemeToggle.astro's behavior, bundled with the header's into BaseLayout's one module.

type Mode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const root = document.documentElement;
const group = document.querySelector<HTMLElement>('[data-theme-toggle]');
const choices = document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]');
const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');

function apply(mode: Mode) {
  root.dataset.themeMode = mode;

  // Auto defers theme-color to the media queries; an explicit choice pins one meta.
  metas.forEach((meta) => {
    const scheme = meta.dataset.scheme;
    meta.media = mode === 'auto' ? `(prefers-color-scheme: ${scheme})` : scheme === mode ? 'all' : 'not all';
  });

  choices.forEach((choice) => {
    choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === mode));
  });
}

if (group) {
  apply((root.dataset.themeMode as Mode) || 'auto');

  group.addEventListener('click', (event) => {
    const choice = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-theme-choice]') : null;
    if (!choice) return;

    const mode = choice.dataset.themeChoice as Mode;
    apply(mode);

    try {
      if (mode === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage blocked: the choice applies to this page view only.
    }
  });
}
