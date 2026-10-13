'use strict';
// Tests for prompt-based editing: the change-set validator (unit) and the /modify + /undo endpoints (against a mock AI).
const assert = require('assert'), http = require('http');
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-mod-'));
delete process.env.GROQ_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const LP = require('../public/js/render.js');
const { applyChanges, buildModifyPrompt } = require('../lib/modify');
const { buildDoc } = require('../lib/build');
const { fallbackContent } = require('../lib/llm');

let n = 0; const ok = (m) => console.log('  ✓', m, `(${++n})`);
const inputs = { targetAudience: 'cooks', primaryProblem: 'no time', pagePurpose: 'saas-signup', brandName: 'Acme', tone: 'professional', ctaUrl: 'https://x.co', primaryColor: '#6366f1', secondaryColor: '#ec4899', preferredImages: 'abstract', sections: ['header', 'hero', 'about', 'services', 'products', 'testimonials', 'cta', 'footer'] };
const mk = () => LP.sanitizeDoc(buildDoc(inputs, fallbackContent(inputs), [])).doc;
const sec = (d, t) => d.sections.find((s) => s.type === t);
const types = (d) => d.sections.map((s) => s.type);

/* ---------------- unit: applyChanges ---------------- */
{
  // design
  let r = applyChanges(mk(), { design: { tone: 'luxury', mode: 'dark', radius: 'pill', hero: 'centered', primary: '#16a34a', font: 'comic-sans', secondary: 'red' } });
  assert.strictEqual(r.doc.tone, 'luxury'); assert.strictEqual(r.doc.theme.mode, 'dark'); assert.strictEqual(r.doc.theme.radius, 'pill');
  assert.strictEqual(r.doc.theme.hero, 'centered'); assert.strictEqual(r.doc.theme.primary, '#16a34a');
  assert.strictEqual(r.doc.theme.font, ''); assert.strictEqual(r.doc.theme.secondary, '#ec4899');
  assert(r.skipped.some((s) => /font/i.test(s)) && r.skipped.some((s) => /secondary/i.test(s)));
  assert(LP.rootClass(r.doc).includes('lp-m-dark') && LP.rootClass(r.doc).includes('lp-tone-luxury') && LP.rootClass(r.doc).includes('lp-f-elegant'));
  ok('design settings validated: good values applied, unknown font/colour skipped');

  // set whitelist + injection/proto
  r = applyChanges(mk(), { ops: [
    { op: 'set', path: 'hero.headline', value: '<script>alert(1)</script> New headline' },
    { op: 'set', path: 'hero.media', value: 'x' }, { op: 'set', path: 'hero.url', value: 'javascript:alert(1)' },
    { op: 'set', path: '__proto__.polluted', value: 'x' }, { op: 'set', path: 'constructor', value: 'x' },
    { op: 'set', path: 'ctaUrl', value: 'https://evil.example' }, { op: 'set', path: 'brand', value: 'NewCo' },
    { op: 'set', path: 'about.paragraphs', value: ['One', 'Two'] }
  ] });
  assert(sec(r.doc, 'hero').data.headline.includes('New headline')); assert.strictEqual(r.doc.brand, 'NewCo');
  assert.strictEqual(r.doc.ctaUrl, 'https://x.co', 'AI cannot change links'); assert.strictEqual({}.polluted, undefined);
  assert.deepStrictEqual(sec(r.doc, 'about').data.paragraphs, ['One', 'Two']);
  assert(r.skipped.length >= 5);
  assert(!LP.renderDocument(r.doc, {}).includes('<script>alert(1)'), 'text is escaped when rendered');
  ok('set: only whitelisted fields; links/media/proto rejected; HTML escaped on render');

  // sections
  let d = mk();
  r = applyChanges(d, { ops: [{ op: 'add_section', type: 'video', data: { title: 'Watch' } }, { op: 'add_section', type: 'about' }, { op: 'add_section', type: 'nope' }, { op: 'remove_section', type: 'cta' }, { op: 'remove_section', type: 'contact' }] });
  assert(types(r.doc).includes('video') && !types(r.doc).includes('cta')); assert.strictEqual(sec(r.doc, 'video').data.title, 'Watch');
  assert(types(r.doc).indexOf('video') > types(r.doc).indexOf('hero') && types(r.doc).indexOf('video') < types(r.doc).indexOf('about'), 'new section placed in canonical position');
  assert.strictEqual(r.skipped.length, 3);
  ok('add/remove section; duplicates and unknown types skipped; sensible placement');

  // items
  r = applyChanges(mk(), { ops: [
    { op: 'add_item', section: 'testimonials', value: { text: 'Great', name: '' } },
    { op: 'update_item', section: 'services', index: 0, value: { title: 'Updated', bogus: 'x' } },
    { op: 'remove_item', section: 'services', index: 1 }, { op: 'update_item', section: 'services', index: 99, value: { title: 'x' } },
    { op: 'add_item', section: 'about', value: { title: 'x' } }
  ] });
  assert.strictEqual(sec(r.doc, 'services').data.items[0].title, 'Updated'); assert.strictEqual(sec(r.doc, 'services').data.items.length, 5);
  assert.strictEqual(sec(r.doc, 'services').data.items[0].bogus, undefined);
  const tt = sec(r.doc, 'testimonials').data; assert.strictEqual(tt.items.length, 4); assert.strictEqual(tt.items[3].name, 'Sample Customer'); assert.strictEqual(tt.sample, true);
  assert.strictEqual(r.skipped.length, 2);
  r = applyChanges(mk(), { ops: [{ op: 'set_items', section: 'products', items: Array.from({ length: 12 }, (_, i) => ({ name: 'P' + i, desc: 'd', price: '$1' })) }] });
  assert.strictEqual(sec(r.doc, 'products').data.items.length, 6); assert.strictEqual(sec(r.doc, 'products').data.sample, true);
  ok('item ops: field whitelist, bounds, cap of 6, AI-written products/testimonials flagged as samples');

  // order
  r = applyChanges(mk(), { order: ['footer', 'testimonials', 'hero', 'header', 'bogus'] });
  const t = types(r.doc); assert.strictEqual(t[0], 'header'); assert.strictEqual(t[t.length - 1], 'footer');
  assert(t.indexOf('testimonials') < t.indexOf('hero')); assert.strictEqual(t.length, types(mk()).length);
  ok('order: header pinned first, footer last, forgotten sections kept');

  // robustness
  [null, undefined, 'x', 5, [], { ops: 'x' }, { ops: [null, 1, 'a', {}] }, { design: 'x' }, { order: 'x' }].forEach((c) => { const out = applyChanges(mk(), c); assert(out.doc.sections.length); });
  ok('malformed change sets never throw');

  // prompt contains allow-lists and fences the user text
  const pr = buildModifyPrompt(inputs, mk(), 'make it dark');
  assert(pr.includes('luxury') && pr.includes('"mode"') === false || pr.includes('mode:'));
  assert(pr.includes('USER REQUEST (data)') && pr.includes('make it dark'));
  assert(!pr.includes('"media"'), 'media is not sent to the model');
  ok('prompt lists allowed values and treats user text as data');
}

