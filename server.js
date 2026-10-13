'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tiny .env loader (no extra dependency)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env */ }

const express = require('express');
const multer = require('multer');
const store = require('./lib/store');
const LP = require('./public/js/render.js');
const { generateContent, regenerateSection, PURPOSES, TONES, hasAI } = require('./lib/llm');
const { requestChanges, applyChanges } = require('./lib/modify');
const { buildDoc } = require('./lib/build');
const { THEME_IDS, DEFAULT_THEME_ID } = require('./lib/themes');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const origin = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

// ---------- tiny in-memory rate limiter ----------
const hits = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ':' + req.ip + ':' + (req.params.id || '');
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// ---------- uploads ----------
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
function sniff(buf) {
  const hex = buf.slice(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (buf.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  return null;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 3 } });

async function saveUpload(pageId, file, { imagesOnly }) {
  const type = sniff(file.buffer);               // trust the bytes, not the filename or header
  if (!type || (imagesOnly && !type.startsWith('image/'))) throw Object.assign(new Error('Unsupported file type. Use JPG, PNG, WebP, GIF, MP4 or WebM.'), { status: 400 });
  const dir = path.join(store.UPLOADS, pageId);
  await fs.promises.mkdir(dir, { recursive: true });
  const name = crypto.randomBytes(8).toString('hex') + '.' + MIME_EXT[type];
  await fs.promises.writeFile(path.join(dir, name), file.buffer);
  return { url: `/uploads/${pageId}/${name}`, kind: type.startsWith('video/') ? 'video' : 'image' };
}

app.use('/uploads', express.static(store.UPLOADS, { maxAge: '7d', index: false, dotfiles: 'deny' }));

// ---------- auth helper ----------
const token = (req) => req.get('x-edit-token') || '';
async function owned(req, res) {
  const page = await store.read(req.params.id);
  if (!page) { res.status(404).json({ error: 'Page not found' }); return null; }
  if (!store.authorised(page, token(req))) { res.status(401).json({ error: 'Invalid or missing edit token' }); return null; }
  return page;
}
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const view = (page) => ({
  id: page.id, doc: page.doc, createdAt: page.createdAt, updatedAt: page.updatedAt, publishedAt: page.publishedAt || null,
  generatedBy: page.generatedBy, live: !!page.published,
  hasUnpublished: !!page.published && JSON.stringify(page.published) !== JSON.stringify(page.doc),
  canUndo: Array.isArray(page.history) && page.history.length > 0
});

