'use strict';

/**
 * Landing page visual themes.
 * Each theme maps to design tokens already understood by render.js / page.css:
 *   tone  → lp-tone-* (visual preset)
 *   mode, font, radius, spacing, hero, cards, buttons → theme classes
 * User brand colours always override defaultAccent (primary/secondary).
 * Writing tone (LLM copy style) stays independent — set on the form separately.
 */

const THEMES = [
  {
    id: 'modern-saas',
    name: 'Modern SaaS',
    description: 'Clean product layout with soft cards and a split hero — ideal for software and tools.',
    tone: 'professional',
    tokens: { mode: 'light', font: 'modern', radius: 'soft', spacing: 'normal', hero: 'split', cards: 'shadow', buttons: 'solid' },
    defaultAccent: { primary: '#6366f1', secondary: '#ec4899' },
    preview: { bg: '#f8fafc', surface: '#ffffff', accent: '#6366f1', accent2: '#ec4899', ink: '#0f172a' }
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Sparse, typography-first design with square edges and outline buttons.',
    tone: 'minimal',
    tokens: { mode: 'light', font: 'classic', radius: 'square', spacing: 'compact', hero: 'centered', cards: 'flat', buttons: 'outline' },
    defaultAccent: { primary: '#171717', secondary: '#525252' },
    preview: { bg: '#ffffff', surface: '#fafafa', accent: '#171717', accent2: '#525252', ink: '#111111' }
  },
  {
    id: 'bold-vibrant',
    name: 'Bold & Vibrant',
    description: 'High-energy immersive hero, gradient buttons and loud contrast.',
    tone: 'bold',
    tokens: { mode: 'dark', font: 'modern', radius: 'round', spacing: 'airy', hero: 'immersive', cards: 'shadow', buttons: 'gradient' },
    defaultAccent: { primary: '#7c3aed', secondary: '#f43f5e' },
    preview: { bg: '#0b0b12', surface: '#18181f', accent: '#7c3aed', accent2: '#f43f5e', ink: '#f8fafc' }
  },
  {
    id: 'luxury-premium',
    name: 'Luxury Premium',
    description: 'Dark elegant surfaces, serif display type and glass-style cards.',
    tone: 'luxury',
    tokens: { mode: 'dark', font: 'elegant', radius: 'soft', spacing: 'airy', hero: 'centered', cards: 'glass', buttons: 'solid' },
    defaultAccent: { primary: '#c9a227', secondary: '#8b7355' },
    preview: { bg: '#0c0a09', surface: '#1c1917', accent: '#c9a227', accent2: '#8b7355', ink: '#faf7f2' }
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    description: 'Product-forward split layout with bordered cards and clear CTAs.',
    tone: 'friendly',
    tokens: { mode: 'light', font: 'modern', radius: 'soft', spacing: 'normal', hero: 'split', cards: 'bordered', buttons: 'solid' },
    defaultAccent: { primary: '#0ea5e9', secondary: '#f97316' },
    preview: { bg: '#f0f9ff', surface: '#ffffff', accent: '#0ea5e9', accent2: '#f97316', ink: '#0c4a6e' }
  },
  {
    id: 'dark-tech',
    name: 'Dark Tech',
    description: 'Cyber-dark UI, geometric type, glass cards and cyan accents.',
    tone: 'techy',
    tokens: { mode: 'dark', font: 'techy', radius: 'square', spacing: 'compact', hero: 'split', cards: 'glass', buttons: 'solid' },
    defaultAccent: { primary: '#22d3ee', secondary: '#a78bfa' },
    preview: { bg: '#020617', surface: '#0f172a', accent: '#22d3ee', accent2: '#a78bfa', ink: '#e2e8f0' }
  },
  {
    id: 'nature-organic',
    name: 'Nature & Organic',
    description: 'Soft greens, round shapes and an airy centered composition.',
    tone: 'friendly',
    tokens: { mode: 'light', font: 'friendly', radius: 'round', spacing: 'airy', hero: 'centered', cards: 'flat', buttons: 'solid' },
    defaultAccent: { primary: '#16a34a', secondary: '#84cc16' },
    preview: { bg: '#f0fdf4', surface: '#ffffff', accent: '#16a34a', accent2: '#84cc16', ink: '#14532d' }
  },
  {
    id: 'corporate-professional',
    name: 'Corporate Professional',
    description: 'Trustworthy navy palette, classic type and structured bordered cards.',
    tone: 'professional',
    tokens: { mode: 'light', font: 'classic', radius: 'soft', spacing: 'normal', hero: 'split', cards: 'bordered', buttons: 'solid' },
    defaultAccent: { primary: '#1e40af', secondary: '#64748b' },
    preview: { bg: '#f8fafc', surface: '#ffffff', accent: '#1e40af', accent2: '#64748b', ink: '#0f172a' }
  },
  {
    id: 'playful-creative',
    name: 'Playful & Creative',
    description: 'Pill shapes, gradient CTAs and a colourful immersive hero.',
    tone: 'playful',
    tokens: { mode: 'light', font: 'playful', radius: 'pill', spacing: 'airy', hero: 'immersive', cards: 'shadow', buttons: 'gradient' },
    defaultAccent: { primary: '#f59e0b', secondary: '#ec4899' },
    preview: { bg: '#fffbeb', surface: '#ffffff', accent: '#f59e0b', accent2: '#ec4899', ink: '#78350f' }
  },
  {
    id: 'editorial-magazine',
    name: 'Editorial Magazine',
    description: 'Serif headlines, flat cards and a typography-led centered layout.',
    tone: 'professional',
    tokens: { mode: 'light', font: 'editorial', radius: 'square', spacing: 'normal', hero: 'centered', cards: 'flat', buttons: 'outline' },
    defaultAccent: { primary: '#111827', secondary: '#b45309' },
    preview: { bg: '#fafaf9', surface: '#ffffff', accent: '#111827', accent2: '#b45309', ink: '#1c1917' }
  }
];

const BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
const DEFAULT_THEME_ID = 'modern-saas';

function getTheme(id) {
  return BY_ID[id] || BY_ID[DEFAULT_THEME_ID];
}

/** Merge theme tokens into a theme object. User colours win over defaults. */
function applyThemeTokens(themeObj, themeId, userPrimary, userSecondary) {
  const t = getTheme(themeId);
  const out = Object.assign({}, themeObj || {});
  Object.keys(t.tokens).forEach((k) => { out[k] = t.tokens[k]; });
  // Only fill accents when the caller did not supply valid user colours
  if (!userPrimary) out.primary = t.defaultAccent.primary;
  if (!userSecondary) out.secondary = t.defaultAccent.secondary;
  return out;
}

module.exports = {
  THEMES,
  BY_ID,
  DEFAULT_THEME_ID,
  getTheme,
  applyThemeTokens,
  THEME_IDS: THEMES.map((t) => t.id)
};