/* ---------------- end to end with a mock AI ---------------- */
let reply = {}, mockStatus = 200, seenPrompts = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const body = JSON.parse(b); const prompt = body.messages[body.messages.length - 1].content; seenPrompts.push(prompt);
    if (mockStatus !== 200) { res.writeHead(mockStatus); return res.end('{"error":"boom"}'); }
    const content = prompt.includes('CURRENT PAGE') ? JSON.stringify(reply) : '{}';
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}).listen(0, async () => {
  const app = require('../server'); const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
  try {
    // no key -> clear 503 (create the page with the template writer first)
    const fd = new FormData();
    fd.set('targetAudience', 'cooks'); fd.set('primaryProblem', 'no time'); fd.set('pagePurpose', 'saas-signup'); fd.set('ctaUrl', 'https://example.com'); fd.set('brandName', 'Acme');
    ['header', 'hero', 'about', 'services', 'products', 'testimonials', 'cta', 'footer'].forEach((s) => fd.append('sections', s));
    const g = await j(await fetch(base + '/api/generate', { method: 'POST', body: fd })); assert.strictEqual(g.status, 200);
    const { id, token } = g.body; const H = { 'x-edit-token': token, 'content-type': 'application/json' };
    const post = (p, body, h = H) => fetch(base + '/api/pages/' + id + p, { method: 'POST', headers: h, body: JSON.stringify(body || {}) }).then(j);

    assert.strictEqual((await post('/modify', { prompt: 'make it dark' })).status, 503); ok('modify without an AI key -> 503 with a clear message');

    process.env.GROQ_API_KEY = 'k'; process.env.GROQ_BASE_URL = 'http://127.0.0.1:' + mock.address().port;
    assert.strictEqual((await post('/modify', { prompt: 'make it dark' }, { 'content-type': 'application/json' })).status, 401); ok('modify needs the edit token');
    assert.strictEqual((await post('/modify', { prompt: 'x' })).status, 400); ok('too-short prompt -> 400');

    reply = { summary: 'Dark premium look, reviews moved up', design: { tone: 'luxury', mode: 'dark', hero: 'centered', primary: '#c8a24a' }, order: ['header', 'hero', 'testimonials', 'about', 'services', 'products', 'cta', 'footer'],
      ops: [{ op: 'set', path: 'hero.headline', value: 'Quiet luxury, on a plate' }] };
    let m = await post('/modify', { prompt: 'Make it dark and premium, reviews first' });
    assert.strictEqual(m.status, 200, JSON.stringify(m.body)); assert.strictEqual(m.body.changed, true); assert.strictEqual(m.body.canUndo, true);
    assert.strictEqual(m.body.doc.theme.mode, 'dark'); assert.strictEqual(m.body.doc.tone, 'luxury'); assert.strictEqual(sec(m.body.doc, 'hero').data.headline, 'Quiet luxury, on a plate');
    assert(m.body.applied.length >= 3 && m.body.summary);
    assert(seenPrompts[seenPrompts.length - 1].includes('Make it dark and premium')); ok('modify applies design + order + copy and returns a summary');

    const got = await j(await fetch(base + '/api/pages/' + id, { headers: H }));
    assert.strictEqual(got.body.doc.theme.primary, '#c8a24a'); assert.strictEqual(got.body.canUndo, true); ok('change is persisted');
    assert.strictEqual((await post('/publish')).status, 200);
    const html = await (await fetch(base + '/p/' + id)).text();
    assert(html.includes('lp-m-dark') && html.includes('lp-tone-luxury') && html.includes('Cormorant+Garamond')); ok('published page uses the new look and loads its font');

    const u = await post('/undo'); assert.strictEqual(u.status, 200); assert.strictEqual(u.body.canUndo, false);
    assert.strictEqual(u.body.doc.theme.mode, ''); assert.notStrictEqual(sec(u.body.doc, 'hero').data.headline, 'Quiet luxury, on a plate'); ok('undo restores the previous page');
    assert.strictEqual((await post('/undo')).status, 409); ok('undo with nothing to undo -> 409');

    reply = { summary: '', question: 'Which part should be better?' };
    m = await post('/modify', { prompt: 'make it better' });
    assert.strictEqual(m.body.changed, false); assert(m.body.question); assert.strictEqual(m.body.canUndo, false); ok('vague request returns a question and changes nothing');

    reply = { summary: 'x', design: { tone: 'nonsense', mode: 'purple' }, ops: [{ op: 'set', path: 'hero.url', value: 'x' }] };
    m = await post('/modify', { prompt: 'do something odd' });
    assert.strictEqual(m.body.changed, false); assert(m.body.skipped.length >= 2); ok('only-invalid change sets are rejected, nothing saved');

    mockStatus = 500;
    m = await post('/modify', { prompt: 'make it dark' }); assert.strictEqual(m.status, 502); assert(!/boom|API 500/.test(JSON.stringify(m.body))); ok('AI failure -> 502 without leaking provider details');
    console.log(`\nAll ${n} checks passed.`);
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; }
  finally { srv.close(); mock.close(); }
});