// ---------- 1. generate ----------
app.post('/api/generate', limit('gen', 10, 3600e3), upload.array('images', 3), wrap(async (req, res) => {
  const b = req.body || {};
  const clean = (v, max) => String(v || '').trim().slice(0, max);
  let sections = b.sections;
  sections = Array.isArray(sections) ? sections : sections ? [sections] : [];
  sections = sections.filter((s) => LP.SECTION_ORDER.includes(s));
  const inputs = {
    targetAudience: clean(b.targetAudience, 200),
    primaryProblem: clean(b.primaryProblem, 400),
    pagePurpose: clean(b.pagePurpose, 40),
    brandName: clean(b.brandName, 60),
    tone: TONES[b.tone] ? b.tone : 'professional',
    pageTheme: b.pageTheme === 'custom' ? 'custom' : (THEME_IDS.includes(b.pageTheme) ? b.pageTheme : DEFAULT_THEME_ID),
    customTheme: {},
    primaryColor: LP.sanitizeDoc({ theme: { primary: b.primaryColor } }).doc.theme.primary,
    secondaryColor: LP.sanitizeDoc({ theme: { secondary: b.secondaryColor } }).doc.theme.secondary,
    preferredImages: ['abstract', 'people', 'product', 'nature', 'tech'].includes(b.preferredImages) ? b.preferredImages : 'abstract',
    ctaUrl: LP.safeLink(clean(b.ctaUrl, 2000)),
    sections
  };
  if (inputs.pageTheme === 'custom') {
    let custom = {};
    try { custom = JSON.parse(String(b.customTheme || '{}')); } catch (_) { custom = {}; }
    const allowed = { mode: ['light','dark'], font: ['classic','modern','elegant','friendly','techy','playful','editorial'], radius: ['square','soft','round','pill'], spacing: ['compact','normal','airy'], hero: ['split','centered','immersive'], cards: ['flat','bordered','shadow','glass'], buttons: ['solid','outline','gradient'] };
    for (const [key, values] of Object.entries(allowed)) inputs.customTheme[key] = values.includes(custom[key]) ? custom[key] : ({ mode:'light', font:'modern', radius:'soft', spacing:'normal', hero:'split', cards:'shadow', buttons:'solid' })[key];
  }
  const problems = [];
  if (!inputs.targetAudience) problems.push('Target audience is required');
  if (!inputs.primaryProblem) problems.push('Primary problem is required');
  if (!PURPOSES[inputs.pagePurpose]) problems.push('Choose a page purpose');
  if (clean(b.ctaUrl, 2000) && !inputs.ctaUrl) problems.push('If provided, the CTA link must start with http://, https://, mailto: or tel:');
  if (!sections.length) problems.push('Pick at least one section');
  if (problems.length) return res.status(400).json({ error: problems.join('. ') });

  const id = store.newId();
  const images = [];
  for (const f of req.files || []) images.push((await saveUpload(id, f, { imagesOnly: true })).url);

  const { content, generatedBy, note } = await generateContent(inputs);
  const doc = LP.sanitizeDoc(buildDoc(inputs, content, images)).doc;
  const tok = store.newToken();
  const now = new Date().toISOString();
  await store.write({ id, tokenHash: store.hashToken(tok), createdAt: now, updatedAt: now, publishedAt: null, generatedBy, inputs, doc, published: null });
  res.json({ id, token: tok, editUrl: `/edit/${id}`, liveUrl: `${origin(req)}/p/${id}`, generatedBy, note: note || null });
}));

