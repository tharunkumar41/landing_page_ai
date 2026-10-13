'use strict';
const LP = require('../public/js/render.js');
const { getTheme, applyThemeTokens, DEFAULT_THEME_ID } = require('./themes');

/** Turn generator inputs + copy into an editable page document. */
function buildDoc(inputs, content, images) {
  images = images || [];
  const want = new Set(inputs.sections);
  const sec = (type, data) => ({ id: LP.newId(), type, data });
  const media = (i) => (images[i] ? { kind: 'image', url: images[i], alt: '' } : { kind: 'none', url: '' });
  const c = content;
  const all = {
    header: () => sec('header', {}),
    hero: () => sec('hero', { headline: c.headline, subtitle: c.subtitle, ctaSecondary: c.ctaSecondary, media: media(0) }),
    video: () => sec('video', { title: c.video.title, subtitle: c.video.subtitle, url: '' }),
    about: () => sec('about', { nav: 'About', title: c.about.title, paragraphs: c.about.paragraphs, media: media(1) }),
    services: () => sec('services', { nav: 'Features', title: c.features.title, subtitle: c.features.subtitle, items: c.features.items }),
    products: () => sec('products', { nav: 'Products', title: c.products.title, subtitle: c.products.subtitle, sample: true,
      items: c.products.items.map((p, i) => ({ ...p, media: i === 0 ? media(2) : { kind: 'none', url: '' } })) }),
    testimonials: () => sec('testimonials', { nav: 'Stories', title: c.testimonials.title, subtitle: c.testimonials.subtitle, sample: true, items: c.testimonials.items }),
    contact: () => sec('contact', { nav: 'Contact', title: c.contact.title, subtitle: c.contact.subtitle, buttonLabel: 'Send message' }),
    cta: () => sec('cta', { title: c.cta.title, subtitle: c.cta.subtitle }),
    footer: () => sec('footer', { tagline: c.footer.tagline })
  };
  const sections = LP.SECTION_ORDER.filter((t) => want.has(t)).map((t) => all[t]());

  const themeId = inputs.pageTheme || DEFAULT_THEME_ID;
  const themeDef = getTheme(themeId);
  // Visual tone comes from the selected theme; writing tone is used only by the LLM.
  const visualTone = inputs.pageTheme === 'custom' ? (inputs.customTheme && inputs.customTheme.mode === 'dark' ? 'techy' : 'professional') : themeDef.tone;
  const theme = applyThemeTokens(
    { primary: inputs.primaryColor, secondary: inputs.secondaryColor },
    themeId,
    inputs.primaryColor,
    inputs.secondaryColor
  );
  if (inputs.pageTheme === 'custom' && inputs.customTheme) {
    for (const key of ['mode','font','radius','spacing','hero','cards','buttons']) {
      if (inputs.customTheme[key]) theme[key] = inputs.customTheme[key];
    }
  }
  // User brand colours always win
  theme.primary = inputs.primaryColor || theme.primary;
  theme.secondary = inputs.secondaryColor || theme.secondary;

  return {
    brand: c.brandName,
    ctaLabel: c.ctaLabel,
    ctaUrl: inputs.ctaUrl,
    privacyUrl: '', termsUrl: '',
    imageStyle: inputs.preferredImages,
    tone: visualTone,
    writingTone: inputs.tone,
    pageTheme: inputs.pageTheme === 'custom' ? 'custom' : themeDef.id,
    purpose: inputs.pagePurpose,
    theme,
    seo: c.seo,
    sections
  };
}

module.exports = { buildDoc };