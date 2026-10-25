/* Recovery Forward Foundation - interactive card explorer.
   Progressive enhancement: markup is real <button> triggers plus detail panels.
   Without JS the panels are shown by a <noscript> rule on each page. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.RFFCards = api;
    var start = function () { api.init(root.document, root); };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var ICONS = {
    heart: "M12 20.5s-8-4.9-9.5-10A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9.5 3.9c-1.5 5.1-9.5 10-9.5 10z",
    pulse: "M12 20.5s-8-4.9-9.5-10A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9.5 3.9c-1.5 5.1-9.5 10-9.5 10z M6 12h3l1.5-3 2 5 1.5-2H18",
    book: "M3 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H3z M21 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z",
    home: "M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10",
    briefcase: "M3 8h18v12H3z M9 8V5h6v3 M3 13h18",
    people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M17 11a2.5 2.5 0 1 0 0-5 M17.5 14c2.5.4 4 2.4 4 5",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
    lock: "M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3",
    sprout: "M12 21v-9 M12 12c0-4 3-6 7-6 0 4-3 6-7 6z M12 15c0-3-2-5-6-5 0 3 2 5 6 5z",
    sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2",
    road: "M9 3L5 21 M15 3l4 18 M12 4v3 M12 10v4 M12 17v3",
    doc: "M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7",
    id: "M3 6h18v12H3z M7 10h5 M7 14h3 M16 11a2 2 0 1 0 0 .01",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5",
    check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 12l3 3 5-6",
    flag: "M5 21V4 M5 4h12l-2 4 2 4H5",
    compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M15.5 8.5l-2 5-5 2 2-5z",
    mail: "M3 5h18v14H3z M3 6l9 7 9-7",
    gift: "M3 11h18v10H3z M2 7h20v4H2z M12 7v14 M12 7c-2-4-6-3-5 0 M12 7c2-4 6-3 5 0",
    megaphone: "M3 10v4h4l8 4V6L7 10z M18 9a4 4 0 0 1 0 6",
    scale: "M12 3v18 M6 21h12 M4 7h16 M5 7l-3 7a3 3 0 0 0 6 0z M19 7l-3 7a3 3 0 0 0 6 0z",
    chart: "M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18",
    car: "M3 14l2-6h14l2 6v4H3z M3 14h18 M7 18v2 M17 18v2",
    grad: "M2 9l10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5",
    clipboard: "M8 4h8v3H8z M6 5H5v16h14V5h-1 M9 12h6 M9 16h4",
    sign: "M12 3v18 M5 6h11l3 2.5-3 2.5H5z M19 14H8l-3 2 3 2h11z",
    star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    loop: "M20 12a8 8 0 1 1-3-6.2 M20 4v5h-5",
    bank: "M3 10l9-6 9 6z M5 10v8 M9 10v8 M15 10v8 M19 10v8 M3 21h18",
    calendar: "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4"
  };

  function svgFor(name) {
    var d = ICONS[name] || ICONS.star;
    return '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function reduced(win) {
    return !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function parts(ex) {
    var grid = ex.querySelector(".rff-grid");
    var cards = Array.prototype.slice.call(grid.querySelectorAll(":scope > .rff-card"));
    return { grid: grid, cards: cards };
  }

  /* Panels span the full grid row. CSS order puts the open panel right after the last
     card of the row that holds the clicked card, so it always sits next to its card. */
  function place(ex) {
    var p = parts(ex);
    var n = p.cards.length;
    if (!n) return;
    var top0 = p.cards[0].offsetTop;
    var cols = 0;
    while (cols < n && p.cards[cols].offsetTop === top0) cols++;
    cols = Math.max(cols, 1);
    p.cards.forEach(function (card, i) {
      card.style.order = String(i * 2);
      var panel = panelFor(card);
      if (!panel) return;
      var rowEnd = Math.min(n - 1, (Math.floor(i / cols) + 1) * cols - 1);
      panel.style.order = String(rowEnd * 2 + 1);
    });
  }

  function triggerOf(card) { return card.querySelector(".rff-trigger"); }

  function panelFor(card) {
    var t = triggerOf(card);
    var id = t && t.getAttribute("aria-controls");
    return id ? card.ownerDocument.getElementById(id) : null;
  }

  function setOpen(ex, card, open, win, opts) {
    var t = triggerOf(card);
    var panel = panelFor(card);
    if (!t || !panel || t.tagName === "A") return;
    card.setAttribute("data-open", open ? "true" : "false");
    t.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (open) {
      place(ex);
      if (opts && opts.scroll !== false && panel.scrollIntoView) {
        var rect = panel.getBoundingClientRect();
        var vh = win.innerHeight || 800;
        if (rect.bottom > vh || rect.top < 0) {
          panel.scrollIntoView({ block: "nearest", behavior: reduced(win) ? "auto" : "smooth" });
        }
      }
    }
  }

  function closeAll(ex, win, except) {
    parts(ex).cards.forEach(function (card) {
      if (card !== except && card.getAttribute("data-open") === "true") setOpen(ex, card, false, win);
    });
  }

  function toggle(ex, card, win) {
    var willOpen = card.getAttribute("data-open") !== "true";
    closeAll(ex, win, willOpen ? card : null);
    setOpen(ex, card, willOpen, win, { scroll: true });
  }

  function enhance(ex, doc, win) {
    if (ex.__rffReady) return;
    ex.__rffReady = true;
    var p = parts(ex);

    p.cards.forEach(function (card) {
      var holder = card.querySelector(".rff-icon");
      if (holder && !holder.firstChild) holder.innerHTML = svgFor(card.getAttribute("data-icon"));
      var panel = panelFor(card);
      if (panel) {
        panel.hidden = true;
        if (!panel.getAttribute("data-tone")) panel.setAttribute("data-tone", card.getAttribute("data-tone") || "blue");
      }
      card.setAttribute("data-open", "false");
    });

    ex.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".rff-trigger, .rff-close") : null;
      if (!t || !ex.contains(t)) return;
      if (t.classList.contains("rff-close")) {
        var panel = t.closest(".rff-panel");
        var owner = p.cards.filter(function (c) { return panelFor(c) === panel; })[0];
        if (owner) { setOpen(ex, owner, false, win); triggerOf(owner).focus(); }
        return;
      }
      if (t.tagName === "A") return;
      var card = t.closest(".rff-card");
      if (card) toggle(ex, card, win);
    });

    ex.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var panel = e.target.closest ? e.target.closest(".rff-panel") : null;
      var owner = panel && p.cards.filter(function (c) { return panelFor(c) === panel; })[0];
      if (!owner && e.target.closest) {
        var c = e.target.closest(".rff-card");
        if (c && c.getAttribute("data-open") === "true") owner = c;
      }
      if (owner) { setOpen(ex, owner, false, win); triggerOf(owner).focus(); }
    });

    place(ex);
  }

  function openFromHash(doc, win) {
    var id = (win.location && win.location.hash || "").slice(1);
    if (!id) return;
    var t = doc.getElementById(id);
    var card = t && t.closest && t.closest(".rff-card");
    var ex = card && card.closest(".rff-explorer");
    if (ex && ex.__rffReady) { closeAll(ex, win, card); setOpen(ex, card, true, win, { scroll: false }); }
  }

  function init(doc, win) {
    doc = doc || document;
    win = win || window;
    var list = doc.querySelectorAll("[data-rff-explorer]");
    for (var i = 0; i < list.length; i++) enhance(list[i], doc, win);
    if (!doc.__rffBound) {
      doc.__rffBound = true;
      var timer;
      win.addEventListener("resize", function () {
        win.clearTimeout(timer);
        timer = win.setTimeout(function () {
          var all = doc.querySelectorAll("[data-rff-explorer]");
          for (var k = 0; k < all.length; k++) if (all[k].__rffReady) place(all[k]);
        }, 120);
      });
      win.addEventListener("hashchange", function () { openFromHash(doc, win); });
    }
    openFromHash(doc, win);
    return { explorers: list.length };
  }

  return { init: init, ICONS: ICONS, svgFor: svgFor };
});


