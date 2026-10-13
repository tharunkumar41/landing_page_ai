/* Inline editor. The page is a JSON document; the canvas is rendered from it by LP.render()
   (the same function the server uses for the published page). Editing mutates the JSON, autosaves it,
   and "Publish" snapshots it to the public URL. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const id = location.pathname.split('/').filter(Boolean).pop();
  const KEY = 'lp_token_' + id;
  let token = null, page = null, doc = null;
  let mode = 'edit', dirty = false, saving = false, saveTimer = null, mediaPath = null, iconPath = null;

  // ---------- small utils ----------
  function toast(msg, isErr) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 5000 : 2500);
  }
  async function api(method, url, body, form) {
    const opt = { method, headers: { 'x-edit-token': token } };
    if (form) opt.body = form; else if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(url, opt);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed (' + res.status + ')'), { status: res.status });
    return data;
  }
  const show = (el, on) => $(el).classList.toggle('hidden', !on);

  // ---------- path helpers: "page.brand", "<sectionId>.items.2.title" ----------
  function secById(sid) { return doc.sections.find((s) => s.id === sid); }
  function resolve(path) {
    const parts = path.split('.');
    let obj = parts[0] === 'page' ? doc : (secById(parts[0]) || {}).data;
    if (!obj) return null;
    for (let i = 1; i < parts.length - 1; i++) { obj = obj[parts[i]]; if (obj == null) return null; }
    return { obj, key: parts[parts.length - 1] };
  }
  const getAt = (p) => { const r = resolve(p); return r ? r.obj[r.key] : undefined; };
  function setAt(p, v) { const r = resolve(p); if (r) r.obj[r.key] = v; }

  // ---------- boot ----------
  async function boot() {
    const m = location.hash.match(/t=([^&]+)/);
    if (m) { token = decodeURIComponent(m[1]); try { localStorage.setItem(KEY, token); } catch (e) {} history.replaceState(null, '', location.pathname); }
    else { try { token = localStorage.getItem(KEY); } catch (e) {} }
    if (!token) return gate();
    try {
      page = await api('GET', '/api/pages/' + id);
    } catch (e) {
      if (e.status === 401 || e.status === 404) return gate(e.status === 404 ? 'This page does not exist.' : 'That edit key is not valid for this page.');
      return gate('Could not load the page: ' + e.message);
    }
    doc = page.doc;
    show('gate', false); show('app', true);
    document.title = (doc.brand || 'Page') + ' — Editor';
    let notice = null; try { notice = sessionStorage.getItem('lp_notice'); sessionStorage.removeItem('lp_notice'); } catch (e) {}
    if (notice) { $('notice-text').textContent = notice; show('notice', true); }
    render(); syncSettings(); updateStatus(); updateUndo();
  }
  function gate(msg) {
    show('app', false); show('gate', true);
    if (msg) $('gate-msg').textContent = msg;
  }
  $('gate-go').onclick = () => {
    const t = $('gate-token').value.trim(); if (!t) return;
    try { localStorage.setItem(KEY, t); } catch (e) {}
    token = t; boot();
  };
  $('notice-x').onclick = () => show('notice', false);

  // ---------- rendering ----------
  function render() {
    const y = window.scrollY;
    const edit = mode === 'edit';
    const c = $('canvas');
    c.classList.toggle('editing', edit);
    const fl = document.getElementById('lp-fonts'), fh = LP.fontsHref(doc);
    if (fl && fl.getAttribute('href') !== fh) fl.setAttribute('href', fh);
    c.innerHTML = `<div class="${LP.rootClass(doc)}" style="${LP.themeStyle(doc)}">${LP.render(doc, { edit })}</div>`;
    if (edit) decorate(c);
    window.scrollTo(0, y);
  }

  function decorate(c) {
    // editable text
    c.querySelectorAll('[data-edit]').forEach((el) => {
      el.contentEditable = 'plaintext-only';
      if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
      el.spellcheck = true;
    });
    // section tools
    c.querySelectorAll('[data-sec]').forEach((el) => {
      const sec = secById(el.dataset.sec); if (!sec) return;
      const idx = doc.sections.indexOf(sec);
      const pinTop = sec.type === 'header', pinBottom = sec.type === 'footer';
      const upDisabled = pinTop || pinBottom || idx === 0 || doc.sections[idx - 1].type === 'header';
      const downDisabled = pinTop || pinBottom || idx === doc.sections.length - 1 || doc.sections[idx + 1].type === 'footer';
      const tools = document.createElement('div');
      tools.className = 'sec-tools'; tools.contentEditable = 'false';
      const canRegen = ['hero', 'about', 'services', 'products', 'testimonials', 'cta', 'video', 'contact'].includes(sec.type);
      tools.innerHTML = `<span>${LP.esc(LP.SECTION_LABELS[sec.type])}</span>
        ${canRegen ? `<button type="button" data-regen-sec title="Regenerate this section with AI" aria-label="Regenerate section">✨</button>` : ''}
        <button type="button" data-move="-1" title="Move up" aria-label="Move section up" ${upDisabled ? 'disabled' : ''}>↑</button>
        <button type="button" data-move="1" title="Move down" aria-label="Move section down" ${downDisabled ? 'disabled' : ''}>↓</button>
        <button type="button" data-remove-sec title="Delete section" aria-label="Delete section">🗑</button>`;
      el.prepend(tools);
    });
    // item delete / add
    c.querySelectorAll('[data-item]').forEach((el) => {
      const listPath = el.dataset.item.replace(/\.\d+$/, '');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'item-del'; btn.textContent = '×'; btn.title = 'Remove this item'; btn.setAttribute('aria-label', 'Remove this item');
      btn.dataset.delItem = el.dataset.item;
      if ((getAt(listPath) || []).length <= 1) btn.disabled = true;
      el.appendChild(btn);
    });
    c.querySelectorAll('[data-list]').forEach((el) => {
      const sec = secById(el.dataset.list.split('.')[0]);
      const n = (getAt(el.dataset.list) || []).length;
      if (n >= 12) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'item-add'; b.dataset.addItem = el.dataset.list;
      b.textContent = '+ Add ' + (sec.type === 'services' ? 'feature' : sec.type === 'products' ? 'product' : 'testimonial');
      el.insertAdjacentElement('afterend', b);
    });
  }

  // ---------- change tracking & autosave ----------
  function markDirty() {
    dirty = true; $('save-state').textContent = 'Unsaved…';
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 900);
  }
  async function save() {
    clearTimeout(saveTimer);
    if (!dirty) return true;
    if (saving) { saveTimer = setTimeout(save, 300); return false; }
    saving = true; $('save-state').textContent = 'Saving…';
    const snapshot = JSON.stringify(doc);
    try {
      const r = await api('PUT', '/api/pages/' + id, { doc });
      page.updatedAt = r.updatedAt; page.hasUnpublished = r.hasUnpublished; page.live = r.live;
      if (JSON.stringify(doc) === snapshot) dirty = false; else saveTimer = setTimeout(save, 300);
      $('save-state').textContent = dirty ? 'Unsaved…' : 'Saved ✓';
      updateStatus(); return true;
    } catch (e) {
      $('save-state').textContent = 'Not saved'; toast('Could not save: ' + e.message, true); return false;
    } finally { saving = false; }
  }
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) save(); });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });

  function updateStatus() {
    const chip = $('status-chip');
    chip.className = 'chip';
    if (!page.live) chip.textContent = 'Draft';
    else if (page.hasUnpublished || dirty) { chip.textContent = 'Live · unpublished changes'; chip.classList.add('warn'); }
    else { chip.textContent = 'Live'; chip.classList.add('live'); }
    $('publish-btn').textContent = page.live ? 'Publish changes' : 'Publish';
    const a = $('open-live'); a.classList.toggle('hidden', !page.live); a.href = '/p/' + id;
  }

  // ---------- canvas events (delegated, so they survive re-renders) ----------
  const canvas = $('canvas');

  canvas.addEventListener('input', (e) => {
    const el = e.target.closest('[data-edit]'); if (!el) return;
    const p = el.dataset.edit, text = el.textContent;
    setAt(p, text);
    // keep other copies of the same value (brand, CTA label) in sync without re-rendering (keeps the caret)
    canvas.querySelectorAll('[data-edit="' + p + '"]').forEach((o) => { if (o !== el) o.textContent = text; });
    if (p === 'page.brand') document.title = text + ' — Editor';
    markDirty();
  });
  canvas.addEventListener('paste', (e) => {
    if (!e.target.closest('[data-edit]')) return;
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n+\s*/g, ' ');
    document.execCommand('insertText', false, t);
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.target.closest('[data-edit]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  canvas.addEventListener('submit', (e) => e.preventDefault());       // contact form is inert while editing
  canvas.addEventListener('click', (e) => {
    if (mode !== 'edit') { if (e.target.closest('form')) return; return; }
    const t = e.target;
    if (t.closest('a')) e.preventDefault();                           // don't navigate while editing
    let b;
    if ((b = t.closest('[data-move]'))) return moveSection(b.closest('[data-sec]').dataset.sec, +b.dataset.move);
    if ((b = t.closest('[data-remove-sec]'))) return removeSection(b.closest('[data-sec]').dataset.sec);
    if ((b = t.closest('[data-regen-sec]'))) return regenerateSection(b.closest('[data-sec]').dataset.sec);
    if ((b = t.closest('[data-del-item]'))) return removeItem(b.dataset.delItem);
    if ((b = t.closest('[data-add-item]'))) return addItem(b.dataset.addItem);
    if ((b = t.closest('[data-sample-ok]'))) { secById(b.dataset.sampleOk).data.sample = false; markDirty(); return render(); }
    if ((b = t.closest('[data-icon]'))) return openIcon(b);
    if ((b = t.closest('[data-media]'))) return openMedia(b.dataset.media);
  });
  canvas.addEventListener('click', (e) => { if (mode !== 'edit' && e.target.closest('form')) e.preventDefault(); });

  // ---------- AI section regeneration ----------
  async function regenerateSection(sid) {
    const sec = secById(sid);
    if (!sec) return;

    // Map internal section type → API section key
    const map = {
      hero: 'headline',
      about: 'about',
      services: 'features',
      products: 'products',
      testimonials: 'testimonials',
      cta: 'cta',
      video: 'video',
      contact: 'contact'
    };
    const apiSection = map[sec.type];
    if (!apiSection) return toast('This section cannot be regenerated.', true);

    if (!confirm(`Regenerate the "${LP.SECTION_LABELS[sec.type]}" section with AI?\n\nCurrent content in this section will be replaced.`)) return;

    const btn = document.querySelector(`[data-sec="${sid}"] [data-regen-sec]`);
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
      // Save any pending edits first
      if (dirty) await save();
      const data = await api('POST', '/api/pages/' + id + '/regenerate', { section: apiSection });
      page = data;
      doc = data.doc;
      dirty = false;
      render();
      updateStatus();
      toast(data.generatedBy === 'ai' ? 'Section regenerated with AI' : 'Section regenerated (template)');
    } catch (e) {
      toast(e.message || 'Regeneration failed', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨'; }
    }
  }

  // ---------- structure: sections & items ----------
  function moveSection(sid, dir) {
    const i = doc.sections.findIndex((s) => s.id === sid), j = i + dir;
    if (j < 0 || j >= doc.sections.length) return;
    const a = doc.sections[i], b = doc.sections[j];
    if (['header', 'footer'].includes(b.type) || ['header', 'footer'].includes(a.type)) return;
    doc.sections[i] = b; doc.sections[j] = a;
    markDirty(); render(); scrollToSec(sid);
  }
  function removeSection(sid) {
    const s = secById(sid);
    if (doc.sections.length <= 1) return toast('A page needs at least one section.', true);
    if (!confirm('Delete the "' + LP.SECTION_LABELS[s.type] + '" section?')) return;
    doc.sections = doc.sections.filter((x) => x.id !== sid);
    markDirty(); render();
  }
  function scrollToSec(sid) {
    const el = canvas.querySelector('[data-sec="' + sid + '"]');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  }
  function removeItem(path) {
    const m = path.match(/^(.+)\.(\d+)$/), list = getAt(m[1]);
    if (!list || list.length <= 1) return;
    list.splice(+m[2], 1); markDirty(); render();
  }
  function addItem(listPath) {
    const sec = secById(listPath.split('.')[0]), list = getAt(listPath);
    if (!list || list.length >= 12) return;
    list.push(LP.newItem(sec.type)); markDirty(); render();
  }

  // add-section menu
  $('add-section-btn').onclick = (e) => {
    e.stopPropagation();
    const menu = $('add-section-menu');
    const have = new Set(doc.sections.map((s) => s.type));
    const missing = LP.SECTION_ORDER.filter((t) => !have.has(t));
    menu.innerHTML = '';
    if (!missing.length) menu.innerHTML = '<div class="empty">All sections are already on the page.</div>';
    missing.forEach((t) => {
      const b = document.createElement('button'); b.textContent = LP.SECTION_LABELS[t];
      b.onclick = () => { addSection(t); menu.classList.add('hidden'); };
      menu.appendChild(b);
    });
    menu.classList.toggle('hidden');
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) $('add-section-menu').classList.add('hidden');
    if (!e.target.closest('#icon-pop') && !e.target.closest('[data-icon]')) $('icon-pop').classList.add('hidden');
  });
  function addSection(type) {
    const sec = LP.defaultSection(type, doc);
    const order = LP.SECTION_ORDER;
    // insert in canonical position relative to what exists
    let at = doc.sections.findIndex((s) => order.indexOf(s.type) > order.indexOf(type));
    if (at === -1) at = doc.sections.length;
    doc.sections.splice(at, 0, sec);
    markDirty(); render(); scrollToSec(sec.id);
  }

  // ---------- icon picker ----------
  const EMOJI = '⚡ 🎯 🔒 📈 🤝 🔄 ✨ 🚀 💡 🔧 🛠️ 📦 🛒 💳 🏆 ⭐ ❤️ 🌱 🌍 ☀️ 🔥 💬 📞 ✉️ 📅 ⏱️ 🧠 📊 🎓 🏠 🍎 🥗 🍳 💪 🧘 🎨 📷 🎵 🎮 💻 📱 🔔 🔍 ✅ 🛡️ 🤖 🧩 🎁 🚚 🌟 👍 🙌 📚 🧾 💰 🏥 🚗 ✈️ 🏖️ 🐾'.split(' ');
  const grid = $('emoji-grid');
  EMOJI.forEach((em) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = em; b.onclick = () => setIcon(em); grid.appendChild(b); });
  function openIcon(el) {
    iconPath = el.dataset.icon;
    const pop = $('icon-pop'), r = el.getBoundingClientRect();
    pop.classList.remove('hidden');
    pop.style.left = Math.min(r.left + window.scrollX, window.innerWidth - 300) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
    $('emoji-custom').value = '';
  }
  function setIcon(v) { if (!v || !iconPath) return; setAt(iconPath, v.slice(0, 8)); $('icon-pop').classList.add('hidden'); markDirty(); render(); }
  $('emoji-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') setIcon(e.target.value.trim()); });
  $('emoji-custom').addEventListener('change', (e) => setIcon(e.target.value.trim()));

  // ---------- media (image / video) ----------
  function isVideoSection(path) { const s = secById(path.split('.')[0]); return s && s.type === 'video'; }
  function getMedia(path) {
    if (isVideoSection(path)) { const s = secById(path.split('.')[0]); return { kind: s.data.url ? 'video' : 'none', url: s.data.url || '' }; }
    return getAt(path) || { kind: 'none', url: '' };
  }
  function setMedia(path, m) {
    if (isVideoSection(path)) {
      if (m.kind === 'image') return toast('The video section takes a YouTube, Vimeo or MP4 link.', true), false;
      secById(path.split('.')[0]).data.url = m.url || '';
    } else setAt(path, m);
    markDirty(); render(); return true;
  }
  function openMedia(path) {
    mediaPath = path;
    const cur = getMedia(path);
    $('media-url').value = cur.url && !cur.url.startsWith('/uploads/') ? cur.url : '';
    $('media-alt').value = cur.alt || '';
    $('media-file').value = ''; $('media-status').textContent = '';
    show('media-modal', true);
  }
  const closeMedia = () => show('media-modal', false);
  $('media-cancel').onclick = closeMedia;
  $('media-remove').onclick = () => { setMedia(mediaPath, { kind: 'none', url: '' }); closeMedia(); };
  $('media-use-url').onclick = () => {
    const url = LP.safeUrl($('media-url').value);
    if (!url) { $('media-status').textContent = 'Enter a valid http(s) link.'; return; }
    if (setMedia(mediaPath, { kind: LP.guessKind(url), url, alt: $('media-alt').value.trim() })) closeMedia();
  };
  $('media-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 25 * 1024 * 1024) { $('media-status').textContent = 'File is over 25 MB.'; return; }
    $('media-status').textContent = 'Uploading…';
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api('POST', '/api/pages/' + id + '/upload', null, fd);
      if (setMedia(mediaPath, { kind: r.kind, url: r.url, alt: $('media-alt').value.trim() })) closeMedia();
      else $('media-status').textContent = 'Not added.';
    } catch (err) { $('media-status').textContent = err.message; }
  };

  // ---------- mode toggle ----------
  function setMode(m) {
    mode = m;
    $('mode-edit').classList.toggle('on', m === 'edit'); $('mode-preview').classList.toggle('on', m === 'preview');
    $('add-section-btn').disabled = m !== 'edit';
    render();
  }
  $('mode-edit').onclick = () => setMode('edit');
  $('mode-preview').onclick = () => setMode('preview');

  // ---------- Ask AI: change the whole look / structure / copy from a prompt ----------
  const AI_EXAMPLES = ['Make it dark and premium', 'Playful, bright and rounded', 'Clean minimal look, centered hero', 'Add a testimonials section', 'Move testimonials above features', 'Rewrite the copy for students'];
  AI_EXAMPLES.forEach((t) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t;
    b.onclick = () => { $('ai-prompt').value = t; $('ai-prompt').focus(); };
    $('ai-chips').appendChild(b);
  });
  function updateUndo() { $('ai-undo').disabled = !(page && page.canUndo); }
  function openAI() { show('settings', false); show('ai-panel', true); updateUndo(); $('ai-prompt').focus(); }
  $('ai-btn').onclick = openAI;
  $('ai-x').onclick = () => show('ai-panel', false);
  $('ai-prompt').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAI(); } });

  function showAIResult(data) {
    const box = $('ai-result'); box.textContent = ''; box.classList.remove('hidden');
    const add = (tag, txt, cls) => { const el = document.createElement(tag); el.textContent = txt; if (cls) el.className = cls; box.appendChild(el); return el; };
    if (data.error) return add('p', data.error, 'err');
    if (data.summary) add('p', data.summary);
    if (data.question) add('p', data.question);
    const list = (items, cls) => { const ul = add('ul', '', cls); items.forEach((a) => { const li = document.createElement('li'); li.textContent = a; ul.appendChild(li); }); };
    if (data.applied && data.applied.length) { add('strong', 'Changed'); list(data.applied); }
    if (data.skipped && data.skipped.length) { add('strong', 'Skipped', 'skipped'); list(data.skipped, 'skipped'); }
    if (!data.changed && !data.question && !data.summary) add('p', 'The AI had no changes to make. Try describing it differently.');
  }
  async function runAI() {
    const prompt = $('ai-prompt').value.trim();
    if (prompt.length < 3) return toast('Describe what you want to change.', true);
    const btn = $('ai-go'); btn.disabled = true; btn.textContent = 'Working…';
    try {
      if (dirty) await save();
      const data = await api('POST', '/api/pages/' + id + '/modify', { prompt });
      page = data;
      if (data.changed) { doc = data.doc; dirty = false; render(); syncSettings(); updateStatus(); $('ai-prompt').value = ''; }
      updateUndo(); showAIResult(data);
    } catch (e) { showAIResult({ error: e.message }); }
    finally { btn.disabled = false; btn.textContent = 'Apply with AI'; }
  }
  $('ai-go').onclick = runAI;
  $('ai-undo').onclick = async () => {
    if (!confirm('Undo the last AI change? Anything you edited after it will also be lost.')) return;
    clearTimeout(saveTimer); dirty = false;
    try {
      const data = await api('POST', '/api/pages/' + id + '/undo');
      page = data; doc = data.doc; render(); syncSettings(); updateStatus(); updateUndo();
      showAIResult({ summary: 'Undid the last AI change.', applied: [], skipped: [], changed: true });
      toast('Undone');
    } catch (e) { toast(e.message, true); }
  };

  // ---------- settings drawer ----------
  function syncSettings() {
    $('s-ctaLabel').value = doc.ctaLabel; $('s-ctaUrl').value = doc.ctaUrl; $('s-brand').value = doc.brand;
    $('s-primary').value = doc.theme.primary; $('s-secondary').value = doc.theme.secondary; $('s-style').value = doc.imageStyle;
    $('s-seoTitle').value = doc.seo.title; $('s-seoDesc').value = doc.seo.description;
    $('s-privacy').value = doc.privacyUrl || ''; $('s-terms').value = doc.termsUrl || '';
  }
  $('settings-btn').onclick = () => { syncSettings(); show('ai-panel', false); show('settings', true); };
  $('settings-x').onclick = () => show('settings', false);
  function bind(elId, apply, rerender) {
    $(elId).addEventListener('input', (e) => { apply(e.target.value); markDirty(); if (rerender) render(); });
  }
  bind('s-ctaLabel', (v) => (doc.ctaLabel = v), true);
  bind('s-brand', (v) => (doc.brand = v), true);
  bind('s-primary', (v) => (doc.theme.primary = v), false);
  bind('s-secondary', (v) => (doc.theme.secondary = v), false);
  ['s-primary', 's-secondary'].forEach((i) => $(i).addEventListener('input', () => { const r = canvas.querySelector('.lp-root'); if (r) r.setAttribute('style', LP.themeStyle(doc)); }));
  bind('s-style', (v) => (doc.imageStyle = v), true);
  bind('s-seoTitle', (v) => (doc.seo.title = v), false);
  bind('s-seoDesc', (v) => (doc.seo.description = v), false);
  function linkField(elId, key, errId) {
    $(elId).addEventListener('input', (e) => {
      const v = e.target.value.trim(), ok = !v || LP.safeLink(v);
      if (errId) $(errId).textContent = ok ? '' : 'Use a link starting with http://, https://, mailto: or tel:';
      if (ok) { doc[key] = v; markDirty(); render(); }
    });
  }
  linkField('s-ctaUrl', 'ctaUrl', 's-ctaUrl-err'); linkField('s-privacy', 'privacyUrl'); linkField('s-terms', 'termsUrl');
  $('delete-page').onclick = async () => {
    if (!confirm('Permanently delete this page, its uploads and its public link?')) return;
    try { await api('DELETE', '/api/pages/' + id); dirty = false; try { localStorage.removeItem(KEY); } catch (e) {} location.href = '/'; }
    catch (e) { toast(e.message, true); }
  };

  // ---------- publish ----------
  async function publish() {
    if (!(await save())) return;
    const sample = doc.sections.filter((s) => s.data && s.data.sample).map((s) => LP.SECTION_LABELS[s.type]);
    if (sample.length && !confirm('These sections still contain AI-generated sample content:\n\n• ' + sample.join('\n• ') + '\n\nPublish anyway? (Use "I\'ve replaced it" on the section banner once you have real content.)')) return;
    if (!doc.ctaUrl && !confirm('The main button has no link yet. Publish anyway?')) return;
    $('publish-btn').disabled = true;
    try {
      const r = await api('POST', '/api/pages/' + id + '/publish');
      page.live = true; page.hasUnpublished = false; page.publishedAt = r.publishedAt; updateStatus();
      $('pub-url').value = r.liveUrl; $('pub-open').href = '/p/' + id;
      show('publish-modal', true);
    } catch (e) { toast(e.message, true); } finally { $('publish-btn').disabled = false; }
  }
  $('publish-btn').onclick = publish;
  $('pub-close').onclick = () => show('publish-modal', false);
  $('pub-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('pub-url').value); toast('Link copied'); } catch (e) { $('pub-url').select(); toast('Press Ctrl+C to copy'); }
  };
  $('pub-unpublish').onclick = async () => {
    try { await api('POST', '/api/pages/' + id + '/unpublish'); page.live = false; updateStatus(); show('publish-modal', false); toast('Page unpublished'); }
    catch (e) { toast(e.message, true); }
  };

  // ---------- leads ----------
  $('leads-btn').onclick = async () => {
    const body = $('leads-body'); body.textContent = 'Loading…'; show('leads-modal', true);
    try {
      const { leads } = await api('GET', '/api/pages/' + id + '/leads');
      if (!leads.length) { body.textContent = page.live ? 'No messages yet.' : 'No messages yet. The contact form only works once the page is published.'; return; }
      const t = document.createElement('table'); t.className = 'leads-table';
      t.innerHTML = '<thead><tr><th>When</th><th>Name</th><th>Email</th><th>Message</th></tr></thead>';
      const tb = document.createElement('tbody');
      leads.forEach((l) => {
        const tr = document.createElement('tr');
        [new Date(l.at).toLocaleString(), l.name, l.email, l.message].forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
        tb.appendChild(tr);
      });
      t.appendChild(tb); body.textContent = ''; body.appendChild(t);
    } catch (e) { body.textContent = e.message; }
  };
  $('leads-close').onclick = () => show('leads-modal', false);

  // close modals with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['media-modal', 'publish-modal', 'leads-modal', 'settings'].forEach((m) => show(m, false));
    $('icon-pop').classList.add('hidden');
  });

  boot();
})();