// ---------- 1b. regenerate a single section ----------
app.post('/api/pages/:id/regenerate', limit('gen', 10, 3600e3), wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  const section = String((req.body && req.body.section) || '').trim();
  // Map from API key → document section type
  const apiToType = {
    headline: 'hero',
    about: 'about',
    features: 'services',
    products: 'products',
    testimonials: 'testimonials',
    cta: 'cta',
    video: 'video',
    contact: 'contact'
  };
  if (!apiToType[section]) {
    return res.status(400).json({ error: 'Unsupported section. Allowed: ' + Object.keys(apiToType).join(', ') });
  }

  const doc = page.doc || {};
  const sections = doc.sections || [];

  // Helper: find section data by type
  const findSec = (type) => sections.find((s) => s.type === type);

  // Rebuild a content-shaped object from the current document so the LLM has context
  const hero = findSec('hero');
  const about = findSec('about');
  const services = findSec('services');
  const products = findSec('products');
  const testimonials = findSec('testimonials');
  const video = findSec('video');
  const contact = findSec('contact');
  const cta = findSec('cta');
  const footer = findSec('footer');

  const currentContent = {
    brandName: doc.brand || '',
    headline: (hero && hero.data && hero.data.headline) || '',
    subtitle: (hero && hero.data && hero.data.subtitle) || '',
    ctaLabel: doc.ctaLabel || '',
    ctaSecondary: (hero && hero.data && hero.data.ctaSecondary) || '',
    about: about && about.data ? { title: about.data.title, paragraphs: about.data.paragraphs || [] } : {},
    features: services && services.data ? { title: services.data.title, subtitle: services.data.subtitle, items: services.data.items || [] } : {},
    products: products && products.data ? { title: products.data.title, subtitle: products.data.subtitle, items: products.data.items || [] } : {},
    testimonials: testimonials && testimonials.data ? { title: testimonials.data.title, subtitle: testimonials.data.subtitle, items: testimonials.data.items || [] } : {},
    video: video && video.data ? { title: video.data.title, subtitle: video.data.subtitle } : {},
    contact: contact && contact.data ? { title: contact.data.title, subtitle: contact.data.subtitle } : {},
    cta: cta && cta.data ? { title: cta.data.title, subtitle: cta.data.subtitle } : {},
    footer: footer && footer.data ? { tagline: footer.data.tagline } : {},
    seo: doc.seo || {}
  };

  const inputs = { ...(page.inputs || {}), tone: (page.inputs && page.inputs.tone) || 'professional' };
  const { content, generatedBy, note } = await regenerateSection(inputs, currentContent, section);

  // Write regenerated content back into the correct section(s)
  if (section === 'headline' && hero) {
    hero.data.headline = content.headline;
    hero.data.subtitle = content.subtitle;
    hero.data.ctaSecondary = content.ctaSecondary;
    doc.ctaLabel = content.ctaLabel;
  } else if (section === 'about' && about) {
    about.data.title = content.about.title;
    about.data.paragraphs = content.about.paragraphs;
  } else if (section === 'features' && services) {
    services.data.title = content.features.title;
    services.data.subtitle = content.features.subtitle;
    services.data.items = content.features.items;
  } else if (section === 'products' && products) {
    products.data.title = content.products.title;
    products.data.subtitle = content.products.subtitle;
    // Preserve existing media on products where possible
    const oldItems = products.data.items || [];
    products.data.items = (content.products.items || []).map((item, i) => ({
      ...item,
      media: (oldItems[i] && oldItems[i].media) || { kind: 'none', url: '' }
    }));
    products.data.sample = true;
  } else if (section === 'testimonials' && testimonials) {
    testimonials.data.title = content.testimonials.title;
    testimonials.data.subtitle = content.testimonials.subtitle;
    testimonials.data.items = content.testimonials.items;
    testimonials.data.sample = true;
  } else if (section === 'cta' && cta) {
    cta.data.title = content.cta.title;
    cta.data.subtitle = content.cta.subtitle;
  } else if (section === 'video' && video) {
    video.data.title = content.video.title;
    video.data.subtitle = content.video.subtitle;
  } else if (section === 'contact' && contact) {
    contact.data.title = content.contact.title;
    contact.data.subtitle = content.contact.subtitle;
  }

  page.doc = LP.sanitizeDoc(doc).doc;
  page.updatedAt = new Date().toISOString();
  page.generatedBy = generatedBy;
  await store.write(page);

  res.json({ ...view(page), note: note || null, regenerated: section });
}));

// ---------- 1c. change the page from a prompt ("Ask AI") ----------
// The model returns a validated change set (design settings, section order, content edits) - never raw HTML/CSS.
const HISTORY_MAX = 10;
app.post('/api/pages/:id/modify', limit('mod', 30, 3600e3), wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, 1000);
  if (prompt.length < 3) return res.status(400).json({ error: 'Describe what you want to change.' });
  if (!hasAI()) return res.status(503).json({ error: 'Ask AI needs an AI key. Add GROQ_API_KEY or ANTHROPIC_API_KEY to .env and restart the server.' });

  let changes;
  try { changes = await requestChanges(page.inputs || {}, page.doc, prompt); }
  catch (err) {
    console.error('[modify]', err.message);
    return res.status(502).json({ error: 'The AI request failed. Please try again in a moment.' });
  }
  const summary = String(changes.summary || '').trim().slice(0, 300);
  const question = String(changes.question || '').trim().slice(0, 300);

  const result = applyChanges(page.doc, changes);
  if (!result.applied.length) {
    return res.json({ ...view(page), summary, question, applied: [], skipped: result.skipped, changed: false });
  }
  page.history = (Array.isArray(page.history) ? page.history : []).concat({ doc: page.doc, at: new Date().toISOString(), prompt: prompt.slice(0, 200) }).slice(-HISTORY_MAX);
  page.doc = result.doc;
  page.updatedAt = new Date().toISOString();
  await store.write(page);
  res.json({ ...view(page), summary, question: '', applied: result.applied, skipped: result.skipped, changed: true });
}));

