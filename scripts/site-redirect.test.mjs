import test from 'node:test';
import assert from 'node:assert/strict';
import { siteRedirect, indexable } from '../src/router.js';

test('fhcem-skw.org redirects to www with path and query', () => {
  assert.equal(siteRedirect(new URL('https://fhcem-skw.org/meetings/?a=1')), 'https://www.fhcem-skw.org/meetings/?a=1');
  assert.equal(siteRedirect(new URL('https://www.fhcem-skw.org/meetings/')), null);
  assert.equal(siteRedirect(new URL('https://fhcem-skw-website.example.workers.dev/')), null);
});
test('old Wix page addresses go to the new pages', () => {
  assert.equal(siteRedirect(new URL('https://www.fhcem-skw.org/visit_us')), 'https://www.fhcem-skw.org/contact/');
  assert.equal(siteRedirect(new URL('https://fhcem-skw.org/brethren')), 'https://www.fhcem-skw.org/members/');
  assert.equal(siteRedirect(new URL('https://www.fhcem-skw.org/About_Us/')), 'https://www.fhcem-skw.org/about/');
});
test('only public pages on www are indexable', () => {
  assert.equal(indexable(new URL('https://www.fhcem-skw.org/about/')), true);
  assert.equal(indexable(new URL('https://www.fhcem-skw.org/members/songs/')), false);
  assert.equal(indexable(new URL('https://www.fhcem-skw.org/login/')), false);
  assert.equal(indexable(new URL('https://www.fhcem-skw.org/api/session')), false);
  assert.equal(indexable(new URL('https://fhcem-skw-website.example.workers.dev/about/')), false);
});
test('robots.txt blocks test addresses only', async () => {
  const { respond } = await import('../src/router.js');
  const env = { ASSETS: { fetch: async () => new Response('User-agent: *\nSitemap: x', { headers: { 'Content-Type': 'text/plain' } }) } };
  const test = await respond(new Request('https://x.workers.dev/robots.txt'), env, {});
  assert.match(await test.text(), /Disallow: \//);
  const www = await respond(new Request('https://www.fhcem-skw.org/robots.txt'), env, {});
  assert.match(await www.text(), /Sitemap/);
});
