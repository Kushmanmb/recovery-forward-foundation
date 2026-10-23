/*
 * Recovery Forward Foundation - seasonal theme engine.
 *
 * Picks the theme from the current month in America/Indiana/Indianapolis,
 * decorates the page frame, sections, headings, cards, header and footer,
 * and keeps itself current without redeployment. Purely decorative: every
 * injected node is aria-hidden and non-interactive (except tappable bulbs).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.RFFSeasonal = api;
    if (root.document) {
      var start = function () { api.init(root.document, root); };
      if (root.document.readyState === "loading") {
        root.document.addEventListener("DOMContentLoaded", start);
      } else {
        start();
      }
    }
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var TIMEZONE = "America/Indiana/Indianapolis";
  var STORAGE_KEY = "rff-seasonal-motion";
  var CARD_SELECTOR = [
    ".portal-card", ".mission-card", ".crypto-card", ".daily-prayer-card",
    ".warning-box", ".privacy-banner", ".generated-id", ".result",
    ".form-section", ".lifeline-monitor", ".demo-notice", ".mission-note",
    ".trust-strip", ".process"
  ].join(",");
  var SECTION_SELECTOR = [
    ".hero", ".section", ".intro", ".portal", ".mission-section",
    ".mission-details", ".mission-hero", ".contact-section", ".crypto-section",
    ".daily-prayer-section", ".lifeline"
  ].join(",");
  var HEADING_SELECTOR = ".section-heading, .application-heading, .contact-section > h2, .mission-hero h1";
  var HEADER_SELECTOR = ".site-header";
  var FOOTER_SELECTOR = "footer";
  var SOCIAL_SELECTOR = ".footer-social";

  var MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];

  /* ---------- SVG motifs ---------- */

  var SVG = {
    pumpkin:
      '<svg viewBox="0 0 48 44" focusable="false"><path d="M22 9Q23 0 31 2L28 10z" fill="#3f7d2a"/>' +
      '<ellipse cx="24" cy="26" rx="22" ry="17" fill="#d9600f"/>' +
      '<ellipse cx="14" cy="26" rx="9" ry="16" fill="#f58a2b" opacity=".75"/>' +
      '<ellipse cx="34" cy="26" rx="9" ry="16" fill="#f58a2b" opacity=".75"/>' +
      '<circle class="sx-inner" cx="24" cy="26" r="16" fill="#ffb347"/>' +
      '<g class="sx-flame" fill="#fff0a0"><path d="M12 19l8 4-8 3z"/><path d="M36 19l-8 4 8 3z"/>' +
      '<path d="M24 26l4 6h-8z"/><path d="M10 32q14 10 28 0l-3-3-4 3-3-3-4 3-4-3-3 3-4-3z"/></g></svg>',
    ghost:
      '<svg viewBox="0 0 40 48" focusable="false"><path d="M20 2C9 2 4 11 4 22v24l6-5 5 5 5-5 5 5 5-5 6 5V22C36 11 31 2 20 2z" fill="#eef6ff"/>' +
      '<circle cx="14" cy="21" r="3" fill="#1b1030"/><circle cx="26" cy="21" r="3" fill="#1b1030"/>' +
      '<ellipse cx="20" cy="30" rx="4" ry="5" fill="#1b1030"/></svg>',
    witch:
      '<svg viewBox="0 0 130 64" focusable="false"><path d="M6 48L100 40" stroke="#2a1838" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M100 40l26-8-2 14-24 4z" fill="#2a1838"/>' +
      '<path d="M52 42q-3-17 8-24 9-3 13 7 4 9-2 17z" fill="#150b20" stroke="#b266ff" stroke-width="1"/>' +
      '<circle cx="64" cy="15" r="6" fill="#150b20" stroke="#b266ff" stroke-width="1"/>' +
      '<path d="M55 12L66-8l8 20z" fill="#150b20" stroke="#b266ff" stroke-width="1"/>' +
      '<path d="M50 12h28" stroke="#b266ff" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M52 36q-14 6-22 2" stroke="#150b20" stroke-width="4" fill="none"/></svg>',
    web:
      '<svg viewBox="0 0 64 64" focusable="false" fill="none" stroke="currentColor" stroke-width="1">' +
      '<path d="M0 0H64M0 0L58 26M0 0L44 44M0 0L26 58M0 0V64"/>' +
      '<path d="M18 0Q16 16 0 18M34 0Q30 30 0 34M50 0Q44 44 0 50"/></svg>',
    spider:
      '<svg viewBox="0 0 22 20" focusable="false"><g stroke="#0c0710" stroke-width="1.3" fill="none">' +
      '<path d="M7 9L1 4M7 11L1 12M8 13L3 19M15 9L21 4M15 11L21 12M14 13L19 19"/></g>' +
      '<ellipse cx="11" cy="12" rx="5" ry="6" fill="#0c0710"/><circle cx="11" cy="6" r="3" fill="#0c0710"/>' +
      '<circle cx="10" cy="5.5" r=".8" fill="#ff5252"/><circle cx="12" cy="5.5" r=".8" fill="#ff5252"/></svg>',
    ornament: function (c) {
      return '<svg viewBox="0 0 28 46" focusable="false"><path d="M14 0V12" stroke="#d8b64a" stroke-width="1.2"/>' +
        '<rect x="10.5" y="11" width="7" height="5" rx="1" fill="#d8b64a"/>' +
        '<circle cx="14" cy="30" r="13" fill="' + c + '"/><path d="M6 28q8 6 16 0" stroke="#fff" stroke-opacity=".5" fill="none"/>' +
        '<circle cx="9.5" cy="25" r="3" fill="#fff" opacity=".45"/></svg>';
    },
    garland:
      '<svg viewBox="0 0 200 22" preserveAspectRatio="none" focusable="false">' +
      '<path d="M0 6Q25 22 50 6T100 6T150 6T200 6" fill="none" stroke="#14602e" stroke-width="7"/>' +
      '<path d="M0 6Q25 22 50 6T100 6T150 6T200 6" fill="none" stroke="#2f9e4f" stroke-width="3" stroke-dasharray="3 3"/>' +
      '<circle cx="25" cy="14" r="2.6" fill="#e53935"/><circle cx="75" cy="14" r="2.6" fill="#ffd54f"/>' +
      '<circle cx="125" cy="14" r="2.6" fill="#e53935"/><circle cx="175" cy="14" r="2.6" fill="#ffd54f"/></svg>',
    bow:
      '<svg viewBox="0 0 40 30" focusable="false"><path d="M20 15C10 0 2 2 2 9s10 8 18 6zM20 15c10-15 18-13 18-6s-10 8-18 6z" fill="#d32f2f"/>' +
      '<path d="M20 15L12 29M20 15l8 14" stroke="#b71c1c" stroke-width="5"/><circle cx="20" cy="15" r="4" fill="#ffd54f"/></svg>'
  };

  /* ---------- Season definitions ---------- */

  var SEASONS = [
    { id: "january", name: "Winter Wonder", glyphs: ["❄", "⛄", "✦"], particle: "❄", motion: "fall",
      colors: ["#7fd3ff", "#cfe9ff", "#a99cff"], divider: "❄ ✦ ❄", mood: "winter" },
    { id: "february", name: "Hearts & Hope", glyphs: ["❤", "💗", "🌹"], particle: "❤", motion: "rise",
      colors: ["#ff5c8a", "#ff9ec0", "#e63946"], divider: "❤ ♡ ❤", mood: "hearts" },
    { id: "march", name: "Spring Awakening", glyphs: ["🍀", "🌱", "☘"], particle: "🍀", motion: "fall",
      colors: ["#4cd964", "#9be564", "#ffd447"], divider: "☘ ✦ ☘", mood: "spring" },
    { id: "april", name: "April Showers", glyphs: ["🌷", "🌈", "💧"], particle: "💧", motion: "fall",
      colors: ["#5ec8ff", "#ff8fc7", "#9be564"], divider: "💧 🌷 💧", mood: "rain" },
    { id: "may", name: "May Blooms", glyphs: ["🌸", "🌼", "🦋"], particle: "🌸", motion: "float",
      colors: ["#ff9ecb", "#ffd447", "#b28dff"], divider: "🌸 ✿ 🌸", mood: "bloom" },
    { id: "june", name: "Summer Sunshine", glyphs: ["☀", "🌻", "🐝"], particle: "✦", motion: "rise",
      colors: ["#ffd447", "#ff9f45", "#4dd0e1"], divider: "☀ ✦ ☀", mood: "summer" },
    { id: "july", name: "Stars & Sparklers", glyphs: ["★", "🎆", "✨"], particle: "✦", motion: "rise",
      colors: ["#ff4d5a", "#ffffff", "#4d8dff"], divider: "★ ✦ ★", mood: "fireworks" },
    { id: "august", name: "Golden Sunflowers", glyphs: ["🌻", "🐝", "🌾"], particle: "🌾", motion: "float",
      colors: ["#ffc933", "#ff9f1c", "#8bc34a"], divider: "🌻 ✦ 🌻", mood: "sunflower" },
    { id: "september", name: "Early Harvest", glyphs: ["🍎", "🍂", "📚"], particle: "🍂", motion: "fall",
      colors: ["#ff7043", "#ffb300", "#8bc34a"], divider: "🍎 ✦ 🍂", mood: "harvest" },
    { id: "october", name: "Haunted Halloween", glyphs: ["🎃", "👻", "🕷", "🦇"], particle: "🦇", motion: "float",
      colors: ["#ff8c1a", "#a64dff", "#6bff3d"], divider: "🎃 ✦ 🕸 ✦ 🎃", mood: "halloween" },
    { id: "november", name: "Thanksgiving Harvest", glyphs: ["🍂", "🍁", "🌰", "🎃"], particle: "🍁", motion: "fall",
      colors: ["#ffb300", "#e08a1e", "#c0562b"], divider: "🍂 ✦ 🍁 ✦ 🍂", mood: "thanksgiving" },
    { id: "december", name: "Christmas Lights", glyphs: ["🎄", "⭐", "🎁", "❄"], particle: "❄", motion: "fall",
      colors: ["#ff3b3b", "#2ecc71", "#ffd54f"], divider: "🎄 ✦ ❄ ✦ 🎄", mood: "christmas" }
  ];

  /* ---------- Time & season resolution ---------- */

  function getIndianapolisMonth(date) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE, month: "numeric"
    }).formatToParts(date || new Date());
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "month") return parseInt(parts[i].value, 10);
    }
    return (date || new Date()).getUTCMonth() + 1;
  }

  function seasonFromOverride(value) {
    if (!value) return null;
    var v = String(value).toLowerCase();
    var n = parseInt(v, 10);
    if (n >= 1 && n <= 12 && String(n) === v) return SEASONS[n - 1];
    for (var i = 0; i < SEASONS.length; i++) {
      if (SEASONS[i].id === v) return SEASONS[i];
    }
    return null;
  }

  function getSeason(date, search) {
    var m = /[?&]season=([^&]+)/.exec(search || "");
    var forced = m && seasonFromOverride(decodeURIComponent(m[1]));
    return forced || SEASONS[getIndianapolisMonth(date) - 1];
  }

  /* ---------- Helpers ---------- */

  function esc(s) { return String(s); }

  function rnd(i, salt) {
    var x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  var XMAS = ["#ff3b3b", "#2ecc71", "#ffd54f", "#4fc3ff", "#ffffff", "#ff7ac6"];

  function bulbs(n, offset) {
    var out = "";
    for (var i = 0; i < n; i++) {
      out += '<i class="sx-bulb" style="--c:' + XMAS[(i + offset) % XMAS.length] +
        ";--d:" + (rnd(i + offset, 1) * 2.4).toFixed(2) + "s;--t:" + (1.2 + rnd(i, 2) * 1.8).toFixed(2) + 's"></i>';
    }
    return out;
  }

  function m(slot, cls, html) {
    return '<b class="sx-m sx-' + slot + (cls ? " " + cls : "") + '">' + html + "</b>";
  }

  /* ---------- Card decoration per season ---------- */

  var SLOTS = ["tr", "bl", "br", "tl"];

  function cardMarkup(season, i) {
    var v = i % 4;
    var color = season.colors[i % season.colors.length];
    var html = '<span class="sx-glow" style="--sx-c:' + color + ";--sx-i:" + (i % 7) + '"></span>';
    var g = season.glyphs;

    if (season.mood === "halloween") {
      var layouts = [
        m("tr", "sx-pumpkin", SVG.pumpkin) + m("tl", "sx-web", SVG.web),
        m("br", "sx-pumpkin sx-lg", SVG.pumpkin) + m("tr", "sx-web sx-flip", SVG.web),
        m("tr", "sx-ghost", SVG.ghost) + '<span class="sx-spiderbox sx-s' + (i % 3) + '"><span class="sx-spiderin"><span class="sx-thread"></span>' + SVG.spider + "</span></span>" + m("bl", "sx-web sx-flipy", SVG.web),
        m("tl", "sx-pumpkin", SVG.pumpkin) + m("br", "sx-web sx-flipxy", SVG.web) + '<span class="sx-spiderbox sx-s' + ((i + 1) % 3) + ' sx-left"><span class="sx-spiderin"><span class="sx-thread"></span>' + SVG.spider + "</span></span>"
      ];
      return html + layouts[v];
    }

    if (season.mood === "christmas") {
      var segs = '<span class="sx-lights sx-card-lights"><span class="sx-seg">' + bulbs(4, i) + '</span><span class="sx-seg">' + bulbs(4, i + 4) + "</span></span>";
      var layouts2 = [
        segs + m("br", "", g[3]),
        '<span class="sx-garland">' + SVG.garland + "</span>" + m("tl", "sx-bow", SVG.bow),
        segs + '<span class="sx-orn sx-o' + (i % 3) + '">' + SVG.ornament(XMAS[i % 3]) + "</span>",
        '<span class="sx-garland sx-low">' + SVG.garland + "</span>" + m("tr", "sx-bow", SVG.bow) + m("bl", "", g[1])
      ];
      return html + layouts2[v];
    }

    if (season.mood === "thanksgiving") {
      var set = [
        m("tr", "sx-leaf", g[0]) + m("bl", "sx-leaf sx-sm", g[1]),
        m("tl", "sx-leaf", g[1]) + m("br", "sx-acorn", g[2]),
        m("tr", "sx-acorn", g[2]) + m("bl", "sx-leaf", g[0]) + m("br", "sx-sm", g[3]),
        m("tl", "sx-sm", g[3]) + m("br", "sx-leaf", g[1])
      ];
      return html + set[v];
    }

    var a = g[i % g.length], b = g[(i + 1) % g.length];
    var pair = [
      m("tr", "", a) + m("bl", "sx-sm", b),
      m("tl", "", b) + m("br", "sx-sm", a),
      m("br", "", a) + m("tl", "sx-sm", g[(i + 2) % g.length]),
      m("bl", "", b) + m("tr", "sx-sm", a)
    ];
    return html + pair[v];
  }

  function sectionMarkup(season, i) {
    var edge = i % 2 ? "sx-edge-r" : "sx-edge-l";
    var g = season.glyphs[i % season.glyphs.length];
    var extra = "";
    if (season.mood === "halloween") {
      extra = i % 3 === 0 ? m("tl", "sx-web sx-big", SVG.web) : i % 3 === 1 ? m("tr", "sx-web sx-big sx-flip", SVG.web) : m("br", "sx-pumpkin", SVG.pumpkin);
    } else if (season.mood === "christmas") {
      extra = '<span class="sx-garland sx-wide">' + SVG.garland + "</span>";
    } else {
      extra = m(i % 2 ? "tr" : "tl", "sx-big", g);
    }
    return '<span class="sx-edge ' + edge + '"></span>' + extra;
  }

  function stripMarkup(season, kind) {
    if (season.mood === "christmas") {
      var n = kind === "header" ? 5 : 4;
      var segs = "";
      for (var s = 0; s < n; s++) segs += '<span class="sx-seg">' + bulbs(5, s * 2) + "</span>";
      return '<span class="sx-lights sx-strip">' + segs + "</span>";
    }
    if (season.mood === "halloween") {
      return '<span class="sx-strip sx-glow-strip"></span>' +
        '<span class="sx-m sx-pumpkin sx-sm sx-strip-pumpkin">' + SVG.pumpkin + "</span>" +
        '<span class="sx-m sx-web sx-flip sx-big sx-strip-web">' + SVG.web + "</span>";
    }
    var gl = "";
    for (var i = 0; i < 7; i++) gl += "<em>" + season.glyphs[i % season.glyphs.length] + "</em>";
    return '<span class="sx-strip sx-glyph-strip">' + gl + "</span>";
  }

  /* ---------- Page-level layer ---------- */

  function layerMarkup(season, w, h) {
    var small = w < 700;
    var out = '<div class="sx-frame"></div>';
    var i;

    if (season.mood === "halloween") {
      out += '<div class="sx-fog"></div><div class="sx-moon"></div>';
      var count = Math.max(3, Math.min(14, Math.ceil(w / 130)));
      out += '<div class="sx-row">';
      for (i = 0; i < count; i++) {
        var size = 34 + Math.round(rnd(i, 3) * 26);
        out += '<span class="sx-pumpkin sx-jack" style="--s:' + size + "px;--d:" + (rnd(i, 4) * 3).toFixed(2) + "s;--t:" + (1.4 + rnd(i, 5) * 1.6).toFixed(2) + 's">' + SVG.pumpkin + "</span>";
      }
      out += "</div>";
      out += '<span class="sx-m sx-web sx-page-web sx-tl">' + SVG.web + '</span><span class="sx-m sx-web sx-page-web sx-tr sx-flip">' + SVG.web + "</span>";
      var ghosts = small ? 2 : 4;
      for (i = 0; i < ghosts; i++) {
        out += '<span class="sx-pghost" style="--x:' + (8 + i * (small ? 40 : 24) + rnd(i, 6) * 8).toFixed(0) + "%;--d:" + (i * 4.5) + "s;--t:" + (14 + i * 3) + 's">' + SVG.ghost + "</span>";
      }
      out += '<span class="sx-witch">' + SVG.witch + "</span>";
      out += '<span class="sx-spiderbox sx-page-spider sx-s0" style="left:6%"><span class="sx-spiderin"><span class="sx-thread"></span>' + SVG.spider + "</span></span>";
      out += '<span class="sx-spiderbox sx-page-spider sx-s2" style="right:7%"><span class="sx-spiderin"><span class="sx-thread"></span>' + SVG.spider + "</span></span>";
    }

    if (season.mood === "christmas") {
      var perRow = Math.max(8, Math.min(34, Math.floor(w / 40)));
      var perCol = Math.max(5, Math.min(18, Math.floor(h / 48)));
      out += '<div class="sx-lights sx-edge-top">' + bulbs(perRow, 0) + "</div>";
      out += '<div class="sx-lights sx-edge-bottom">' + bulbs(perRow, 3) + "</div>";
      if (!small) {
        out += '<div class="sx-lights sx-edge-left">' + bulbs(perCol, 1) + "</div>";
        out += '<div class="sx-lights sx-edge-right">' + bulbs(perCol, 5) + "</div>";
      }
      var orn = small ? 2 : 4;
      for (i = 0; i < orn; i++) {
        out += '<span class="sx-orn sx-page-orn sx-o' + (i % 3) + '" style="left:' + (i % 2 ? 100 - 4 - i * 4 : 4 + i * 4) + "%;--len:" + (30 + i * 14) + 'px">' + SVG.ornament(XMAS[(i + 1) % 6]) + "</span>";
      }
      out += '<span class="sx-garland sx-page-garland">' + SVG.garland + "</span>";
    }

    var n = small ? 8 : 16;
    var p = "";
    for (i = 0; i < n; i++) {
      var x = (rnd(i, 7) * 100).toFixed(1);
      var sz = (0.7 + rnd(i, 8) * 0.9).toFixed(2);
      var dur = (10 + rnd(i, 9) * 14).toFixed(1);
      var delay = (-rnd(i, 10) * 20).toFixed(1);
      p += '<i class="sx-p sx-' + season.motion + '" style="--x:' + x + "%;--s:" + sz + "rem;--dur:" + dur + "s;--dl:" + delay + "s;--sw:" + (10 + rnd(i, 11) * 40).toFixed(0) + 'px">' + esc(season.particle) + "</i>";
    }
    out += '<div class="sx-particles">' + p + "</div>";
    return out;
  }

  /* ---------- Engine ---------- */

  function createState() {
    return { season: null, cardIndex: 0, observer: null, timer: null, resizeTimer: null, width: 0 };
  }

  function readMotionPref(win) {
    try { return win.localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function writeMotionPref(win, value) {
    try { win.localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* storage unavailable */ }
  }

  function prefersReducedMotion(win) {
    return !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function computeMotion(win) {
    if (prefersReducedMotion(win)) return "off";
    return readMotionPref(win) === "off" ? "off" : "on";
  }

  function add(doc, parent, className, html, tag) {
    var el = doc.createElement(tag || "span");
    el.className = className;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = html;
    parent.appendChild(el);
    return el;
  }

  function clearDecorations(doc) {
    var nodes = doc.querySelectorAll(".sx-deco, .sx-layer");
    for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
    var marked = doc.querySelectorAll("[data-sx]");
    for (var j = 0; j < marked.length; j++) marked[j].removeAttribute("data-sx");
  }

  function decorate(doc, season, state) {
    var i, list, el;
    state = state || createState();

    list = doc.querySelectorAll(CARD_SELECTOR);
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (el.getAttribute("data-sx")) continue;
      el.setAttribute("data-sx", "card");
      add(doc, el, "sx-deco sx-card-deco", cardMarkup(season, state.cardIndex++));
    }

    list = doc.querySelectorAll(SECTION_SELECTOR);
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (el.getAttribute("data-sx")) continue;
      el.setAttribute("data-sx", "section");
      add(doc, el, "sx-deco sx-section-deco", sectionMarkup(season, i));
    }

    list = doc.querySelectorAll(HEADING_SELECTOR);
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (el.getAttribute("data-sx")) continue;
      el.setAttribute("data-sx", "heading");
      var div = add(doc, el, "sx-deco sx-divider", esc(season.divider));
      div.style.setProperty("--sx-c", season.colors[i % season.colors.length]);
    }

    list = doc.querySelectorAll(HEADER_SELECTOR);
    for (i = 0; i < list.length; i++) {
      if (list[i].getAttribute("data-sx")) continue;
      list[i].setAttribute("data-sx", "header");
      add(doc, list[i], "sx-deco sx-header-deco", stripMarkup(season, "header"));
    }

    list = doc.querySelectorAll(FOOTER_SELECTOR);
    for (i = 0; i < list.length; i++) {
      if (list[i].getAttribute("data-sx")) continue;
      list[i].setAttribute("data-sx", "footer");
      add(doc, list[i], "sx-deco sx-footer-deco", stripMarkup(season, "footer"));
    }

    list = doc.querySelectorAll(SOCIAL_SELECTOR);
    for (i = 0; i < list.length; i++) {
      if (list[i].getAttribute("data-sx")) continue;
      list[i].setAttribute("data-sx", "social");
      add(doc, list[i], "sx-deco sx-social-deco", esc(season.glyphs[i % season.glyphs.length]));
    }
    return state;
  }

  function buildLayer(doc, win, season) {
    var old = doc.querySelector(".sx-layer");
    if (old) old.parentNode.removeChild(old);
    var layer = doc.createElement("div");
    layer.className = "sx-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = layerMarkup(season, win.innerWidth || 1024, win.innerHeight || 768);
    doc.body.appendChild(layer);
  }

  function applySeason(doc, win, season, state) {
    var html = doc.documentElement;
    clearDecorations(doc);
    state.season = season;
    state.cardIndex = 0;
    html.setAttribute("data-season", season.id);
    html.setAttribute("data-sx-mood", season.mood);
    html.style.setProperty("--sx-a", season.colors[0]);
    html.style.setProperty("--sx-b", season.colors[1]);
    html.style.setProperty("--sx-c3", season.colors[2]);
    buildLayer(doc, win, season);
    decorate(doc, season, state);
    updateToggle(doc, html.getAttribute("data-sx-motion"), win);
  }

  function updateToggle(doc, motion, win) {
    var btn = doc.querySelector(".sx-toggle");
    if (!btn) return;
    var forced = prefersReducedMotion(win);
    btn.setAttribute("aria-pressed", motion === "on" ? "true" : "false");
    btn.disabled = forced;
    btn.textContent = forced ? "Seasonal animations off (system setting)" :
      motion === "on" ? "Seasonal animations: On" : "Seasonal animations: Off";
  }

  function setMotion(doc, win, motion, persist) {
    doc.documentElement.setAttribute("data-sx-motion", motion);
    if (persist) writeMotionPref(win, motion);
    updateToggle(doc, motion, win);
  }

  function init(doc, win) {
    if (!doc || !doc.body) return null;
    if (doc.documentElement.hasAttribute("data-sx-ready")) return doc.__rffSeasonalState;
    var state = createState();
    doc.__rffSeasonalState = state;
    doc.documentElement.setAttribute("data-sx-ready", "true");

    doc.documentElement.setAttribute("data-sx-motion", computeMotion(win));
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "sx-toggle";
    btn.addEventListener("click", function () {
      var next = doc.documentElement.getAttribute("data-sx-motion") === "on" ? "off" : "on";
      setMotion(doc, win, next, true);
    });
    doc.body.appendChild(btn);

    applySeason(doc, win, getSeason(new Date(), win.location && win.location.search), state);
    state.width = win.innerWidth || 0;

    // Tappable Christmas bulbs.
    doc.addEventListener("click", function (e) {
      var bulb = e.target && e.target.closest && e.target.closest(".sx-bulb");
      if (!bulb) return;
      bulb.classList.add("sx-on");
      win.setTimeout(function () { bulb.classList.remove("sx-on"); }, 1100);
    });

    // Decorate cards injected after load.
    if (win.MutationObserver) {
      var pending = false;
      state.observer = new win.MutationObserver(function (records) {
        var relevant = false;
        for (var i = 0; i < records.length && !relevant; i++) {
          for (var j = 0; j < records[i].addedNodes.length; j++) {
            var n = records[i].addedNodes[j];
            if (n.nodeType === 1 && !(n.classList && (n.classList.contains("sx-deco") || n.classList.contains("sx-layer") || n.classList.contains("sx-toggle")))) {
              relevant = true;
              break;
            }
          }
        }
        if (!relevant || pending) return;
        pending = true;
        win.setTimeout(function () {
          pending = false;
          decorate(doc, state.season, state);
        }, 0);
      });
      state.observer.observe(doc.body, { childList: true, subtree: true });
    }

    // Month rollover while the page is open, and responsive rebuild.
    state.timer = win.setInterval(function () {
      var next = getSeason(new Date(), win.location && win.location.search);
      if (next.id !== state.season.id) applySeason(doc, win, next, state);
    }, 60000);

    win.addEventListener("resize", function () {
      win.clearTimeout(state.resizeTimer);
      state.resizeTimer = win.setTimeout(function () {
        var w = win.innerWidth || 0;
        if (Math.abs(w - state.width) > 80) {
          state.width = w;
          buildLayer(doc, win, state.season);
        }
      }, 250);
    });

    var mq = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function () {
        setMotion(doc, win, computeMotion(win), false);
      });
    }
    return state;
  }

  return {
    TIMEZONE: TIMEZONE,
    STORAGE_KEY: STORAGE_KEY,
    SEASONS: SEASONS,
    MONTH_NAMES: MONTH_NAMES,
    CARD_SELECTOR: CARD_SELECTOR,
    SECTION_SELECTOR: SECTION_SELECTOR,
    HEADING_SELECTOR: HEADING_SELECTOR,
    getIndianapolisMonth: getIndianapolisMonth,
    getSeason: getSeason,
    computeMotion: computeMotion,
    applySeason: applySeason,
    decorate: decorate,
    createState: createState,
    init: init
  };
});
