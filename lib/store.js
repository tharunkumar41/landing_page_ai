'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PAGES = path.join(DATA, 'pages');
const LEADS = path.join(DATA, 'leads');
const UPLOADS = path.join(DATA, 'uploads');
[PAGES, LEADS, UPLOADS].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const validId = (id) => typeof id === 'string' && /^[a-z0-9]{8,24}$/.test(id);
const newId = () => crypto.randomBytes(6).toString('hex'); // 12 hex chars
const newToken = () => crypto.randomBytes(24).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t || '')).digest('hex');

async function read(id) {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(path.join(PAGES, id + '.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// Serialise writes per page so two quick saves can't interleave.
const queues = new Map();
function write(page) {
  const prev = queues.get(page.id) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const file = path.join(PAGES, page.id + '.json');
    const tmp = file + '.' + process.pid + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(page));
    await fsp.rename(tmp, file);
  });
  queues.set(page.id, next);
  return next;
}

function authorised(page, token) {
  if (!page || !token) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(page.tokenHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function addLead(id, lead) {
  await fsp.appendFile(path.join(LEADS, id + '.jsonl'), JSON.stringify(lead) + '\n');
}
async function readLeads(id) {
  try {
    const raw = await fsp.readFile(path.join(LEADS, id + '.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

module.exports = { DATA, UPLOADS, validId, newId, newToken, hashToken, read, write, authorised, addLead, readLeads };