/* Interactive illustrated Programs poster */
(function () {
  function initialize() {
    const figure = document.querySelector(".rff-hotspot-figure");
    const dialog = document.getElementById("rff-home-picture-dialog");
    if (!figure || !dialog) return;

    const heading = document.getElementById("rff-picture-dialog-title");
    const body = document.getElementById("rff-picture-dialog-body");
    let selected = null;

    figure.querySelectorAll(".rff-poster-hotspot").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.dataset.panel;
        const panel = document.getElementById("focus-areas-" + key + "-panel");

        heading.textContent = button.getAttribute("aria-label");
        body.replaceChildren();

        if (panel) {
          const copy = panel.cloneNode(true);
          copy.hidden = false;
          copy.removeAttribute("id");
          copy.removeAttribute("role");
          copy.removeAttribute("aria-labelledby");
          copy.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
          body.replaceChildren(...Array.from(copy.childNodes));
        } else if (key === "communities") {
          const paragraph = document.createElement("p");
          paragraph.textContent =
            "Recovery Forward Foundation aims to build stronger communities through supportive relationships, partnerships, and opportunities for lasting recovery.";
          body.append(paragraph);
        }

        selected = button;
        dialog.showModal();
      });
    });

    dialog.addEventListener("click", function (event) {
      const button = event.target.closest("button");
      if (!button || !dialog.contains(button)) return;

      const label = (
        button.getAttribute("aria-label") ||
        button.textContent ||
        ""
      ).trim().toLowerCase();

      if (
        button.matches(".rff-picture-close, .rff-close, [data-rff-close]") ||
        label === "close" ||
        label === "×"
      ) {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
      }
    }, true);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (selected) selected.focus();
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", initialize);
    else initialize();
  }
})();


