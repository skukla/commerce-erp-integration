/*
 * Mockup behaviour, shared by the three pages.
 * Draws the Admin chrome (rail + header), the page's status band and tabs,
 * the mockup-only state switch and the slide-in side panel, then wires the
 * page's own interactions. Static data only; nothing leaves the browser.
 */
const LEADING_HASH = /^#/;

(() => {
  const STATES = { maint: "Contoso in maintenance", ok: "All good" };
  // Display order (object keys get sorted by the formatter).
  const STATE_ORDER = ["ok", "maint"];
  const RAIL_ORDER = [
    "Dashboard",
    "Sales",
    "Catalog",
    "Customers",
    "Marketing",
    "Content",
    "Reports",
    "Stores",
    "System",
    "Apps",
  ];

  // ── Mock state: ?state=maint, remembered per browser for convenience ──
  function readState() {
    const fromUrl = new URLSearchParams(location.search).get("state");
    if (fromUrl && STATES[fromUrl]) {
      return fromUrl;
    }
    try {
      const saved = localStorage.getItem("erp-mock-state");
      if (saved && STATES[saved]) {
        return saved;
      }
    } catch {
      // storage blocked: fall back to the default state
    }
    return "ok";
  }

  function setState(state) {
    document.body.dataset.state = state;
    try {
      localStorage.setItem("erp-mock-state", state);
    } catch {
      // storage blocked: the state still applies to this page view
    }
    const url = new URL(location.href);
    url.searchParams.set("state", state);
    history.replaceState(null, "", url);
    for (const a of document.querySelectorAll("[data-keep-state]")) {
      const target = new URL(a.getAttribute("href"), location.href);
      target.searchParams.set("state", state);
      a.href = target.pathname.split("/").pop() + target.search;
    }
    for (const b of document.querySelectorAll(".mock-switch button")) {
      b.setAttribute("aria-pressed", String(b.dataset.state === state));
    }
    document.dispatchEvent(new CustomEvent("mockstate", { detail: state }));
  }

  // ── Admin chrome ──
  const ICONS = {
    Apps: "M12 2 21 7v10l-9 5-9-5V7zm0 2.3L5 8.2v7.6l7 3.9 7-3.9V8.2z",
    Catalog:
      "m12 2 9 5v10l-9 5-9-5V7zm0 2.3L6 7.6l6 3.3 6-3.3zM5 9.3v6.5l6 3.3v-6.5z",
    Content: "M3 4h18v16H3zm2 2v2h14V6zm0 4v8h14v-8z",
    Customers:
      "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z",
    Dashboard:
      "M12 4a9 9 0 0 0-9 9h2a7 7 0 0 1 14 0h2a9 9 0 0 0-9-9zm1 9.3 3.2-4.5-1.6-1.2-3.2 4.5A2 2 0 1 0 13 13.3z",
    Marketing: "M4 9h4l8-5v16l-8-5H6l1 5H5l-1-5zm14 0a3 3 0 0 1 0 6z",
    Reports: "M4 20V10h3v10zm6 0V4h3v16zm6 0v-7h3v7z",
    Sales: "M3 6h18v12H3zm2 2v8h14V8zm2 2h6v2H7z",
    Stores: "M4 4h16l1 5a3 3 0 0 1-3 3v8H6v-8a3 3 0 0 1-3-3zm4 10v4h8v-4z",
    System:
      "m12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.6 5.5 1.4 1.1-2 3.4-1.7-.6a7 7 0 0 1-1.9 1.1l-.3 1.8h-4l-.3-1.8a7 7 0 0 1-1.9-1.1l-1.7.6-2-3.4 1.4-1.1a7 7 0 0 1 0-3L2 9.4l2-3.4 1.7.6a7 7 0 0 1 1.9-1.1L7.9 3.7h4l.3 1.8a7 7 0 0 1 1.9 1.1l1.7-.6 2 3.4-1.4 1.1a7 7 0 0 1 0 3z",
  };

  function railHtml() {
    const items = RAIL_ORDER.map((name) => [name, ICONS[name]])
      .map(
        ([name, d]) =>
          `<a class="rail-item${name === "Apps" ? " is-active" : ""}" href="#" aria-label="${name}">` +
          `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>${name}</a>`,
      )
      .join("");
    return `<nav class="rail" aria-label="Admin menu"><div class="rail-logo" aria-hidden="true">A</div>${items}</nav>`;
  }

  function headerHtml() {
    return `<header class="admin-header">
      <h1>ERP Integration</h1>
      <div class="admin-tools">
        <svg viewBox="0 0 24 24" aria-label="Search"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>
        <svg viewBox="0 0 24 24" aria-label="Notifications"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4h-2v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z"/></svg>
        <span class="admin-user"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"/></svg>kukla_adobe_com ▾</span>
      </div>
    </header>`;
  }

  function erpStatusHtml() {
    return `
      <span class="erp-status northwind"><strong>Northwind ERP</strong>
        <span class="state"><span class="dot"></span>Connected</span></span>
      <span class="erp-status contoso"><strong>Contoso ERP</strong>
        <span class="state only-ok"><span class="dot"></span>Connected</span>
        <span class="state only-maint"><span class="dot warn"></span>In maintenance until 15:55</span></span>`;
  }

  function tabsHtml(page) {
    const tabs = [
      ["overview", "Overview"],
      ["activity", "Activity"],
      ["settings", "Settings"],
    ];
    return `<nav class="tabs" aria-label="ERP Integration sections">${tabs
      .map(([id, label]) => {
        const current = id === page ? ' aria-current="page"' : "";
        const count =
          id === "overview"
            ? '<span class="tab-count only-maint">2</span>'
            : "";
        return `<a href="${id}.html" data-keep-state${current}>${label}${count}</a>`;
      })
      .join("")}</nav>`;
  }

  function switchHtml() {
    const buttons = STATE_ORDER.map((id) => [id, STATES[id]])
      .map(
        ([id, label]) =>
          `<button type="button" data-state="${id}">${label}</button>`,
      )
      .join("");
    return `<div class="mock-switch" role="group" aria-label="Mockup only: pick a state"><b>Mockup</b>${buttons}</div>`;
  }

  function panelHtml() {
    return `<div class="scrim" data-close-panel></div>
      <aside class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <div class="panel-head">
          <div><p class="panel-kicker" id="panel-kicker"></p><h2 id="panel-title"></h2><p class="panel-sub" id="panel-sub"></p></div>
          <button class="panel-close" type="button" aria-label="Close" data-close-panel>×</button>
        </div>
        <div class="panel-body" id="panel-body"></div>
        <div class="panel-foot" id="panel-foot"></div>
      </aside>`;
  }

  function buildChrome() {
    const { page } = document.body.dataset;
    const main = document.querySelector("main");
    const bandActions = document.getElementById("band-actions");
    const shell = document.createElement("div");
    shell.className = "admin";
    shell.innerHTML = headerHtml();
    if (page !== "index") {
      const band = document.createElement("div");
      band.className = "band";
      band.innerHTML = `<div class="band-erps">${erpStatusHtml()}</div><div class="band-actions"></div>`;
      if (bandActions) {
        band
          .querySelector(".band-actions")
          .append(bandActions.content.cloneNode(true));
      }
      shell.append(band);
      shell.insertAdjacentHTML("beforeend", tabsHtml(page));
    }
    main.replaceWith(shell);
    shell.append(main);
    shell.insertAdjacentHTML(
      "beforeend",
      '<footer class="admin-footer"><span>Copyright © 2026 Adobe. All rights reserved.</span><span>Privacy Policy | Report an Issue</span></footer>',
    );
    document.body.insertAdjacentHTML("afterbegin", railHtml());
    if (page !== "index") {
      document.body.insertAdjacentHTML("beforeend", switchHtml() + panelHtml());
    }
  }

  // ── Side panel: filled from a <template data-panel="id"> ──
  function openPanel(id) {
    const tpl = document.querySelector(`template[data-panel="${id}"]`);
    if (!tpl) {
      return;
    }
    const frag = tpl.content.cloneNode(true);
    const take = (sel) => {
      const el = frag.querySelector(sel);
      if (el) {
        el.remove();
      }
      return el;
    };
    const kicker = take("[data-slot=kicker]");
    const title = take("[data-slot=title]");
    const sub = take("[data-slot=sub]");
    const foot = take("[data-slot=foot]");
    document.getElementById("panel-kicker").textContent = kicker
      ? kicker.textContent
      : "";
    document.getElementById("panel-title").textContent = title
      ? title.textContent
      : "";
    document.getElementById("panel-sub").innerHTML = sub ? sub.innerHTML : "";
    const footEl = document.getElementById("panel-foot");
    footEl.innerHTML = foot ? foot.innerHTML : "";
    footEl.hidden = !foot;
    const body = document.getElementById("panel-body");
    body.replaceChildren(frag);
    body.scrollTop = 0;
    document.body.classList.add("panel-open");
    document.querySelector(".panel-close").focus();
  }

  function closePanel() {
    document.body.classList.remove("panel-open");
  }

  function wirePanel() {
    document.addEventListener("click", (e) => {
      const opener = e.target.closest("[data-open]");
      if (opener) {
        e.preventDefault();
        openPanel(opener.dataset.open);
        return;
      }
      if (e.target.closest("[data-close-panel]")) {
        closePanel();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closePanel();
      }
    });
  }

  // ── Overview: one search box that opens a trace or a lookup ──
  const LOOKUPS = {
    3000000022: "order-3000000022",
    3000000023: "order-3000000023",
    3000000024: "order-3000000024",
    accesspoint: "sku-accesspoint",
    "kukla studios": "company-kukla",
    proliantdl380: "sku-proliantdl380",
  };

  function wireSearch() {
    const form = document.getElementById("lookup");
    if (!form) {
      return;
    }
    const input = form.querySelector("input");
    const miss = document.getElementById("search-miss");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const key = input.value.trim().toLowerCase().replace(LEADING_HASH, "");
      const id = LOOKUPS[key];
      miss.hidden = Boolean(id);
      if (id) {
        openPanel(id);
      } else {
        miss.textContent = `Nothing in Commerce or either ERP matches “${input.value.trim()}”.`;
      }
    });
    for (const b of document.querySelectorAll("[data-try]")) {
      b.addEventListener("click", () => {
        input.value = b.dataset.try;
        form.requestSubmit();
      });
    }
  }

  // ── Activity: filter chips ──
  function wireFilters() {
    const feed = document.querySelector(".feed");
    if (!feed) {
      return;
    }
    // Start from what the chips show, so the markup decides the first view.
    const pressed = (sel) =>
      document.querySelector(sel)?.getAttribute("aria-pressed") === "true";
    const filters = {
      erp: "all",
      problems: pressed(".filter-chip.problems"),
      type: "all",
    };
    const apply = () => {
      const { state } = document.body.dataset;
      for (const day of feed.querySelectorAll(".day-group")) {
        let shown = 0;
        for (const row of day.querySelectorAll(".event")) {
          const onlyIn = row.dataset.only;
          const erpOk =
            filters.erp === "all" ||
            row.dataset.erp === filters.erp ||
            row.dataset.erp === "both";
          const typeOk =
            filters.type === "all" || row.dataset.type === filters.type;
          const probOk = !filters.problems || row.dataset.problem === "yes";
          const stateOk = !onlyIn || onlyIn === state;
          const show = erpOk && typeOk && probOk && stateOk;
          row.hidden = !show;
          if (show) {
            shown += 1;
          }
        }
        day.hidden = shown === 0;
      }
      const any = feed.querySelector(".day-group:not([hidden])");
      const empty = document.getElementById("feed-empty");
      empty.hidden = Boolean(any);
      empty.textContent = filters.problems
        ? "No problems: everything went through."
        : "Nothing matches these filters.";
    };
    for (const chip of document.querySelectorAll(".filter-chip")) {
      chip.addEventListener("click", () => {
        const { group, value } = chip.dataset;
        if (group === "problems") {
          filters.problems = !filters.problems;
          chip.setAttribute("aria-pressed", String(filters.problems));
        } else {
          filters[group] = value;
          for (const c of document.querySelectorAll(
            `.filter-chip[data-group="${group}"]`,
          )) {
            c.setAttribute("aria-pressed", String(c === chip));
          }
        }
        apply();
      });
    }
    document.addEventListener("mockstate", apply);
    apply();
  }

  // ── Settings: who and where, ⓘ help, Use Default, dirty flag ──
  function wireSettings() {
    const bar = document.querySelector(".scope-bar");
    if (!bar) {
      return;
    }
    const applyFor = () => {
      const { erp } = document.body.dataset;
      for (const el of document.querySelectorAll("[data-for]")) {
        el.hidden = !el.dataset.for.split(" ").includes(erp);
      }
    };
    for (const seg of bar.querySelectorAll(".segmented")) {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) {
          return;
        }
        for (const x of seg.querySelectorAll("button")) {
          x.setAttribute("aria-pressed", String(x === b));
        }
        document.body.dataset[seg.dataset.key] = b.dataset.value;
        applyFor();
        syncDefaults();
      });
    }
    for (const info of document.querySelectorAll(".info")) {
      info.addEventListener("click", () => {
        const row = info.closest(".setting");
        row.classList.toggle("show-more");
        info.setAttribute(
          "aria-expanded",
          String(row.classList.contains("show-more")),
        );
      });
    }
    // "Use Default Value" only exists on a website; there a ticked box locks the field.
    const syncDefaults = () => {
      const onWebsite = document.body.dataset.scope === "website";
      for (const box of document.querySelectorAll(".use-default input")) {
        const control = box.closest(".control");
        for (const f of control.querySelectorAll("input, select")) {
          if (f !== box) {
            f.disabled = onWebsite && box.checked;
          }
        }
      }
    };
    document.addEventListener("change", (e) => {
      if (e.target.closest(".use-default")) {
        syncDefaults();
      }
    });
    const markDirty = (e) => {
      if (e.target.closest(".scope-bar")) {
        return;
      }
      document.body.classList.add("is-dirty");
      document.body.classList.remove("just-saved");
    };
    document.querySelector("main").addEventListener("input", markDirty);
    document.querySelector("main").addEventListener("change", markDirty);
    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-save]")) {
        return;
      }
      document.body.classList.remove("is-dirty");
      document.body.classList.add("just-saved");
    });
    applyFor();
    syncDefaults();
  }

  // Side-panel contents are shared by Overview and Activity, so they live in one file.
  function loadPanels() {
    if (document.body.dataset.page === "index") {
      return;
    }
    fetch("panels.html")
      .then((r) => r.text())
      .then((html) => document.body.insertAdjacentHTML("beforeend", html))
      .catch(() => {
        // opened from disk: the panels need the local server (see index.html)
      });
  }

  // ── Boot ──
  loadPanels();
  buildChrome();
  wirePanel();
  wireSearch();
  wireFilters();
  wireSettings();
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".mock-switch button");
    if (b) {
      setState(b.dataset.state);
    }
  });
  setState(readState());
})();
