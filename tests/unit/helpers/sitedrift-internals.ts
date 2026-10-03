// The two untyped sitedrift internals the preview tests drive, so the tests
// assert against what the installed version actually emits.
const load = (file: string) => import(new URL(`../../../node_modules/sitedrift/src/${file}`, import.meta.url).href);

export const { frameBridge } = (await load('frame-content.mjs')) as {
  frameBridge(side: 'dev' | 'live', prefix: string): string;
};

export const { renderHostedViewer } = (await load('viewer.mjs')) as {
  renderHostedViewer(options: { live: string; brand: string; initialPath: string }): string;
};
