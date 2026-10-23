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
  var CARD_SELECTOR = [
    ".portal-card", ".mission-card", ".crypto-card", ".daily-prayer-card",
    ".warning-box", ".privacy-banner", ".generated-id", ".result",
    ".form-section", ".lifeline-monitor", ".demo-notice", ".mission-note", ".mission-details"
  ].join(",");
  var SECTION_SELECTOR = [
    ".hero", ".section", ".intro", ".portal", ".mission-section",
    ".mission-hero", ".contact-section", ".crypto-section",
    ".daily-prayer-section", ".lifeline", ".trust-strip", ".process"
  ].join(",");
  var HEADING_SELECTOR = ".section-heading, .application-heading, .contact-section > h2, .mission-hero h1";
  var HEADER_SELECTOR = ".site-header";
  var FOOTER_SELECTOR = "footer";
  var SOCIAL_SELECTOR = ".footer-social";

  var MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];

  /* ---------- SVG motifs ---------- */

  /* Corner cobweb: radial threads plus sagging concentric strands and dew drops. */
  function buildWeb() {
    var radials = 6, radii = [9, 17, 26, 37, 50], R = 62, d = "", i, k;
    function pt(r, a) { return (r * Math.cos(a)).toFixed(1) + " " + (r * Math.sin(a)).toFixed(1); }
    for (i = 0; i < radials; i++) {
      var a = (Math.PI / 2) * i / (radials - 1);
      d += "M0 0L" + pt(R, a);
    }
    var arcs = "", dew = "";
    for (k = 0; k < radii.length; k++) {
      for (i = 0; i < radials - 1; i++) {
        var a0 = (Math.PI / 2) * i / (radials - 1), a1 = (Math.PI / 2) * (i + 1) / (radials - 1);
        var mid = (a0 + a1) / 2, sag = radii[k] * (0.8 + 0.03 * ((i + k) % 3));
        arcs += (i === 0 ? "M" + pt(radii[k], a0) : "") + "Q" + pt(sag, mid) + " " + pt(radii[k], a1);
      }
      dew += '<circle cx="' + (radii[k] * 0.78).toFixed(1) + '" cy="' + (radii[k] * 0.42 + 2).toFixed(1) + '" r="1.1"/>';
    }
    return '<svg viewBox="0 0 64 64" focusable="false" fill="none" stroke="currentColor" stroke-linecap="round">' +
      '<path stroke-width=".9" d="' + d + '"/><path stroke-width=".6" d="' + arcs + '"/>' +
      '<g fill="#fff" stroke="none" opacity=".8">' + dew + "</g></svg>";
  }

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
    web: buildWeb(),
    spider:
      '<svg viewBox="0 0 24 22" focusable="false"><g stroke="#cdb6ff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55">' +
      '<path d="M8 10L2 4M8 12L1 12M9 14L3 20M16 10L22 4M16 12L23 12M15 14L21 20"/></g>' +
      '<g stroke="#120818" stroke-width="1.4" fill="none" stroke-linecap="round">' +
      '<path d="M8 10L2 4M8 12L1 12M9 14L3 20M16 10L22 4M16 12L23 12M15 14L21 20"/></g>' +
      '<ellipse cx="12" cy="14" rx="5.5" ry="6.5" fill="#120818" stroke="#cdb6ff" stroke-width=".9"/>' +
      '<circle cx="12" cy="7" r="3.4" fill="#120818" stroke="#cdb6ff" stroke-width=".9"/>' +
      '<circle cx="10.8" cy="6.6" r="1" fill="#ff4d4d"/><circle cx="13.2" cy="6.6" r="1" fill="#ff4d4d"/>' +
      '<path d="M12 11v6" stroke="#ff8c1a" stroke-width="1.4"/></svg>',
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

  var XMAS = ["#ff3b3b", "#2ecc71", "#4aa8ff", "#ffd54f", "#ff7ac6", "#fff1c9"];

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

  /* ---------- Card decoration per season ----------
   * Every motif is anchored to a corner or a side border and is small enough
   * to sit mostly on the border line, so it stays in the card's padding. */


  /* ---------- Christmas perimeter lights ----------
   * One SVG per card traces the card's real size and border radius: a wire plus evenly
   * spaced bulbs on all four sides. Rebuilt whenever the card is resized. */
  var LIGHT_GAP = 22, LIGHT_OUT = 4, LIGHT_PAD = 13;

  function perimeterPoint(s, W, H, R, x0, y0) {
    var top = W - 2 * R, side = H - 2 * R, arc = Math.PI * R / 2;
    var segs = [top, arc, side, arc, top, arc, side, arc], k = 0, t, a;
    while (k < 7 && s > segs[k]) { s -= segs[k]; k++; }
    t = segs[k] ? s / segs[k] : 0;
    switch (k) {
      case 0: return [x0 + R + t * top, y0, 0, -1];
      case 2: return [x0 + W, y0 + R + t * side, 1, 0];
      case 4: return [x0 + W - R - t * top, y0 + H, 0, 1];
      case 6: return [x0, y0 + H - R - t * side, -1, 0];
      default:
        a = t * Math.PI / 2;
        var cx = [x0 + W - R, x0 + W - R, x0 + R, x0 + R][(k - 1) / 2];
        var cy = [y0 + R, y0 + H - R, y0 + H - R, y0 + R][(k - 1) / 2];
        var base = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][(k - 1) / 2] + a;
        return [cx + R * Math.cos(base), cy + R * Math.sin(base), Math.cos(base), Math.sin(base)];
    }
  }

  function lightsSvg(w, h, radius, seed) {
    var e = LIGHT_OUT, P = LIGHT_PAD;
    var R = Math.max(2, Math.min(radius + e, (w + 2 * e) / 2, (h + 2 * e) / 2));
    var W = w + 2 * e, H = h + 2 * e, x0 = P - e, y0 = P - e;
    var len = 2 * (W - 2 * R) + 2 * (H - 2 * R) + 2 * Math.PI * R;
    var n = Math.max(8, Math.round(len / LIGHT_GAP)), step = len / n, i;
    var wire = "M" + (x0 + R) + " " + y0 + "H" + (x0 + W - R) + "A" + R + " " + R + " 0 0 1 " + (x0 + W) + " " + (y0 + R) +
      "V" + (y0 + H - R) + "A" + R + " " + R + " 0 0 1 " + (x0 + W - R) + " " + (y0 + H) + "H" + (x0 + R) +
      "A" + R + " " + R + " 0 0 1 " + x0 + " " + (y0 + H - R) + "V" + (y0 + R) + "A" + R + " " + R + " 0 0 1 " + (x0 + R) + " " + y0 + "Z";
    var out = '<svg class="sx-perim-svg" width="' + (w + 2 * P) + '" height="' + (h + 2 * P) + '" viewBox="0 0 ' + (w + 2 * P) + " " + (h + 2 * P) +
      '" focusable="false"><path class="sx-wire" d="' + wire + '"/>';
    for (i = 0; i < n; i++) {
      var q = perimeterPoint(step * (i + 0.5), W, H, R, x0, y0);
      var c = XMAS[(i + seed) % XMAS.length], kind = ["sx-k0", "sx-k1", "sx-k2"][(i + seed) % 3];
      var bx = q[0] + q[2] * 3, by = q[1] + q[3] * 3;
      var d = (rnd(i + seed, 1) * 2.6).toFixed(2), t = (1.3 + rnd(i + seed, 2) * 2).toFixed(2);
      out += '<g class="sx-pb ' + kind + '" style="--c:' + c + ";--d:-" + d + "s;--t:" + t + 's">' +
        '<line class="sx-cap" x1="' + q[0].toFixed(1) + '" y1="' + q[1].toFixed(1) + '" x2="' + bx.toFixed(1) + '" y2="' + by.toFixed(1) + '"/>' +
        '<circle class="sx-halo" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="6"/>' +
        '<circle class="sx-core" cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="3"/></g>';
    }
    return out + "</svg>";
  }

  function buildCardLights(host, win) {
    var card = host.parentNode;
    if (!card) return;
    var w = card.offsetWidth || 320, h = card.offsetHeight || 160;
    if (host.__sxw === w && host.__sxh === h) return;
    var radius = 12;
    if (win.getComputedStyle) {
      var r = parseFloat(win.getComputedStyle(card).borderTopLeftRadius);
      if (r >= 0) radius = r;
    }
    host.__sxw = w; host.__sxh = h;
    host.innerHTML = lightsSvg(w, h, radius, host.__sxseed || 0);
  }

  function lightCards(doc, win, state) {
    var list = doc.querySelectorAll('[data-sx="card"]');
    for (var i = 0; i < list.length; i++) {
      var card = list[i];
      if (card.__sxLit) continue;
      var up = card.parentElement && card.parentElement.closest(CARD_SELECTOR);
      if (up) continue; // nested cards share the outer card's strand
      card.__sxLit = true;
      var host = doc.createElement("span");
      host.className = "sx-deco sx-perim";
      host.setAttribute("aria-hidden", "true");
      host.__sxseed = i;
      card.appendChild(host);
      buildCardLights(host, win);
      if (win.ResizeObserver) {
        if (!state.ro) {
          state.ro = new win.ResizeObserver(function (entries) {
            for (var k = 0; k < entries.length; k++) {
              var hst = entries[k].target.__sxHost;
              if (hst && hst.parentNode) buildCardLights(hst, win);
            }
          });
        }
        card.__sxHost = host;
        state.ro.observe(card);
      }
    }
  }

  function spiderMarkup(side, i) {
    return '<span class="sx-spiderbox sx-' + side + " sx-s" + (i % 3) + '"><span class="sx-spiderin"><span class="sx-thread"></span>' + SVG.spider + "</span></span>";
  }

  function cardMarkup(season, i) {
    var v = i % 4;
    var color = season.colors[i % season.colors.length];
    var html = '<span class="sx-glow" style="--sx-c:' + color + ";--sx-i:" + (i % 7) + '"></span>';
    var g = season.glyphs;

    if (season.mood === "halloween") {
      var h = [
        m("tl", "sx-web", SVG.web) + m("tr", "sx-pumpkin", SVG.pumpkin) + m("bl", "sx-pumpkin", SVG.pumpkin) + spiderMarkup("left", i),
        m("tr", "sx-web", SVG.web) + m("tl", "sx-pumpkin", SVG.pumpkin) + m("br", "sx-pumpkin", SVG.pumpkin) + m("bl", "sx-ghost", SVG.ghost) + spiderMarkup("right", i),
        m("tl", "sx-web", SVG.web) + m("tr", "sx-pumpkin", SVG.pumpkin) + m("br", "sx-pumpkin", SVG.pumpkin) + spiderMarkup("left", i),
        m("tr", "sx-web", SVG.web) + m("tl", "sx-pumpkin", SVG.pumpkin) + m("bl", "sx-pumpkin", SVG.pumpkin) + m("br", "sx-ghost", SVG.ghost) + spiderMarkup("right", i)
      ];
      return html + h[v];
    }

    if (season.mood === "christmas") {
      var segs = "";
      var c = [
        segs + m("br", "", g[3]),
        '<span class="sx-garland">' + SVG.garland + "</span>" + m("tl", "sx-bow", SVG.bow),
        segs + '<span class="sx-orn sx-o' + (i % 3) + '">' + SVG.ornament(XMAS[i % 3]) + "</span>",
        '<span class="sx-garland sx-low">' + SVG.garland + "</span>" + m("tr", "sx-bow", SVG.bow) + m("bl", "", g[1])
      ];
      return html + c[v];
    }

    if (season.mood === "thanksgiving") {
      var t = [
        m("tr", "sx-leaf", g[0]) + m("bl", "sx-leaf sx-sm", g[1]),
        m("tl", "sx-leaf", g[1]) + m("br", "sx-acorn", g[2]),
        m("tr", "sx-acorn", g[2]) + m("bl", "sx-leaf", g[0]) + m("br", "sx-sm", g[3]),
        m("tl", "sx-sm", g[3]) + m("br", "sx-leaf", g[1])
      ];
      return html + t[v];
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

  /* Sections only get an edge accent (plus a slim garland); never corner art over copy. */
  function sectionMarkup(season, i) {
    var edge = i % 2 ? "sx-edge-r" : "sx-edge-l";
    var out = '<span class="sx-edge ' + edge + '"></span>';
    if (season.mood === "christmas") out += '<span class="sx-garland sx-wide">' + SVG.garland + "</span>";
    return out;
  }

  /* Header and footer motifs sit on the border line between bar and page. */
  function stripMarkup(season, kind) {
    var i, out = "";
    if (season.mood === "christmas") {
      var n = kind === "header" ? 5 : 4;
      for (i = 0; i < n; i++) out += '<span class="sx-seg">' + bulbs(5, i * 2) + "</span>";
      return '<span class="sx-lights sx-strip">' + out + "</span>";
    }
    if (season.mood === "halloween") {
      var spots = kind === "header" ? [34, 62, 88] : [8, 26, 44, 62, 80, 94];
      for (i = 0; i < spots.length; i++) {
        out += '<b class="sx-m sx-pumpkin sx-edge-pumpkin" style="--px:' + spots[i] + '%;--pd:' + (i * 0.4).toFixed(1) + 's">' + SVG.pumpkin + "</b>";
      }
      return '<span class="sx-strip sx-glow-strip"></span>' + out;
    }
    var gl = "";
    for (i = 0; i < 7; i++) gl += "<em>" + season.glyphs[i % season.glyphs.length] + "</em>";
    return '<span class="sx-strip sx-glyph-strip">' + gl + "</span>";
  }

  /* ---------- Page-level layers ----------
   * back: drifting ghosts, witch, fog, particles - painted behind all content.
   * front: thin frame glow and (Christmas) edge light strings in the gutters. */

  function backMarkup(season, w) {
    var small = w < 700, out = "", i;
    if (season.mood === "halloween") {
      out += '<div class="sx-fog"></div><div class="sx-moon"></div>';
      var ghosts = small ? 2 : 4;
      for (i = 0; i < ghosts; i++) {
        out += '<span class="sx-pghost" style="--x:' + (8 + i * (small ? 40 : 24) + rnd(i, 6) * 8).toFixed(0) + "%;--d:" + (i * 4.5) + "s;--t:" + (14 + i * 3) + 's">' + SVG.ghost + "</span>";
      }
      out += '<span class="sx-witch">' + SVG.witch + "</span>";
    }
    var n = small ? 8 : 16, p = "";
    for (i = 0; i < n; i++) {
      p += '<i class="sx-p sx-' + season.motion + '" style="--x:' + (rnd(i, 7) * 100).toFixed(1) + "%;--s:" + (0.7 + rnd(i, 8) * 0.9).toFixed(2) + "rem;--dur:" + (10 + rnd(i, 9) * 14).toFixed(1) + "s;--dl:" + (-rnd(i, 10) * 20).toFixed(1) + "s;--sw:" + (10 + rnd(i, 11) * 40).toFixed(0) + 'px">' + esc(season.particle) + "</i>";
    }
    return out + '<div class="sx-particles">' + p + "</div>";
  }

  function frontMarkup(season, w, h) {
    var out = '<div class="sx-frame"></div>';
    if (season.mood === "christmas") {
      var perRow = Math.max(8, Math.min(34, Math.floor(w / 40)));
      out += '<div class="sx-lights sx-edge-top">' + bulbs(perRow, 0) + "</div>";
      if (w >= 1100) {
        var perCol = Math.max(5, Math.min(18, Math.floor(h / 48)));
        out += '<div class="sx-lights sx-edge-left">' + bulbs(perCol, 1) + "</div>";
        out += '<div class="sx-lights sx-edge-right">' + bulbs(perCol, 5) + "</div>";
      }
    }
    return out;
  }

  /* ---------- Engine ---------- */

  function createState() {
    return { season: null, cardIndex: 0, observer: null, timer: null, resizeTimer: null, width: 0 };
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
    for (var j = 0; j < marked.length; j++) { marked[j].removeAttribute("data-sx"); marked[j].__sxLit = false; marked[j].__sxHost = null; }
  }

  function decorate(doc, season, state, win) {
    var i, list, el;
    state = state || createState();

    list = doc.querySelectorAll(CARD_SELECTOR);
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (el.getAttribute("data-sx")) continue;
      el.setAttribute("data-sx", "card");
      add(doc, el, "sx-deco sx-card-deco", cardMarkup(season, state.cardIndex++));
    }

    if (season.mood === "christmas" && win) lightCards(doc, win, state);

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
    var old = doc.querySelectorAll(".sx-layer");
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    var w = win.innerWidth || 1024, h = win.innerHeight || 768;
    var back = doc.createElement("div");
    back.className = "sx-layer sx-back";
    back.setAttribute("aria-hidden", "true");
    back.innerHTML = backMarkup(season, w);
    var front = doc.createElement("div");
    front.className = "sx-layer sx-front";
    front.setAttribute("aria-hidden", "true");
    front.innerHTML = frontMarkup(season, w, h);
    doc.body.appendChild(back);
    doc.body.appendChild(front);
  }

  function applySeason(doc, win, season, state) {
    var html = doc.documentElement;
    if (state.ro) { state.ro.disconnect(); state.ro = null; }
    clearDecorations(doc);
    state.season = season;
    state.cardIndex = 0;
    html.setAttribute("data-season", season.id);
    html.setAttribute("data-sx-mood", season.mood);
    html.style.setProperty("--sx-a", season.colors[0]);
    html.style.setProperty("--sx-b", season.colors[1]);
    html.style.setProperty("--sx-c3", season.colors[2]);
    buildLayer(doc, win, season);
    decorate(doc, season, state, win);
  }

  function init(doc, win) {
    if (!doc || !doc.body) return null;
    if (doc.documentElement.hasAttribute("data-sx-ready")) return doc.__rffSeasonalState;
    var state = createState();
    doc.__rffSeasonalState = state;
    doc.documentElement.setAttribute("data-sx-ready", "true");

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
            if (n.nodeType === 1 && !(n.classList && (n.classList.contains("sx-deco") || n.classList.contains("sx-layer")))) {
              relevant = true;
              break;
            }
          }
        }
        if (!relevant || pending) return;
        pending = true;
        win.setTimeout(function () {
          pending = false;
          decorate(doc, state.season, state, win);
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
        var lit = doc.querySelectorAll(".sx-perim");
        for (var q = 0; q < lit.length; q++) buildCardLights(lit[q], win);
        var w = win.innerWidth || 0;
        if (Math.abs(w - state.width) > 80) {
          state.width = w;
          buildLayer(doc, win, state.season);
        }
      }, 250);
    });

    return state;
  }

  return {
    TIMEZONE: TIMEZONE,
    SEASONS: SEASONS,
    MONTH_NAMES: MONTH_NAMES,
    CARD_SELECTOR: CARD_SELECTOR,
    SECTION_SELECTOR: SECTION_SELECTOR,
    HEADING_SELECTOR: HEADING_SELECTOR,
    getIndianapolisMonth: getIndianapolisMonth,
    getSeason: getSeason,
    applySeason: applySeason,
    decorate: decorate,
    createState: createState,
    init: init
  };
});