/* Interactive Mission poster */
(function () {
  function initialize() {
    const figures = document.querySelectorAll(".rff-mission-hotspot-figure");
    const dialog = document.getElementById("rff-mission-picture-dialog");
    if (!figures.length || !dialog) return;

    const heading = document.getElementById("rff-picture-dialog-title");
    const body = document.getElementById("rff-picture-dialog-body");
    let selected = null;

    figures.forEach(figure => {
    figure.querySelectorAll(".rff-poster-hotspot").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.dataset.panel;
        const panel = document.getElementById((key.startsWith("vision-outcomes-") || key.startsWith("milestone-areas-") || /^(assistance-cover|program-journey|privacy-commitments|roadmap|illustrated-support|illustrated-roadmap)-/.test(key)) ? key + "-panel" : "mission-aims-" + key + "-panel");

        heading.textContent = button.getAttribute("aria-label");
        body.replaceChildren();

        if (panel) {
          const copy = panel.cloneNode(true);
          copy.hidden = false;
          copy.removeAttribute("id");
          copy.removeAttribute("role");
          copy.removeAttribute("aria-labelledby");
          copy.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
          body.replaceChildren(...Array.from(copy.childNodes));
        } else if (key === "communities") {
          const paragraph = document.createElement("p");
          paragraph.textContent =
            "Recovery Forward Foundation aims to build stronger communities through supportive relationships, partnerships, and opportunities for lasting recovery.";
          body.append(paragraph);
        }

        selected = button;
        dialog.showModal();
      });
    });
    });

    dialog.addEventListener("click", function (event) {
      const button = event.target.closest("button");
      if (!button || !dialog.contains(button)) return;

      const label = (
        button.getAttribute("aria-label") ||
        button.textContent ||
        ""
      ).trim().toLowerCase();

      if (
        button.matches(".rff-picture-close, .rff-close, [data-rff-close]") ||
        label === "close" ||
        label === "×"
      ) {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
      }
    }, true);
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (selected) selected.focus();
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", initialize);
    else initialize();
  }
})();
