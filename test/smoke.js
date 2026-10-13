'use strict';
// End-to-end smoke test: spins up the server on a temp data dir and exercises the API.
const assert = require('assert');
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-'));
delete process.env.GROQ_API_KEY;               // force the template path (no network)
const app = require('../server');

(async () => {
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
  let n = 0; const ok = (m) => console.log('  ✓', m, `(${++n})`);
  try {
    // generate (with hostile input + a real PNG)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData();
    fd.set('targetAudience', '<img src=x onerror=alert(1)> busy parents');
    fd.set('problemTypo', 'x'); fd.set('primaryProblem', '"><script>alert(2)</script> no time');
    fd.set('pagePurpose', 'saas-signup'); fd.set('ctaUrl', 'https://example.com/go'); fd.set('brandName', 'Acme');
    fd.set('primaryColor', '#0f766e'); fd.set('secondaryColor', '#f59e0b'); fd.set('preferredImages', 'tech');
    ['header', 'hero', 'about', 'services', 'products', 'video', 'testimonials', 'contact', 'cta', 'footer'].forEach((s) => fd.append('sections', s));
    fd.append('images', new Blob([png], { type: 'image/png' }), 'a.png');
    const g = await j(await fetch(base + '/api/generate', { method: 'POST', body: fd }));
    assert.strictEqual(g.status, 200, JSON.stringify(g.body)); assert(g.body.id && g.body.token); assert.strictEqual(g.body.generatedBy, 'template');
    const { id, token } = g.body; ok('generate returns id + token + live URL');

    // validation
    const bad = new FormData(); bad.set('targetAudience', 'a'); bad.set('primaryProblem', 'b'); bad.set('pagePurpose', 'saas-signup'); bad.set('ctaUrl', 'javascript:alert(1)'); bad.append('sections', 'hero');
    assert.strictEqual((await j(await fetch(base + '/api/generate', { method: 'POST', body: bad }))).status, 400); ok('javascript: CTA rejected at generate');

    // not live until published
    assert.strictEqual((await fetch(base + '/p/' + id)).status, 404); ok('draft is not public');
    assert.strictEqual((await fetch(base + '/api/pages/' + id)).status, 401); ok('editor API needs token');
    assert.strictEqual((await fetch(base + '/api/pages/' + id, { headers: { 'x-edit-token': 'nope' } })).status, 401); ok('wrong token rejected');

    const H = { 'x-edit-token': token, 'content-type': 'application/json' };
    const got = await j(await fetch(base + '/api/pages/' + id, { headers: H })); assert.strictEqual(got.status, 200);
    const doc = got.body.doc; assert.strictEqual(doc.sections.length, 10); assert(doc.sections.find((s) => s.type === 'hero').data.media.url.startsWith('/uploads/')); ok('doc loads; uploaded image wired into hero');

    // save with hostile URL -> rejected; with valid edit -> saved
    const evil = JSON.parse(JSON.stringify(doc)); evil.ctaUrl = 'javascript:alert(1)';
    assert.strictEqual((await j(await fetch(base + '/api/pages/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ doc: evil }) }))).status, 400); ok('javascript: CTA rejected on save');
    const edited = JSON.parse(JSON.stringify(doc));
    edited.sections.find((s) => s.type === 'hero').data.headline = 'My <b>edited</b> headline';
    edited.sections.find((s) => s.type === 'hero').data.media = { kind: 'image', url: 'javascript:alert(3)' };
    edited.sections.find((s) => s.type === 'video').data.url = 'https://youtu.be/dQw4w9WgXcQ';
    edited.sections.find((s) => s.type === 'products').data.sample = false;
    edited.sections.find((s) => s.type === 'testimonials').data.sample = false;
    const put = await j(await fetch(base + '/api/pages/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ doc: edited }) })); assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.doc.sections.find((s) => s.type === 'hero').data.media.url, ''); ok('unsafe media URL stripped on save');

    // publish -> public page
    assert.strictEqual((await j(await fetch(base + '/api/pages/' + id + '/publish', { method: 'POST', headers: H }))).status, 200);
    const res = await fetch(base + '/p/' + id); const html = await res.text();
    assert.strictEqual(res.status, 200); assert(res.headers.get('content-security-policy').includes("script-src 'self'")); ok('published page served with CSP');
    assert(!/<script>alert|<img src=x onerror|<b>edited/.test(html), 'unescaped HTML found'); assert(html.includes('&lt;img src=x onerror=alert(1)&gt;') || html.includes('&lt;script&gt;')); ok('hostile input is HTML-escaped on the live page');
    assert(html.includes('--lp-primary:#0f766e') && html.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ') && html.includes('href="https://example.com/go"')); ok('brand colour, video embed and CTA link rendered');
    assert(!html.includes('data-edit=') && !html.includes('sec-tools')); ok('no editor markup leaks into the live page');

    // draft edits don't change the live page until republished
    edited.sections.find((s) => s.type === 'hero').data.headline = 'DRAFT ONLY HEADLINE';
    const p2 = await j(await fetch(base + '/api/pages/' + id, { method: 'PUT', headers: H, body: JSON.stringify({ doc: edited }) })); assert(p2.body.hasUnpublished);
    assert(!(await (await fetch(base + '/p/' + id)).text()).includes('DRAFT ONLY HEADLINE')); ok('live page is a snapshot; drafts do not leak');

    // uploads
    const up = async (buf, type, name) => { const f = new FormData(); f.set('file', new Blob([buf], { type }), name); return j(await fetch(base + '/api/pages/' + id + '/upload', { method: 'POST', headers: { 'x-edit-token': token }, body: f })); };
    const u1 = await up(png, 'image/png', 'x.png'); assert.strictEqual(u1.status, 200); assert.strictEqual((await fetch(base + u1.body.url)).status, 200); ok('image upload stored and served');
    assert.strictEqual((await up(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml', 'x.svg')).status, 400); ok('SVG / non-media upload rejected');
    assert.strictEqual((await up(Buffer.from('<?php echo 1;'), 'image/png', 'x.png.php')).status, 400); ok('fake image (wrong bytes) rejected');

    // contact form -> lead
    const post = async (b) => j(await fetch(base + '/api/pages/' + id + '/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }));
    assert.strictEqual((await post({ name: 'Ann', email: 'ann@example.com', message: 'Hi' })).status, 200);
    assert.strictEqual((await post({ name: 'Bot', email: 'b@example.com', message: 'x', website: 'spam' })).body.ok, true);
    assert.strictEqual((await post({ name: 'A', email: 'bad', message: 'x' })).status, 400);
    const leads = await j(await fetch(base + '/api/pages/' + id + '/leads', { headers: H })); assert.strictEqual(leads.body.leads.length, 1); ok('contact form saves leads; honeypot + validation work');

    // unpublish
    await fetch(base + '/api/pages/' + id + '/unpublish', { method: 'POST', headers: H }); assert.strictEqual((await fetch(base + '/p/' + id)).status, 404); ok('unpublish takes page offline');
    assert.strictEqual((await fetch(base + '/edit/../../etc/passwd')).status, 404); ok('path traversal on /edit blocked');
    console.log(`\nAll ${n} checks passed.`);
  } catch (e) { console.error('\nFAILED:', e.message); process.exitCode = 1; } finally { srv.close(); }
})();
