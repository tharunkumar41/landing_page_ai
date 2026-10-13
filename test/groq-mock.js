'use strict';
// Verifies the Groq code path against a local mock of the OpenAI-compatible endpoint (no real key/network needed).
const assert = require('assert'), http = require('http');
let calls = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const body = JSON.parse(b); calls.push({ auth: req.headers.authorization, body });
    if (calls.length === 1 && body.response_format) { res.writeHead(400); return res.end('{"error":"response_format unsupported"}'); } // force the retry path
    const content = '<think>x</think>' + JSON.stringify({ brandName: 'MockCo', headline: 'Mock headline', subtitle: 'Sub', ctaLabel: 'Go now',
      features: { title: 'F', subtitle: 's', items: [1, 2, 3, 4, 5, 6].map((i) => ({ icon: '⭐', title: 'T' + i, desc: 'd' })) } });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}).listen(0, async () => {
  process.env.GROQ_API_KEY = 'test-key'; process.env.GROQ_BASE_URL = 'http://127.0.0.1:' + srv.address().port;
  const { generateContent } = require('../lib/llm');
  try {
    const r = await generateContent({ targetAudience: 'cooks', primaryProblem: 'no time', pagePurpose: 'saas-signup', ctaUrl: 'https://x.co', preferredImages: 'tech' });
    assert.strictEqual(r.generatedBy, 'ai'); assert.strictEqual(r.content.headline, 'Mock headline'); assert.strictEqual(r.content.features.items.length, 6);
    assert.strictEqual(r.content.testimonials.items.length, 3, 'missing fields fall back to template');
    assert.strictEqual(calls[0].auth, 'Bearer test-key'); assert.strictEqual(calls[0].body.model, process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
    assert.strictEqual(calls.length, 2); assert(!calls[1].body.response_format, 'retry drops optional params');
    console.log('groq path OK: model, auth header, 400-retry, JSON extraction, per-field fallback');
  } catch (e) { console.error('FAILED', e.message); process.exitCode = 1; } finally { srv.close(); }
});
