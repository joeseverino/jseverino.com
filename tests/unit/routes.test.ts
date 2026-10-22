import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFile } from '../../bin/lib/routes.ts';

test('a route maps to the file it is served from', () => {
  assert.equal(routeFile('/'), 'index.html');
  assert.equal(routeFile('/about/'), 'about/index.html');
  assert.equal(routeFile('/portfolio/building-a-homelab/'), 'portfolio/building-a-homelab/index.html');
  assert.equal(routeFile('/404.html'), '404.html');
  assert.equal(routeFile('/resume.pdf'), 'resume.pdf');
});
