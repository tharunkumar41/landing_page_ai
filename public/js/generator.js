(function () {
  const $ = (id) => document.getElementById(id);
  const form = $('generator-form'), btn = $('generate-btn'), err = $('form-error');
  const formStep = $('form-step'), themeStep = $('theme-step'), continueBtn = $('continue-btn'), backBtn = $('back-btn'), customPanel = $('custom-theme-panel');

  // ---- Theme catalogue (mirrors lib/themes.js; kept client-side for previews) ----
  const THEMES = [
    { id: 'modern-saas', name: 'Modern SaaS', description: 'Clean product layout with soft cards and a split hero — ideal for software and tools.', preview: { bg: '#f8fafc', surface: '#ffffff', accent: '#6366f1', accent2: '#ec4899', ink: '#0f172a' } },
    { id: 'minimalist', name: 'Minimalist', description: 'Sparse, typography-first design with square edges and outline buttons.', preview: { bg: '#ffffff', surface: '#fafafa', accent: '#171717', accent2: '#525252', ink: '#111111' } },
    { id: 'bold-vibrant', name: 'Bold & Vibrant', description: 'High-energy immersive hero, gradient buttons and loud contrast.', preview: { bg: '#0b0b12', surface: '#18181f', accent: '#7c3aed', accent2: '#f43f5e', ink: '#f8fafc' } },
    { id: 'luxury-premium', name: 'Luxury Premium', description: 'Dark elegant surfaces, serif display type and glass-style cards.', preview: { bg: '#0c0a09', surface: '#1c1917', accent: '#c9a227', accent2: '#8b7355', ink: '#faf7f2' } },
    { id: 'ecommerce', name: 'E-commerce', description: 'Product-forward split layout with bordered cards and clear CTAs.', preview: { bg: '#f0f9ff', surface: '#ffffff', accent: '#0ea5e9', accent2: '#f97316', ink: '#0c4a6e' } },
    { id: 'dark-tech', name: 'Dark Tech', description: 'Cyber-dark UI, geometric type, glass cards and cyan accents.', preview: { bg: '#020617', surface: '#0f172a', accent: '#22d3ee', accent2: '#a78bfa', ink: '#e2e8f0' } },
    { id: 'nature-organic', name: 'Nature & Organic', description: 'Soft greens, round shapes and an airy centered composition.', preview: { bg: '#f0fdf4', surface: '#ffffff', accent: '#16a34a', accent2: '#84cc16', ink: '#14532d' } },
    { id: 'corporate-professional', name: 'Corporate Professional', description: 'Trustworthy navy palette, classic type and structured bordered cards.', preview: { bg: '#f8fafc', surface: '#ffffff', accent: '#1e40af', accent2: '#64748b', ink: '#0f172a' } },
    { id: 'playful-creative', name: 'Playful & Creative', description: 'Pill shapes, gradient CTAs and a colourful immersive hero.', preview: { bg: '#fffbeb', surface: '#ffffff', accent: '#f59e0b', accent2: '#ec4899', ink: '#78350f' } },
    { id: 'editorial-magazine', name: 'Editorial Magazine', description: 'Serif headlines, flat cards and a typography-led centered layout.', preview: { bg: '#fafaf9', surface: '#ffffff', accent: '#111827', accent2: '#b45309', ink: '#1c1917' } },
    { id: 'custom', name: 'Custom Theme', description: 'Create your own look with custom typography, layout, corners and buttons.', preview: { bg: '#f1f5f9', surface: '#ffffff', accent: '#6366f1', accent2: '#ec4899', ink: '#0f172a' } }
  ];
  const DEFAULT_THEME = 'modern-saas';

  function renderThemeGrid() {
    const grid = $('theme-grid');
    if (!grid) return;
    const selected = $('pageTheme').value || DEFAULT_THEME;
    grid.innerHTML = THEMES.map((t) => {
      const p = t.preview;
      const isSel = t.id === selected;
      return `<button type="button" class="theme-card${isSel ? ' is-selected' : ''}" role="radio" aria-checked="${isSel ? 'true' : 'false'}" data-theme="${t.id}" aria-label="${t.name}: ${t.description}">
        <div class="theme-preview" style="--tp-bg:${p.bg};--tp-surface:${p.surface};--tp-accent:${p.accent};--tp-accent2:${p.accent2};--tp-ink:${p.ink}" aria-hidden="true">
          <div class="tp-header"><span class="tp-logo"></span><span class="tp-nav"></span><span class="tp-nav"></span></div>
          <div class="tp-hero">
            <div class="tp-copy"><span class="tp-line tp-line-lg"></span><span class="tp-line"></span><span class="tp-btn"></span></div>
            <div class="tp-media"></div>
          </div>
          <div class="tp-cards"><span class="tp-card"></span><span class="tp-card"></span><span class="tp-card"></span></div>
        </div>
        <div class="theme-meta">
          <strong class="theme-name">${t.name}</strong>
          <span class="theme-desc">${t.description}</span>
        </div>
        <span class="theme-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');

    grid.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => selectTheme(card.dataset.theme));
      card.addEventListener('pointerenter', () => showThemeHoverPreview(card), { passive: true });
      card.addEventListener('pointerleave', hideThemeHoverPreview, { passive: true });
      card.addEventListener('focus', () => showThemeHoverPreview(card));
      card.addEventListener('blur', hideThemeHoverPreview);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTheme(card.dataset.theme); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = card.nextElementSibling || grid.firstElementChild;
          next.focus();
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = card.previousElementSibling || grid.lastElementChild;
          prev.focus();
        }
      });
    });
  }

  // A larger, floating theme preview appears while hovering or keyboard-focusing a card.
  let hoverPreview = null;
  function themePreviewMarkup(theme, large = false) {
    const p = theme.preview;
    return `<div class="theme-preview${large ? ' theme-preview-large' : ''}" style="--tp-bg:${p.bg};--tp-surface:${p.surface};--tp-accent:${p.accent};--tp-accent2:${p.accent2};--tp-ink:${p.ink}" aria-hidden="true">
      <div class="tp-header"><span class="tp-logo"></span><span class="tp-nav"></span><span class="tp-nav"></span><span class="tp-nav"></span></div>
      <div class="tp-hero"><div class="tp-copy"><span class="tp-line tp-line-lg"></span><span class="tp-line"></span><span class="tp-line"></span><span class="tp-btn"></span></div><div class="tp-media"></div></div>
      <div class="tp-cards"><span class="tp-card"></span><span class="tp-card"></span><span class="tp-card"></span></div>
    </div>`;
  }
  function showThemeHoverPreview(card) {
    const theme = THEMES.find((t) => t.id === card.dataset.theme);
    if (!theme) return;
    if (!hoverPreview) {
      hoverPreview = document.createElement('div');
      hoverPreview.className = 'theme-hover-preview';
      hoverPreview.setAttribute('role', 'tooltip');
      hoverPreview.setAttribute('aria-hidden', 'true');
      document.body.appendChild(hoverPreview);
    }
    hoverPreview.innerHTML = `<strong class="theme-hover-title"></strong>${themePreviewMarkup(theme, true)}<p class="theme-hover-description"></p>`;
    hoverPreview.querySelector('.theme-hover-title').textContent = theme.name;
    hoverPreview.querySelector('.theme-hover-description').textContent = theme.description;
    const rect = card.getBoundingClientRect();
    const width = Math.min(390, window.innerWidth - 24);
    let left = rect.right + 14;
    if (left + width > window.innerWidth - 12) left = Math.max(12, rect.left - width - 14);
    let top = Math.max(12, Math.min(rect.top + 12, window.innerHeight - 290));
    hoverPreview.style.width = `${width}px`;
    hoverPreview.style.left = `${left}px`;
    hoverPreview.style.top = `${top}px`;
    hoverPreview.classList.add('is-visible');
    hoverPreview.setAttribute('aria-hidden', 'false');
  }
  function hideThemeHoverPreview() {
    if (!hoverPreview) return;
    hoverPreview.classList.remove('is-visible');
    hoverPreview.setAttribute('aria-hidden', 'true');
  }

  function selectTheme(id) {
    hideThemeHoverPreview();
    if (!THEMES.some((t) => t.id === id)) id = DEFAULT_THEME;
    $('pageTheme').value = id;
    document.querySelectorAll('.theme-card').forEach((card) => {
      const on = card.dataset.theme === id;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    customPanel.classList.toggle('hidden', id !== 'custom');
  }

  renderThemeGrid();
  selectTheme(DEFAULT_THEME);

  [['primaryColor', 'primary-hex'], ['secondaryColor', 'secondary-hex']].forEach(([i, h]) =>
    $(i).addEventListener('input', () => ($(h).textContent = $(i).value)));

  function showError(msg) { err.textContent = msg; err.classList.remove('hidden'); err.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  function validateForm() {
    err.classList.add('hidden');
    const fd = new FormData(form);
    if (!fd.getAll('sections').length) { showError('Pick at least one section.'); return false; }
    const ctaUrl = String(fd.get('ctaUrl') || '').trim();
    if (ctaUrl && !/^(https?:\/\/|mailto:|tel:)/i.test(ctaUrl)) { showError('If provided, the CTA link must start with http://, https://, mailto: or tel:'); return false; }
    if (!form.checkValidity()) { form.reportValidity(); return false; }
    for (const f of $('images').files) if (f.size > 8 * 1024 * 1024) { showError(`"${f.name}" is over 8 MB.`); return false; }
    if ($('images').files.length > 3) { showError('Please choose at most 3 images.'); return false; }
    return true;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    formStep.classList.add('hidden');
    themeStep.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  backBtn.addEventListener('click', () => {
    themeStep.classList.add('hidden');
    formStep.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  btn.addEventListener('click', async () => {
    if (!validateForm()) {
      themeStep.classList.add('hidden');
      formStep.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    const fd = new FormData(form);
    if (!$('pageTheme').value) fd.set('pageTheme', DEFAULT_THEME);
    if ($('pageTheme').value === 'custom') {
      fd.set('customTheme', JSON.stringify({
        mode: $('customMode').value, font: $('customFont').value, radius: $('customRadius').value,
        spacing: $('customSpacing').value, hero: $('customHero').value, cards: $('customCards').value,
        buttons: $('customButtons').value
      }));
    }
    btn.disabled = true; btn.textContent = 'Writing your page…';
    try {
      const res = await fetch('/api/generate', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      try {
        localStorage.setItem('lp_token_' + data.id, data.token);
        const list = JSON.parse(localStorage.getItem('lp_pages') || '[]');
        const next = { id: data.id, name: fd.get('brandName') || fd.get('targetAudience') || 'Untitled landing page', at: Date.now() };
        const deduped = [next, ...list.filter((p) => p && p.id !== data.id)];
        localStorage.setItem('lp_pages', JSON.stringify(deduped.slice(0, 50)));
        if (data.note) sessionStorage.setItem('lp_notice', data.note);
      } catch (e2) { /* storage blocked: token is passed in URL fragment below */ }
      location.href = data.editUrl + '#t=' + encodeURIComponent(data.token);
    } catch (e3) {
      showError(e3.message);
      btn.disabled = false; btn.textContent = 'Generate landing page →';
    }
  });

  // History: previous landing pages saved on this device.
  // Entries remain device-local because edit tokens are stored in localStorage.
  try {
    const saved = JSON.parse(localStorage.getItem('lp_pages') || '[]');
    const list = saved.filter((p) => p && p.id && localStorage.getItem('lp_token_' + p.id));
    const historySection = $('my-pages');
    const historyList = $('my-pages-list');
    const historyCount = $('history-count');
    const emptyState = $('history-empty');
    if (historySection && historyList) {
      historySection.classList.remove('hidden');
      historyCount.textContent = String(list.length);
      if (!list.length) {
        emptyState.classList.remove('hidden');
      } else {
        list.forEach((p) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = '/edit/' + encodeURIComponent(p.id) + '#t=' + encodeURIComponent(localStorage.getItem('lp_token_' + p.id));
          a.textContent = p.name || 'Untitled landing page';
          const meta = document.createElement('small');
          const date = p.at ? new Date(p.at) : null;
          meta.textContent = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Previously generated';
          li.append(a, meta);
          historyList.appendChild(li);
        });
      }
    }
  } catch (e) { /* local history unavailable or malformed; keep generator usable */ }
})();