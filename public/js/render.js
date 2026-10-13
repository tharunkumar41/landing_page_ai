/**
 * Shared renderer + sanitiser.
 * Loaded by the server (require) AND by the browser editor (<script>), so the
 * preview, the editor and the published page are always produced by the same code.
 * Everything user-controlled is HTML-escaped and every URL is allow-listed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LP = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- helpers ----------
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const HEX = /^#[0-9a-f]{6}$/i;
  const hex = (c, fb) => (HEX.test(c || "") ? c : fb);

  /** http(s) or one of our own uploads. Used for images / video. */
  function safeUrl(u) {
    u = String(u || "").trim();
    if (!u || u.length > 2000) return "";
    if (/^\/uploads\/[a-z0-9]+\/[\w.-]+$/i.test(u) && !u.includes("..")) return u;
    if (/^https?:\/\//i.test(u)) {
      try { new URL(u); return u; } catch (e) { return ""; }
    }
    return "";
  }

  /** Links (CTA etc.): http(s), mailto, tel, or an in-page #anchor. */
  function safeLink(u) {
    u = String(u || "").trim();
    if (!u || u.length > 2000) return "";
    if (/^#[\w-]+$/.test(u)) return u;
    if (/^mailto:[^\s<>"']+$/i.test(u)) return u;
    if (/^tel:[+\d\-().\s]+$/i.test(u)) return u;
    if (/^https?:\/\//i.test(u)) {
      try { new URL(u); return u; } catch (e) { return ""; }
    }
    return "";
  }

  function luminance(h) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** Readable text colour (white or near-black) for a given background. */
  function onColor(bg) {
    const L = luminance(bg);
    return (1.05) / (L + 0.05) >= (L + 0.05) / 0.06 ? "#ffffff" : "#111111";
  }

  function videoEmbed(url) {
    let m;
    if ((m = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{11})/i)) ||
        (m = url.match(/^https?:\/\/youtu\.be\/([\w-]{11})/i)) ||
        (m = url.match(/^https?:\/\/(?:www\.)?youtube\.com\/(?:embed|shorts)\/([\w-]{11})/i))) {
      return { type: "iframe", src: "https://www.youtube-nocookie.com/embed/" + m[1] };
    }
    if ((m = url.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i))) {
      return { type: "iframe", src: "https://player.vimeo.com/video/" + m[1] };
    }
    if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) || url.startsWith("/uploads/")) return { type: "video", src: url };
    return null;
  }
  function guessKind(url) {
    url = safeUrl(url);
    if (!url) return "none";
    return videoEmbed(url) ? "video" : "image";
  }

  // ---------- section catalogue ----------
  // Presets: the first five match the generator's tones; the last three are design-only (AI "Ask AI" can pick them).
  const TONE_KEYS = ["professional", "friendly", "bold", "minimal", "urgent", "luxury", "playful", "techy"];
  // Every design setting the AI (or code) may change. Anything not in these lists is rejected.
  const THEME_OPTIONS = {
    mode: ["light", "dark"],
    font: ["classic", "modern", "elegant", "friendly", "techy", "playful", "editorial"],
    radius: ["square", "soft", "round", "pill"],
    spacing: ["compact", "normal", "airy"],
    hero: ["split", "centered", "immersive"],
    cards: ["flat", "bordered", "shadow", "glass"],
    buttons: ["solid", "outline", "gradient"]
  };
  const THEME_CLASS = { mode: "m", font: "f", radius: "r", spacing: "sp", hero: "h", cards: "c", buttons: "b" };
  const PRESET_FONT = { luxury: "elegant", playful: "playful", techy: "techy" };
  const FONT_GOOGLE = {
    elegant: ["Cormorant+Garamond:wght@500;600;700"],
    friendly: ["Nunito:wght@400;600;700;800"],
    techy: ["Space+Grotesk:wght@500;600;700"],
    playful: ["Poppins:wght@400;500;600;700;800"],
    editorial: ["DM+Serif+Display", "DM+Sans:wght@400;500;700"]
  };
  const PURPOSE_LABELS = {
    "lead-generation": "Free to join",
    "product-launch": "New launch",
    "saas-signup": "Free trial",
    "event-registration": "Live event",
    "ebook-download": "Free download",
    "service-booking": "Book a session",
    "brand-awareness": "Our story"
  };
  const SECTION_ORDER = ["header", "hero", "video", "about", "services", "products", "testimonials", "contact", "cta", "footer"];
  const SECTION_LABELS = {
    header: "Header / Nav", hero: "Hero", video: "Video", about: "About / Problem", services: "Services / Features",
    products: "Products", testimonials: "Testimonials", contact: "Contact form", cta: "Closing CTA", footer: "Footer"
  };
  const NAV_DEFAULT = { about: "About", services: "Features", products: "Products", testimonials: "Stories", contact: "Contact" };

  const newId = () => "s" + Math.random().toString(36).slice(2, 8).padEnd(5, "0");

  function newItem(type) {
    if (type === "services") return { icon: "✨", title: "New feature", desc: "Describe this feature and the benefit it gives your customers." };
    if (type === "products") return { name: "New product", desc: "A short description of this product or plan.", price: "$29/mo", media: { kind: "none", url: "" } };
    if (type === "testimonials") return { name: "Customer name", role: "Role, Company", text: "Replace this with a real quote from a customer." };
    return {};
  }

  function defaultSection(type, doc) {
    const brand = (doc && doc.brand) || "Your Brand";
    const d = {
      header: {},
      hero: { headline: "Your headline goes here", subtitle: "Explain what you offer and who it is for in one or two sentences.", ctaSecondary: "See how it works", media: { kind: "none", url: "" } },
      video: { title: "See it in action", subtitle: "Paste a YouTube, Vimeo or MP4 link to show your product.", url: "" },
      about: { nav: "About", title: "About us", paragraphs: ["Tell your story here.", "Add a second paragraph about how you help."], media: { kind: "none", url: "" } },
      services: { nav: "Features", title: "What we offer", subtitle: "A short intro to your services.", items: [newItem("services"), newItem("services"), newItem("services")] },
      products: { nav: "Products", title: "Our products", subtitle: "Choose what fits.", sample: true, items: [newItem("products"), newItem("products"), newItem("products")] },
      testimonials: { nav: "Stories", title: "What customers say", subtitle: "Real words from real people.", sample: true, items: [newItem("testimonials"), newItem("testimonials"), newItem("testimonials")] },
      contact: { nav: "Contact", title: "Get in touch", subtitle: "Questions? Send us a message.", buttonLabel: "Send message" },
      cta: { title: "Ready to get started?", subtitle: "Take the next step today." },
      footer: { tagline: brand + " — thanks for visiting." }
    }[type];
    return { id: newId(), type, data: JSON.parse(JSON.stringify(d || {})) };
  }

  // ---------- sanitiser (used on every save) ----------
  const BAD_KEY = /^(__proto__|constructor|prototype)$/;
  function cleanValue(v, key, depth) {
    if (depth > 5) return undefined;
    if (typeof v === "string") {
      if (key === "url") return safeUrl(v);
      return v.slice(0, 3000);
    }
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.slice(0, 12).map((x) => cleanValue(x, key, depth + 1)).filter((x) => x !== undefined);
    if (v && typeof v === "object") {
      const out = {};
      Object.keys(v).slice(0, 30).forEach((k) => {
        if (BAD_KEY.test(k) || !/^[A-Za-z_]\w{0,31}$/.test(k)) return;
        const c = cleanValue(v[k], k, depth + 1);
        if (c !== undefined) out[k] = c;
      });
      return out;
    }
    return undefined;
  }

  /** Returns { doc, errors[] }. Never trusts the client's shape. */
  function sanitizeDoc(input) {
    const errors = [];
    input = input && typeof input === "object" ? input : {};
    const doc = {
      brand: String(input.brand || "").slice(0, 80),
      ctaLabel: String(input.ctaLabel || "Get started").slice(0, 60),
      ctaUrl: "",
      privacyUrl: "",
      termsUrl: "",
      imageStyle: ["abstract", "people", "product", "nature", "tech"].includes(input.imageStyle) ? input.imageStyle : "abstract",
      tone: TONE_KEYS.includes(input.tone) ? input.tone : "professional",
      writingTone: typeof input.writingTone === "string" ? String(input.writingTone).slice(0, 40) : "",
      pageTheme: typeof input.pageTheme === "string" ? String(input.pageTheme).slice(0, 40) : "",
      purpose: PURPOSE_LABELS[input.purpose] ? input.purpose : "",
      theme: {
        primary: hex(input.theme && input.theme.primary, "#6366f1"),
        secondary: hex(input.theme && input.theme.secondary, "#ec4899"),
        ...Object.fromEntries(Object.keys(THEME_OPTIONS).map((k) => [k, THEME_OPTIONS[k].includes(input.theme && input.theme[k]) ? input.theme[k] : ""]))
      },
      seo: {
        title: String((input.seo && input.seo.title) || "").slice(0, 120),
        description: String((input.seo && input.seo.description) || "").slice(0, 300)
      },
      sections: []
    };
    if (input.ctaUrl) {
      doc.ctaUrl = safeLink(input.ctaUrl);
      if (!doc.ctaUrl) errors.push("If provided, the CTA link must start with http://, https://, mailto:, tel: or #");
    }
    ["privacyUrl", "termsUrl"].forEach((k) => {
      if (input[k]) {
        doc[k] = safeLink(input[k]);
        if (!doc[k]) errors.push(k + " must be a valid link");
      }
    });
    const seen = new Set();
    const ids = new Set();
    (Array.isArray(input.sections) ? input.sections : []).slice(0, 20).forEach((s) => {
      if (!s || !SECTION_ORDER.includes(s.type) || seen.has(s.type)) return;
      seen.add(s.type);
      let id = typeof s.id === "string" && /^s[a-z0-9]{4,10}$/.test(s.id) && !ids.has(s.id) ? s.id : newId();
      ids.add(id);
      doc.sections.push({ id, type: s.type, data: cleanValue(s.data || {}, "", 0) || {} });
    });
    return { doc, errors };
  }

  // ---------- placeholder artwork (no external images needed) ----------
  const ART = {
    abstract: '<circle cx="110" cy="120" r="90" fill="#fff" opacity=".18"/><circle cx="270" cy="170" r="110" fill="#fff" opacity=".14"/><circle cx="200" cy="70" r="50" fill="#fff" opacity=".25"/><rect x="60" y="190" width="170" height="14" rx="7" fill="#fff" opacity=".35"/><rect x="60" y="214" width="110" height="14" rx="7" fill="#fff" opacity=".25"/>',
    people: '<circle cx="130" cy="105" r="34" fill="#fff" opacity=".85"/><path d="M70 235c0-42 26-70 60-70s60 28 60 70z" fill="#fff" opacity=".85"/><circle cx="250" cy="125" r="28" fill="#fff" opacity=".55"/><path d="M202 235c0-36 22-58 48-58s48 22 48 58z" fill="#fff" opacity=".55"/>',
    product: '<path d="M200 60l100 50v100l-100 50-100-50V110z" fill="#fff" opacity=".22"/><path d="M200 60l100 50-100 50-100-50z" fill="#fff" opacity=".6"/><path d="M200 160v100M200 160L100 110M200 160l100-50" stroke="#fff" stroke-width="3" opacity=".8" fill="none"/>',
    nature: '<circle cx="290" cy="75" r="34" fill="#fff" opacity=".7"/><path d="M0 230l90-100 70 70 60-80 180 110v50H0z" fill="#fff" opacity=".35"/><path d="M0 260l110-70 90 60 100-50 100 60v40H0z" fill="#fff" opacity=".55"/>',
    tech: '<rect x="50" y="55" width="300" height="190" rx="14" fill="#fff" opacity=".9"/><rect x="50" y="55" width="300" height="34" rx="14" fill="#fff" opacity=".6"/><circle cx="74" cy="72" r="6" fill="var(--lp-primary)"/><circle cx="94" cy="72" r="6" fill="var(--lp-secondary)"/><rect x="76" y="112" width="130" height="12" rx="6" fill="var(--lp-primary)" opacity=".7"/><rect x="76" y="136" width="210" height="12" rx="6" fill="#111" opacity=".15"/><rect x="76" y="160" width="170" height="12" rx="6" fill="#111" opacity=".15"/><rect x="76" y="196" width="80" height="28" rx="8" fill="var(--lp-secondary)" opacity=".8"/>'
  };
  const art = (style) =>
    `<svg class="lp-art" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ART[style] || ART.abstract}</svg>`;

  // ---------- rendering ----------
  function render(doc, opts) {
    opts = opts || {};
    const edit = !!opts.edit;
    const ed = (p) => (edit ? ` data-edit="${esc(p)}"` : "");
    const ctx = { doc, edit };
    const ctaUrl = safeLink(doc.ctaUrl) || "#";
    const ctaTarget = /^https?:/i.test(ctaUrl) ? ' target="_blank" rel="noopener noreferrer"' : "";
    const has = (t) => doc.sections.some((s) => s.type === t);
    const secOf = (t) => doc.sections.find((s) => s.type === t);
    const cta = (cls, extra) =>
      `<a class="lp-btn lp-cta ${cls}" href="${esc(ctaUrl)}"${ctaTarget}${ed("page.ctaLabel")}>${esc(doc.ctaLabel)}</a>`;

    function media(m, path, cls) {
      m = m || {};
      const url = safeUrl(m.url);
      let inner = "";
      if (url && m.kind === "image") inner = `<img src="${esc(url)}" alt="${esc(m.alt || "")}" loading="lazy">`;
      else if (url && m.kind === "video") {
        const v = videoEmbed(url);
        if (v && v.type === "iframe")
          inner = `<iframe src="${esc(v.src)}" title="Video" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        else if (v) inner = `<video src="${esc(v.src)}" controls preload="metadata" playsinline></video>`;
      }
      const empty = !inner;
      if (empty) inner = art(doc.imageStyle);
      return `<div class="lp-media ${cls || ""}${empty ? " is-empty" : ""}"${edit ? ` data-media="${esc(path)}"` : ""}>${inner}</div>`;
    }

    const heading = (sec, extra) => `
      <div class="lp-section-header">
        <h2${ed(sec.id + ".title")}>${esc(sec.data.title)}</h2>
        ${sec.data.subtitle !== undefined ? `<p${ed(sec.id + ".subtitle")}>${esc(sec.data.subtitle)}</p>` : ""}
      </div>`;

    const wrap = (sec, cls, body, anchor) =>
      `<section class="lp-section ${cls}" ${anchor ? `id="${anchor}" ` : ""}data-sec="${sec.id}" data-type="${sec.type}">${edit && sec.data.sample ? sampleBanner(sec) : ""}${body}</section>`;
    const sampleBanner = (sec) =>
      `<div class="lp-sample-banner" contenteditable="false">⚠ AI-generated sample content — replace with your real ${esc(sec.type === "products" ? "products and prices" : "customer quotes")} before publishing. <button type="button" data-sample-ok="${sec.id}">I've replaced it</button></div>`;

    const R = {
      header(sec) {
        const links = doc.sections
          .filter((s) => NAV_DEFAULT[s.type])
          .map((s) => `<li><a href="#${s.type}"${ed(s.id + ".nav")}>${esc(s.data.nav || NAV_DEFAULT[s.type])}</a></li>`)
          .join("");
        return `<header class="lp-header" id="top" data-sec="${sec.id}" data-type="header">
          <a class="lp-logo" href="#top"${ed("page.brand")}>${esc(doc.brand)}</a>
          <nav aria-label="Main"><ul class="lp-nav">${links}</ul></nav>
          ${cta("lp-btn-primary lp-header-cta")}
        </header>`;
      },
      hero(sec) {
        const d = sec.data;
        const target = has("services") ? "#services" : has("about") ? "#about" : "";
        return `<section class="lp-hero" data-sec="${sec.id}" data-type="hero">
          <div class="lp-hero-content">
            ${PURPOSE_LABELS[doc.purpose] ? `<span class="lp-eyebrow">${esc(PURPOSE_LABELS[doc.purpose])}</span>` : ""}
            <h1${ed(sec.id + ".headline")}>${esc(d.headline)}</h1>
            <p class="subtitle"${ed(sec.id + ".subtitle")}>${esc(d.subtitle)}</p>
            <div class="cta-group">
              ${cta("lp-btn-primary")}
              ${target && (d.ctaSecondary || edit) ? `<a class="lp-btn lp-btn-secondary" href="${target}"${ed(sec.id + ".ctaSecondary")}>${esc(d.ctaSecondary)}</a>` : ""}
            </div>
          </div>
          <div class="lp-hero-visual">${media(d.media, sec.id + ".media", "lp-media-hero")}</div>
        </section>`;
      },
      video(sec) {
        return wrap(sec, "lp-video", `${heading(sec)}<div class="lp-video-wrap">${media({ kind: "video", url: sec.data.url }, sec.id + ".media", "lp-media-video")}</div>`, "video");
      },
      about(sec) {
        const d = sec.data;
        return wrap(sec, "lp-about", `<div class="lp-about-grid">
          <div class="lp-about-text">
            <h2${ed(sec.id + ".title")}>${esc(d.title)}</h2>
            ${(d.paragraphs || []).map((p, i) => `<p${ed(sec.id + ".paragraphs." + i)}>${esc(p)}</p>`).join("")}
            ${cta("lp-btn-primary")}
          </div>
          ${media(d.media, sec.id + ".media", "lp-media-square")}
        </div>`, "about");
      },
      services(sec) {
        const items = (sec.data.items || []).map((it, i) => {
          const p = sec.id + ".items." + i;
          return `<div class="lp-feature-card"${edit ? ` data-item="${p}"` : ""}>
            <div class="lp-feature-icon"${edit ? ` data-icon="${p}.icon"` : ""}><span>${esc(it.icon || "✨")}</span></div>
            <h3${ed(p + ".title")}>${esc(it.title)}</h3>
            <p${ed(p + ".desc")}>${esc(it.desc)}</p>
          </div>`;
        }).join("");
        return wrap(sec, "lp-features", `${heading(sec)}<div class="lp-features-grid"${edit ? ` data-list="${sec.id}.items"` : ""}>${items}</div>`, "services");
      },
      products(sec) {
        const items = (sec.data.items || []).map((it, i) => {
          const p = sec.id + ".items." + i;
          return `<div class="lp-product-card"${edit ? ` data-item="${p}"` : ""}>
            ${media(it.media, p + ".media", "lp-media-product")}
            <div class="lp-product-body">
              <h3${ed(p + ".name")}>${esc(it.name)}</h3>
              <p${ed(p + ".desc")}>${esc(it.desc)}</p>
              <div class="lp-product-price"${ed(p + ".price")}>${esc(it.price)}</div>
            </div>
          </div>`;
        }).join("");
        return wrap(sec, "lp-products", `${heading(sec)}<div class="lp-products-grid"${edit ? ` data-list="${sec.id}.items"` : ""}>${items}</div>`, "products");
      },
      testimonials(sec) {
        const items = (sec.data.items || []).map((it, i) => {
          const p = sec.id + ".items." + i;
          const initial = esc(String(it.name || "?").trim().charAt(0).toUpperCase() || "?");
          return `<figure class="lp-testimonial-card"${edit ? ` data-item="${p}"` : ""}>
            <blockquote class="lp-testimonial-text"${ed(p + ".text")}>${esc(it.text)}</blockquote>
            <figcaption class="lp-testimonial-author">
              <div class="lp-avatar" aria-hidden="true">${initial}</div>
              <div class="lp-author-info"><strong${ed(p + ".name")}>${esc(it.name)}</strong><span${ed(p + ".role")}>${esc(it.role)}</span></div>
            </figcaption>
          </figure>`;
        }).join("");
        return wrap(sec, "lp-testimonials", `${heading(sec)}<div class="lp-testimonials-grid"${edit ? ` data-list="${sec.id}.items"` : ""}>${items}</div>`, "testimonials");
      },
      contact(sec) {
        return wrap(sec, "lp-contact", `${heading(sec)}
          <form class="lp-contact-form" data-lp-contact method="post" action="#">
            <input type="text" name="name" placeholder="Your name" required maxlength="100" autocomplete="name">
            <input type="email" name="email" placeholder="Email address" required maxlength="200" autocomplete="email">
            <textarea name="message" rows="4" placeholder="Your message" required maxlength="2000"></textarea>
            <input type="text" name="website" class="lp-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
            <button type="submit" class="lp-btn lp-btn-primary"><span${ed(sec.id + ".buttonLabel")}>${esc(sec.data.buttonLabel || "Send message")}</span></button>
            <p class="lp-form-status" role="status" aria-live="polite"></p>
          </form>`, "contact");
      },
      cta(sec) {
        return wrap(sec, "lp-cta-band", `<div class="lp-cta-inner">
          <h2${ed(sec.id + ".title")}>${esc(sec.data.title)}</h2>
          <p${ed(sec.id + ".subtitle")}>${esc(sec.data.subtitle)}</p>
          ${cta("lp-btn-light")}
        </div>`, "cta");
      },
      footer(sec) {
        const explore = doc.sections
          .filter((s) => NAV_DEFAULT[s.type])
          .map((s) => `<li><a href="#${s.type}">${esc(s.data.nav || NAV_DEFAULT[s.type])}</a></li>`).join("");
        const legal = [["Privacy", safeLink(doc.privacyUrl)], ["Terms", safeLink(doc.termsUrl)]]
          .filter((x) => x[1])
          .map((x) => `<li><a href="${esc(x[1])}" target="_blank" rel="noopener noreferrer">${x[0]}</a></li>`).join("");
        return `<footer class="lp-footer" data-sec="${sec.id}" data-type="footer">
          <div class="lp-footer-grid">
            <div>
              <div class="lp-footer-brand"${ed("page.brand")}>${esc(doc.brand)}</div>
              <p${ed(sec.id + ".tagline")}>${esc(sec.data.tagline)}</p>
            </div>
            ${explore ? `<div><h4>Explore</h4><ul>${explore}</ul></div>` : ""}
            <div><h4>Get started</h4><ul><li><a href="${esc(ctaUrl)}"${ctaTarget}>${esc(doc.ctaLabel)}</a></li></ul></div>
            ${legal ? `<div><h4>Legal</h4><ul>${legal}</ul></div>` : ""}
          </div>
          <div class="lp-footer-bottom">© ${new Date().getFullYear()} ${esc(doc.brand)}. All rights reserved.</div>
        </footer>`;
      }
    };

    return doc.sections.map((s) => (R[s.type] ? R[s.type](s) : "")).join("\n");
  }

  const fontKey = (doc) => (doc && doc.theme && doc.theme.font) || PRESET_FONT[doc && doc.tone] || "";

  /** Classes that make tone, purpose and the design settings change the look, not just the words. */
  function rootClass(doc) {
    const tone = TONE_KEYS.includes(doc && doc.tone) ? doc.tone : "professional";
    const cls = ["lp-root", "lp-tone-" + tone];
    if (doc && PURPOSE_LABELS[doc.purpose]) cls.push("lp-purpose-" + doc.purpose);
    const t = (doc && doc.theme) || {};
    Object.keys(THEME_OPTIONS).forEach((k) => {
      const v = k === "font" ? fontKey(doc) : t[k];
      if (v && THEME_OPTIONS[k].includes(v)) cls.push("lp-" + THEME_CLASS[k] + "-" + v);
    });
    return cls.join(" ");
  }

  /** Google Fonts stylesheet URL for the fonts this page actually uses. */
  function fontsHref(doc) {
    const fam = ["Inter:wght@400;500;600;700;800", "Playfair+Display:wght@600;700"].concat(FONT_GOOGLE[fontKey(doc)] || []);
    return "https://fonts.googleapis.com/css2?" + fam.map((f) => "family=" + f).join("&") + "&display=swap";
  }

  function themeStyle(doc) {
    const p = hex(doc.theme && doc.theme.primary, "#6366f1");
    const s = hex(doc.theme && doc.theme.secondary, "#ec4899");
    return `--lp-primary:${p};--lp-secondary:${s};--lp-on-primary:${onColor(p)};--lp-on-secondary:${onColor(s)}`;
  }

  /** Full standalone HTML document for the published page. */
  function renderDocument(doc, opts) {
    opts = opts || {};
    const hero = doc.sections.find((s) => s.type === "hero");
    const title = (doc.seo && doc.seo.title) || (hero && hero.data.headline) || doc.brand || "Landing page";
    const desc = (doc.seo && doc.seo.description) || (hero && hero.data.subtitle) || "";
    const heroImg = hero && hero.data.media && hero.data.media.kind === "image" ? safeUrl(hero.data.media.url) : "";
    const abs = (u) => (u && u.startsWith("/") && opts.baseUrl ? opts.baseUrl + u : u);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
${heroImg ? `<meta property="og:image" content="${esc(abs(heroImg))}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${esc(fontsHref(doc))}" rel="stylesheet">
<link rel="stylesheet" href="/css/page.css">
</head>
<body>
<div class="${rootClass(doc)}" style="${themeStyle(doc)}">
${render(doc, { edit: false })}
</div>
${opts.id ? `<script src="/js/page-runtime.js" data-page="${esc(opts.id)}" defer></script>` : ""}
</body>
</html>`;
  }

  return {
    esc, safeUrl, safeLink, onColor, videoEmbed, guessKind,
    SECTION_ORDER, SECTION_LABELS, NAV_DEFAULT,
    newId, newItem, defaultSection, sanitizeDoc,
    render, themeStyle, rootClass, fontsHref, renderDocument,
    TONE_KEYS, THEME_OPTIONS, PURPOSE_LABELS
  };
});