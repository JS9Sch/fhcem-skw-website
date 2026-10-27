import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'https://fhcem-skw-preview.pages.dev');
assert.equal(base.protocol, 'https:', 'Deployment checks require HTTPS');
async function get(path) {
  return fetch(new URL(path, base), {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: {'Cache-Control': 'no-cache'},
  });
}
async function verify() {
  const home = await get('/');
  assert.equal(home.status, 200, 'Public homepage');
  assert.match(home.headers.get('content-type') || '', /text\/html/);
  assert.match(await home.text(), /筲箕灣/);

  const session = await get('/api/session');
  assert.equal(session.status, 200, 'Session endpoint through Pages binding');
  assert.deepEqual(await session.json(), {authenticated: false});
  assert.equal(session.headers.get('cache-control'), 'no-store');

  const memberPage = await get('/members/');
  assert.equal(memberPage.status, 302, 'Anonymous member page must redirect');
  assert.equal(memberPage.headers.get('location'), '/?login=1#/');
  const memberScript = await get('/members/app.js');
  assert.equal(memberScript.status, 401, 'Anonymous private script must be denied');
  assert.equal(memberScript.headers.get('cache-control'), 'no-store');

  for (const name of ['weather', 'recreation', 'song-copyright', 'weddings-funerals']) {
    const pdf = await get(`/documents/${name}.pdf`);
    assert.equal(pdf.status, 200, `${name} PDF`);
    assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
    assert.equal(pdf.headers.get('content-disposition'), 'inline');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  }
}
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    await verify();
    console.log('Deployment checks passed: homepage, Pages binding, anonymous access protection, four inline PDFs.');
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    console.log(`Deployment not ready (attempt ${attempt}/3); retrying in 10 seconds.`);
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