app.post('/api/pages/:id/undo', wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  if (!Array.isArray(page.history) || !page.history.length) return res.status(409).json({ error: 'Nothing to undo.' });
  const prev = page.history.pop();
  page.doc = LP.sanitizeDoc(prev.doc).doc;
  page.updatedAt = new Date().toISOString();
  await store.write(page);
  res.json({ ...view(page), undone: prev.prompt || '' });
}));

// ---------- 2. read / edit / publish ----------
app.get('/api/pages/:id', wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  res.json(view(page));
}));

app.put('/api/pages/:id', limit('save', 120, 60e3), wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  const { doc, errors } = LP.sanitizeDoc(req.body && req.body.doc);
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  if (!doc.sections.length) return res.status(400).json({ error: 'A page needs at least one section' });
  page.doc = doc;
  page.updatedAt = new Date().toISOString();
  await store.write(page);
  res.json(view(page));
}));

app.post('/api/pages/:id/publish', wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  page.published = JSON.parse(JSON.stringify(page.doc));   // live page = snapshot, so drafts never leak
  page.publishedAt = new Date().toISOString();
  await store.write(page);
  res.json({ ...view(page), liveUrl: `${origin(req)}/p/${page.id}` });
}));

app.post('/api/pages/:id/unpublish', wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  page.published = null; page.publishedAt = null;
  await store.write(page);
  res.json(view(page));
}));

app.delete('/api/pages/:id', wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  await fs.promises.rm(path.join(store.DATA, 'pages', page.id + '.json'), { force: true });
  await fs.promises.rm(path.join(store.UPLOADS, page.id), { recursive: true, force: true });
  res.json({ ok: true });
}));

app.post('/api/pages/:id/upload', limit('up', 40, 3600e3), upload.single('file'), wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  res.json(await saveUpload(page.id, req.file, { imagesOnly: false }));
}));

// ---------- 3. leads from the contact form ----------
app.post('/api/pages/:id/contact', limit('lead', 5, 600e3), wrap(async (req, res) => {
  const page = await store.read(req.params.id);
  if (!page || !page.published || !page.published.sections.some((s) => s.type === 'contact')) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });                       // honeypot: bots fill it
  const name = String(b.name || '').trim().slice(0, 100);
  const email = String(b.email || '').trim().slice(0, 200);
  const message = String(b.message || '').trim().slice(0, 2000);
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter your name, a valid email and a message.' });
  await store.addLead(page.id, { name, email, message, at: new Date().toISOString() });
  res.json({ ok: true });
}));

app.get('/api/pages/:id/leads', wrap(async (req, res) => {
  const page = await owned(req, res); if (!page) return;
  res.json({ leads: await store.readLeads(page.id) });
}));

// ---------- 4. the dynamic public URL ----------
const PAGE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' https: data:", "media-src 'self' https:",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com", "connect-src 'self'",
  "form-action 'self'", "base-uri 'none'", "object-src 'none'"
].join('; ');

app.get('/p/:id', wrap(async (req, res) => {
  const page = await store.read(req.params.id);
  if (!page || !page.published) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;text-align:center;padding:4rem"><h1>Page not found</h1><p>This page does not exist or has not been published yet.</p>');
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(LP.renderDocument(page.published, { id: page.id, baseUrl: origin(req) }));
}));

app.get('/edit/:id', (req, res) => {
  if (!store.validId(req.params.id)) return res.status(404).send('Not found');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 25 MB)' : err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Page too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON' });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    const provider = process.env.GROQ_API_KEY ? 'Groq AI ON' : process.env.ANTHROPIC_API_KEY ? 'Anthropic AI ON' : 'no API key: template generation';
    console.log(`LandingAI running on http://localhost:${port}  (${provider})`);
  });
}
module.exports = app;