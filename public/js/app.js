/* Fence Estimator single page app (no framework, no build step). */
(function () {
  'use strict';

  const C = window.FenceCalc;
  const S = { features: {}, settings: {}, suppliers: [], materials: [], fenceTypes: [], matById: {}, supById: {}, ftById: {} };
  const view = document.getElementById('view');
  const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'completed'];
  const UNITS = ['each', 'ft', 'length', 'bag', 'box', 'roll', 'set', 'panel', 'sheet', 'gal', 'pail', 'lb', 'kg', 'm', 'pair'];

  // ---------- utilities ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = C.num;
  const unit = () => S.settings.length_unit || 'ft';
  function money(n) {
    const v = Number(n) || 0;
    const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-' : '') + (S.settings.currency_symbol || '$') + s;
  }
  function qtyFmt(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function dateFmt(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + (s.length <= 19 ? 'Z' : ''));
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function opt(value, label, selected) {
    return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
  }
  function blankToNull(v) { return v === '' || v === undefined ? null : v; }

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Login required'); }
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  async function loadAll() {
    const d = await api('GET', '/api/bootstrap');
    S.settings = d.settings;
    S.features = d.features || {};
    S.suppliers = d.suppliers;
    S.materials = d.materials;
    S.fenceTypes = d.fence_types;
    S.matById = Object.fromEntries(S.materials.map(m => [m.id, m]));
    S.supById = Object.fromEntries(S.suppliers.map(s => [s.id, s]));
    S.ftById = Object.fromEntries(S.fenceTypes.map(f => [f.id, f]));
    $('#brand-name').textContent = S.settings.company_name || 'Fence Estimator';
  }

  // Read named inputs from a container into an object.
  function readFields(root) {
    const out = {};
    $$('[name]', root).forEach(el => {
      if (el.closest('[data-skip]')) return;
      const k = el.name;
      if (el.type === 'checkbox') out[k] = el.checked ? 1 : 0;
      else if (el.dataset.num !== undefined) out[k] = el.value.trim() === '' ? null : num(el.value, null);
      else out[k] = el.value.trim();
    });
    return out;
  }

  function field(label, name, value, o) {
    o = o || {};
    const v = value === null || value === undefined ? '' : value;
    let input;
    if (o.type === 'select') {
      input = `<select name="${name}">${o.options}</select>`;
    } else if (o.type === 'textarea') {
      input = `<textarea name="${name}" rows="${o.rows || 3}" placeholder="${esc(o.placeholder || '')}">${esc(v)}</textarea>`;
    } else if (o.type === 'checkbox') {
      return `<label class="check ${o.cls || ''}"><input type="checkbox" name="${name}"${v ? ' checked' : ''}> ${esc(label)}</label>`;
    } else {
      const isNum = o.type === 'num';
      input = `<input name="${name}" value="${esc(v)}"${isNum ? ' data-num inputmode="decimal"' : ''} type="${o.inputType || 'text'}"
        placeholder="${esc(o.placeholder || '')}"${o.required ? ' required' : ''}${o.autocomplete ? ` autocomplete="${o.autocomplete}"` : ''}>`;
      if (o.prefix || o.suffix) input = `<div class="input-group">${o.prefix ? `<span>${esc(o.prefix)}</span>` : ''}${input}${o.suffix ? `<span>${esc(o.suffix)}</span>` : ''}</div>`;
    }
    return `<label class="field ${o.cls || ''}">${esc(label)}${input}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ''}</label>`;
  }

  function materialOptions(selected, filterCategory, blankLabel) {
    const list = S.materials.filter(m => (m.active || m.id === Number(selected)) && (!filterCategory || m.category === filterCategory || m.id === Number(selected)));
    const groups = {};
    list.forEach(m => { (groups[m.category] = groups[m.category] || []).push(m); });
    let html = blankLabel !== false ? opt('', blankLabel || '(none)', selected || '') : '';
    Object.keys(groups).sort().forEach(cat => {
      html += `<optgroup label="${esc(cat)}">` + groups[cat].map(m => opt(m.id, m.name + (m.size && !m.name.includes(m.size) ? ` (${m.size})` : ''), selected)).join('') + '</optgroup>';
    });
    return html;
  }

  // ---------- navigation ----------
  const ICONS = {
    estimates: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
    materials: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></svg>',
    types: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V7l2-3 2 3v14M15 21V7l2-3 2 3v14M3 10h18M3 16h18"/></svg>',
    suppliers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h13v12H1zM14 9h4l3 3v4h-7"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  const NAV = [
    ['#/', 'Estimates', 'estimates', ['', 'estimate']],
    ['#/materials', 'Materials', 'materials', ['materials', 'material']],
    ['#/fence-types', 'Fence Types', 'types', ['fence-types', 'fence-type']],
    ['#/suppliers', 'Suppliers', 'suppliers', ['suppliers', 'supplier']],
    ['#/settings', 'Settings', 'settings', ['settings']],
  ];
  function renderNav(show) {
    const section = (location.hash.replace(/^#\/?/, '').split('/')[0]) || '';
    const html = NAV.map(([href, label, icon, keys]) =>
      `<a href="${href}" class="${keys.includes(section) ? 'active' : ''}">${ICONS[icon]}<span>${label}</span></a>`).join('');
    $('#tabbar').innerHTML = show ? html : '';
    $('#desk-nav').innerHTML = show ? NAV.map(([href, label, , keys]) => `<a href="${href}" class="${keys.includes(section) ? 'active' : ''}">${label}</a>`).join('') : '';
  }

  let leaveGuard = null; // returns true if it's OK to leave the current page
  let currentHash = location.hash;
  let ignoreHash = false;
  let cleanup = null;

  window.addEventListener('hashchange', () => {
    if (ignoreHash) { ignoreHash = false; return; }
    if (leaveGuard && !leaveGuard()) {
      ignoreHash = true;
      location.hash = currentHash;
      return;
    }
    route();
  });
  window.addEventListener('beforeunload', e => {
    if (leaveGuard && !leaveGuard(true)) { e.preventDefault(); e.returnValue = ''; }
  });

  function go(hash, replace) {
    leaveGuard = null;
    if (replace) { history.replaceState(null, '', hash); route(); } else location.hash = hash;
  }

  async function route() {
    currentHash = location.hash;
    leaveGuard = null;
    if (cleanup) { cleanup(); cleanup = null; }
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    renderNav(true);
    window.scrollTo(0, 0);
    const [a, b, c] = parts;
    try {
      if (!a) return await viewEstimates();
      if (a === 'estimate' && b === 'new') return await viewEstimate(null);
      if (a === 'estimate' && b && c === 'quote') return await viewQuote(Number(b));
      if (a === 'estimate' && b && c === 'order') return await viewOrder(Number(b));
      if (a === 'estimate' && b) return await viewEstimate(Number(b));
      if (a === 'materials') return viewMaterials();
      if (a === 'material') return viewMaterial(b === 'new' ? null : Number(b));
      if (a === 'suppliers') return viewSuppliers();
      if (a === 'supplier') return viewSupplier(b === 'new' ? null : Number(b));
      if (a === 'fence-types') return viewFenceTypes();
      if (a === 'fence-type') return viewFenceType(b === 'new' ? null : Number(b));
      if (a === 'settings') return viewSettings();
      view.innerHTML = '<div class="empty">Page not found. <a href="#/">Go to estimates</a></div>';
    } catch (err) {
      if (err.message === 'Login required') return;
      view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a href="#/">Back to estimates</a></div>`;
    }
  }

  // ---------- login ----------
  function showLogin() {
    renderNav(false);
    leaveGuard = null;
    view.innerHTML = `
      <form class="card login" id="login">
        <h1>Sign in</h1>
        <p class="muted">Enter the app password.</p>
        <div class="grid">
          ${field('Password', 'password', '', { inputType: 'password', autocomplete: 'current-password', required: true })}
          <button class="btn-primary" type="submit">Sign in</button>
        </div>
      </form>`;
    $('#login').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api('POST', '/api/login', { password: $('#login [name=password]').value });
        await loadAll();
        route();
      } catch (err) { toast(err.message, true); }
    });
  }

  // =====================================================================
  // Estimates list
  // =====================================================================
  async function viewEstimates() {
    const list = await api('GET', '/api/estimates');
    const pref = sessionStorage.getItem('est-filter') || '';
    view.innerHTML = `
      <div class="page-head">
        <h1>Estimates</h1>
        <a class="btn btn-primary" href="#/estimate/new">+ New estimate</a>
      </div>
      <div class="stats" style="margin-bottom:14px">
        ${statBox('Open quotes', list.filter(e => ['draft', 'sent'].includes(e.status)).length)}
        ${statBox('Open value', money(list.filter(e => ['draft', 'sent'].includes(e.status)).reduce((s, e) => s + e.total, 0)))}
        ${statBox('Accepted', money(list.filter(e => ['accepted', 'completed'].includes(e.status)).reduce((s, e) => s + e.total, 0)))}
      </div>
      <div class="card">
        <div class="search-bar">
          <input type="search" id="q" placeholder="Search customer, address, number">
          <select id="st">${opt('', 'All statuses', pref)}${STATUSES.map(s => opt(s, s[0].toUpperCase() + s.slice(1), pref)).join('')}</select>
        </div>
        <div id="list"></div>
      </div>`;
    const draw = () => {
      const q = $('#q').value.toLowerCase();
      const st = $('#st').value;
      sessionStorage.setItem('est-filter', st);
      const rows = list.filter(e => (!st || e.status === st) &&
        (!q || [e.number, e.customer_name, e.site_address, e.fence_type_name].join(' ').toLowerCase().includes(q)));
      $('#list').innerHTML = rows.length ? `<div class="list">${rows.map(e => `
        <a class="list-item" href="#/estimate/${e.id}">
          <div class="main">
            <div class="title">${esc(e.customer_name || 'No customer name')} <span class="muted small">${esc(e.number || '')}</span></div>
            <div class="sub">${esc([e.fence_type_name, e.fence_length ? qtyFmt(e.fence_length) + ' ' + unit() : '', e.site_address].filter(Boolean).join(' · '))}</div>
            <div class="sub">${dateFmt(e.updated_at)}</div>
          </div>
          <div class="right">
            <div class="amount">${money(e.total)}</div>
            <span class="badge ${esc(e.status)}">${esc(e.status)}</span>
          </div>
        </a>`).join('')}</div>`
        : `<div class="empty">${list.length ? 'No estimates match.' : 'No estimates yet. Tap <b>New estimate</b> to start one.'}</div>`;
    };
    $('#q').addEventListener('input', draw);
    $('#st').addEventListener('change', draw);
    draw();
  }

  function statBox(k, v) { return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`; }

  // =====================================================================
  // Estimate editor
  // =====================================================================
  function applyFenceType(e, ft) {
    e.fence_type_id = ft ? ft.id : null;
    if (!ft) return;
    e.height = ft.default_height;
    e.post_spacing = ft.post_spacing;
    e.labor_price_per_ft = ft.labor_price_per_ft;
    e.labor_cost_per_ft = ft.labor_cost_per_ft;
    e.labor_price_per_gate = ft.labor_price_per_gate;
    e.labor_cost_per_gate = ft.labor_cost_per_gate;
    e.overrides = {};
    (e.gates || []).forEach(g => { g.material_id = null; });
  }

  function newEstimate() {
    const e = {
      status: 'draft', input_mode: 'manual',
      runs: [{ length: '', joinPrev: false, closes: false }],
      gates: [], layout: null, overrides: {}, extras: [],
      tax_rate: S.settings.tax_rate, deposit_pct: S.settings.deposit_pct, discount: 0, labor_extra: 0,
    };
    let last = null;
    try { last = S.ftById[localStorage.getItem('last-fence-type')]; } catch { /* storage unavailable */ }
    const ft = last && last.active ? last : S.fenceTypes.find(f => f.active);
    applyFenceType(e, ft);
    return e;
  }

  function effectiveRuns(e) {
    if (e.input_mode === 'drawing') return window.FenceLayout.deriveRuns(e.layout, e.gates);
    return (e.runs || []).map((r, i) => Object.assign({}, r, { label: r.label || window.FenceLayout.runLabel(i), length: num(r.length) }));
  }

  function computeEst(e) {
    const runs = effectiveRuns(e);
    return C.computeEstimate({
      estimate: Object.assign({}, e, { runs }),
      fenceType: S.ftById[e.fence_type_id],
      materialsById: S.matById,
      suppliersById: S.supById,
      settings: S.settings,
    });
  }

  async function uploadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('This image format could not be read. Try a JPEG or PNG (or a screenshot of the drawing).'));
        i.src = url;
      });
      const max = 2400;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const r = await api('POST', '/api/uploads', { dataUrl: cv.toDataURL('image/jpeg', 0.85) });
      return { url: r.url, w, h };
    } finally { URL.revokeObjectURL(url); }
  }

  async function viewEstimate(id) {
    const e = id ? await api('GET', `/api/estimates/${id}`) : newEstimate();
    e.runs = e.runs && e.runs.length ? e.runs : [{ length: '', joinPrev: false, closes: false }];
    e.gates = e.gates || [];
    e.overrides = e.overrides || {};
    e.extras = e.extras || [];
    // The saved "runs" from drawing mode are derived; manual runs live in manual_runs.
    if (e.manual_runs) e.runs = e.manual_runs;
    let dirty = !id;
    let tool = null;
    let showCost = localStorage.getItem('show-cost') !== '0';
    let result = null;

    leaveGuard = (silent) => !dirty || (!silent && confirm('You have unsaved changes. Leave without saving?'));
    cleanup = () => { if (tool) tool.destroy(); };
    const root = document.createElement('div');
    view.innerHTML = '';
    view.appendChild(root);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);

    function markDirty() {
      dirty = true;
      const d = $('#dirty');
      if (d) d.classList.remove('hidden');
    }

    function renderAll() {
      if (tool) { tool.destroy(); tool = null; }
      const ft = S.ftById[e.fence_type_id];
      root.innerHTML = `
        <div class="page-head">
          <a class="btn btn-ghost btn-sm" href="#/">&larr; Estimates</a>
          <h1>${id ? esc(e.number || 'Estimate') : 'New estimate'}</h1>
          <span class="badge ${esc(e.status)}">${esc(e.status)}</span>
        </div>
        <div class="split">
          <div>
            <section class="card" id="sec-customer">
              <h2>Customer</h2>
              <div class="grid cols-2">
                ${field('Customer name', 'customer_name', e.customer_name, { autocomplete: 'name' })}
                ${field('Phone', 'customer_phone', e.customer_phone, { inputType: 'tel', autocomplete: 'tel' })}
                ${field('Email', 'customer_email', e.customer_email, { inputType: 'email', autocomplete: 'email' })}
                ${field('Status', 'status', e.status, { type: 'select', options: STATUSES.map(s => opt(s, s[0].toUpperCase() + s.slice(1), e.status)).join('') })}
                ${field('Job site address', 'site_address', e.site_address, { cls: 'span-all', autocomplete: 'street-address' })}
              </div>
            </section>

            <section class="card" id="sec-fence">
              <h2>Fence</h2>
              <div class="grid cols-3">
                ${field('Fence type', 'fence_type_id', e.fence_type_id, { type: 'select', cls: 'span-all',
                  options: opt('', 'Choose a fence type', e.fence_type_id) + S.fenceTypes.filter(f => f.active || f.id === e.fence_type_id).map(f => opt(f.id, f.name, e.fence_type_id)).join('') })}
                ${field('Height', 'height', e.height, { type: 'num', suffix: unit() })}
                ${field('Post spacing', 'post_spacing', e.post_spacing, { type: 'num', suffix: unit(), hint: 'Max distance between posts' })}
              </div>
              ${ft && ft.description ? `<p class="muted small" style="margin:.6rem 0 0">${esc(ft.description)}</p>` : ''}
              ${!S.fenceTypes.length ? '<div class="notice" style="margin-top:10px">No fence types yet. <a href="#/fence-type/new">Create one</a> to get material lists.</div>' : ''}
            </section>

            <section class="card" id="sec-layout">
              <h2><span class="grow">Fence layout</span>
                <span class="seg" role="group">
                  <button type="button" data-input-mode="manual" class="${e.input_mode !== 'drawing' ? 'on' : ''}">Measurements</button>
                  <button type="button" data-input-mode="drawing" class="${e.input_mode === 'drawing' ? 'on' : ''}">Drawing</button>
                </span>
              </h2>
              ${e.input_mode === 'drawing' ? `
                <div id="tool"></div>
                <h3 style="margin-top:14px">Fence runs from the drawing</h3>
                <p class="muted small" style="margin-top:0">Lengths come from the drawing scale. Type a length to override a measured one.</p>
                <div id="runs"></div>`
              : `
                <p class="muted small" style="margin-top:0">Enter each straight run of fence. Type feet as 42.5 or 42' 6". Runs that meet at a corner share a post.</p>
                ${S.features.sketch_reader ? `
                <div class="notice info" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
                  <span style="flex:1;min-width:200px">Have a sketch with the measurements written on it? Take a photo and the lengths and gates are filled in for you.</span>
                  <button type="button" class="btn-sm btn-primary" id="read-sketch">Read a sketch</button>
                  <input type="file" id="sketch-file" accept="image/*" hidden>
                </div>` : ''}
                <div id="sketch-result"></div>
                <div id="runs"></div>
                <div class="row" style="margin-top:10px">
                  <button type="button" class="btn-sm" id="add-run">+ Add run</button>
                </div>`}
            </section>

            <section class="card" id="sec-gates">
              <h2><span class="grow">Gates</span><button type="button" class="btn-sm" id="add-gate">+ Add gate</button></h2>
              <div id="gates"></div>
            </section>

            <section class="card" id="sec-materials">
              <h2><span class="grow">Materials</span>
                <label class="check small" style="min-height:0"><input type="checkbox" id="show-cost"${showCost ? ' checked' : ''}> Show my costs</label>
              </h2>
              <p class="muted small" style="margin-top:0">Swap any material for another from your database, or type a quantity to override the calculated one.</p>
              <div id="lines"></div>
              <h3 style="margin-top:16px">Extra items &amp; charges</h3>
              <div id="extras"></div>
              <div class="row" style="margin-top:8px"><button type="button" class="btn-sm" id="add-extra">+ Add item or charge</button></div>
            </section>

            <section class="card" id="sec-labor">
              <h2>Labour &amp; pricing</h2>
              <div class="grid cols-2">
                ${field('Labour price per ' + unit(), 'labor_price_per_ft', e.labor_price_per_ft, { type: 'num', prefix: S.settings.currency_symbol, hint: 'What you charge the customer' })}
                ${field('Labour cost per ' + unit(), 'labor_cost_per_ft', e.labor_cost_per_ft, { type: 'num', prefix: S.settings.currency_symbol, hint: 'What it costs you (crew wages)' })}
                ${field('Labour price per gate', 'labor_price_per_gate', e.labor_price_per_gate, { type: 'num', prefix: S.settings.currency_symbol })}
                ${field('Labour cost per gate', 'labor_cost_per_gate', e.labor_cost_per_gate, { type: 'num', prefix: S.settings.currency_symbol })}
                ${field('Other labour / site charges', 'labor_extra', e.labor_extra, { type: 'num', prefix: S.settings.currency_symbol, hint: 'e.g. clearing, old fence removal, difficult ground' })}
                ${field('Discount', 'discount', e.discount, { type: 'num', prefix: S.settings.currency_symbol })}
                ${field((S.settings.tax_label || 'Tax') + ' rate', 'tax_rate', e.tax_rate, { type: 'num', suffix: '%' })}
                ${field('Deposit required', 'deposit_pct', e.deposit_pct, { type: 'num', suffix: '%' })}
              </div>
            </section>

            <section class="card" id="sec-notes">
              <h2>Notes</h2>
              <div class="grid">
                ${field('Notes shown on the quote', 'customer_notes', e.customer_notes, { type: 'textarea', placeholder: 'e.g. Includes removal and disposal of existing fence.' })}
                ${field('Internal notes (not shown to customer)', 'internal_notes', e.internal_notes, { type: 'textarea' })}
              </div>
            </section>
          </div>

          <aside class="sticky">
            <section class="card" id="summary"></section>
          </aside>
        </div>

        <div class="save-bar">
          <div class="inner">
            <span class="dirty-dot ${dirty ? '' : 'hidden'}" id="dirty" title="Unsaved changes"></span>
            <span class="total" id="bar-total"></span>
            <span class="spacer"></span>
            ${id ? `<a class="btn btn-sm" href="#/estimate/${id}/order" data-needsave>Order list</a>
            <a class="btn btn-sm" href="#/estimate/${id}/quote" data-needsave>Quote</a>` : ''}
            <button type="button" class="btn-primary" id="save">Save</button>
          </div>
        </div>`;

      if (e.input_mode === 'drawing') {
        tool = new window.FenceLayout($('#tool'), {
          estimate: e,
          unit: unit(),
          upload: uploadImage,
          notify: m => toast(m, true),
          onChange: () => { markDirty(); renderRuns(); renderGates(); recalc(); },
        });
      }
      renderRuns();
      renderGates();
      renderExtras();
      renderSketchResult();
      recalc();
      const sf = $('#sketch-file');
      if (sf) sf.addEventListener('change', () => readSketch(sf));
    }

    // ----- AI sketch reading -----
    function renderSketchResult() {
      const el = $('#sketch-result');
      if (!el || !e.sketch) return;
      el.innerHTML = `<div class="notice">
        <div class="row"><strong style="flex:1;min-width:220px">Read from sketch: please check these against the drawing</strong>
          <a class="btn btn-sm" href="${esc(e.sketch.url)}" target="_blank" rel="noopener">View sketch</a>
          <button type="button" class="btn-sm btn-ghost" id="dismiss-sketch">Dismiss</button></div>
        ${e.sketch.notes ? `<p style="margin:.4rem 0 0;white-space:pre-line">${esc(e.sketch.notes)}</p>` : ''}
      </div>`;
    }

    async function readSketch(input) {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      const btn = $('#read-sketch');
      btn.disabled = true;
      btn.textContent = 'Reading sketch...';
      try {
        const up = await uploadImage(file);
        const r = await api('POST', '/api/read-sketch', { url: up.url });
        if (!r.runs.length) { toast('No fence runs could be read from that image.', true); return; }
        const total = r.runs.reduce((s, x) => s + x.length, 0);
        const hasRuns = e.runs.some(x => num(x.length) > 0);
        const msg = `Found ${r.runs.length} run${r.runs.length > 1 ? 's' : ''} (${qtyFmt(total)} ${unit()} total) and ${r.gates.length} gate${r.gates.length === 1 ? '' : 's'}.`
          + (hasRuns || e.gates.length ? '\n\nThis replaces the runs and gates you have entered. Continue?' : '');
        if ((hasRuns || e.gates.length) && !confirm(msg)) return;
        e.runs = r.runs;
        e.gates = r.gates.map((g, i) => ({ label: 'Gate ' + (i + 1), width: g.width, leaves: g.leaves, run: g.run, material_id: null }));
        e.sketch = { url: up.url, notes: r.notes };
        markDirty();
        renderRuns(); renderGates(); renderSketchResult(); recalc();
        toast(msg.split('\n')[0]);
      } catch (err) {
        toast('Could not read sketch: ' + err.message, true);
      } finally {
        if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Read a sketch'; }
      }
    }

    // ----- runs -----
    function renderRuns() {
      const el = $('#runs');
      if (!el) return;
      if (e.input_mode === 'drawing') {
        const runs = effectiveRuns(e);
        el.innerHTML = runs.length ? runs.map(r => `
          <div class="run-row" style="grid-template-columns:2.2rem 1fr 1fr">
            <div class="tag">${r.label}</div>
            <div class="small muted">Measured: ${qtyFmt(r.measured)} ${unit()}</div>
            <input data-seglen="${r.key}" value="${r.overridden ? esc(r.length) : ''}" placeholder="${qtyFmt(r.measured)}" inputmode="decimal" aria-label="Length of run ${r.label}">
          </div>`).join('') : '<div class="empty">Draw the fence on the layout above. Each straight line becomes a run.</div>';
        return;
      }
      el.innerHTML = e.runs.map((r, i) => `
        <div class="run-row">
          <div class="tag">${window.FenceLayout.runLabel(i)}</div>
          <input data-run="${i}" data-rf="label" value="${esc(r.label || '')}" placeholder="Name (optional)" aria-label="Run name">
          <div class="input-group"><input data-run="${i}" data-rf="length" value="${esc(r.length)}" placeholder="Length" inputmode="decimal" aria-label="Run length"><span>${unit()}</span></div>
          <button type="button" class="btn-icon btn-ghost" data-del-run="${i}" aria-label="Remove run">&times;</button>
          <div class="opts">
            ${i > 0 ? `<label class="check"><input type="checkbox" data-run="${i}" data-rf="joinPrev"${r.joinPrev ? ' checked' : ''}> Corner with run ${window.FenceLayout.runLabel(i - 1)}</label>` : ''}
            <label class="check"><input type="checkbox" data-run="${i}" data-rf="closes"${r.closes ? ' checked' : ''}> Joins back to the start (closed shape)</label>
          </div>
        </div>`).join('');
    }

    // ----- gates -----
    function renderGates() {
      const el = $('#gates');
      if (!el) return;
      const runs = effectiveRuns(e);
      const ft = S.ftById[e.fence_type_id];
      const def = ft && S.matById[ft.default_gate_material_id];
      if (!e.gates.length) {
        el.innerHTML = `<div class="empty small">No gates. ${e.input_mode === 'drawing' ? 'Use <b>Add gate</b> on the drawing, or the button above.' : 'Tap <b>Add gate</b> to add one.'}</div>`;
        return;
      }
      el.innerHTML = e.gates.map((g, i) => `
        <div class="card" style="box-shadow:none;background:var(--surface-2);padding:12px;margin-bottom:10px">
          <div class="row" style="margin-bottom:8px"><strong>G${i + 1}</strong><span class="spacer"></span>
            <button type="button" class="btn-sm btn-danger" data-del-gate="${i}">Remove</button></div>
          <div class="grid cols-2">
            <label class="field">Name<input data-gate="${i}" data-gf="label" value="${esc(g.label || '')}"></label>
            <label class="field">Width<div class="input-group"><input data-gate="${i}" data-gf="width" value="${esc(g.width)}" inputmode="decimal"><span>${unit()}</span></div></label>
            <label class="field">Type<select data-gate="${i}" data-gf="leaves">${opt(1, 'Single gate', g.leaves || 1)}${opt(2, 'Double gate (2 leaves)', g.leaves || 1)}</select></label>
            <label class="field">In run
              ${g.pos && e.input_mode === 'drawing' ? `<input value="${esc((runs[g.run] || {}).label || '?')} (from drawing)" disabled>` :
                `<select data-gate="${i}" data-gf="run">${opt(-1, 'Not in a run (stand-alone)', g.run)}${runs.map((r, ri) => opt(ri, 'Run ' + r.label + (r.label && r.length ? ` (${qtyFmt(r.length)} ${unit()})` : ''), g.run)).join('')}</select>`}
            </label>
            <label class="field span-all">Gate material
              <select data-gate="${i}" data-gf="material_id">${opt('', def ? `Fence type default: ${def.name}` : '(choose a gate)', g.material_id || '')}${materialOptions(g.material_id, 'gate', false)}</select>
            </label>
          </div>
        </div>`).join('');
    }

    // ----- extras -----
    function renderExtras() {
      const el = $('#extras');
      if (!el) return;
      if (!e.extras.length) { el.innerHTML = '<div class="muted small">None. Add delivery, removal of old fence, concrete cutting, extra hardware, etc.</div>'; return; }
      el.innerHTML = e.extras.map((x, i) => `
        <div class="card" style="box-shadow:none;background:var(--surface-2);padding:12px;margin-bottom:10px">
          <div class="grid cols-2">
            <label class="field span-all">From materials database
              <select data-extra="${i}" data-xf="material_id">${materialOptions(x.material_id, null, 'Custom item / charge (type below)')}</select></label>
            <label class="field span-all">Description<input data-extra="${i}" data-xf="description" value="${esc(x.description || '')}" placeholder="${x.material_id ? 'Uses material name' : 'e.g. Remove & dispose old fence'}"></label>
            <label class="field">Quantity<input data-extra="${i}" data-xf="qty" value="${esc(x.qty)}" inputmode="decimal"></label>
            <label class="field">Price each<div class="input-group"><span>${esc(S.settings.currency_symbol)}</span><input data-extra="${i}" data-xf="unit_price" value="${esc(x.unit_price === null || x.unit_price === undefined ? '' : x.unit_price)}" inputmode="decimal" placeholder="${x.material_id ? 'from database' : '0.00'}"></div></label>
            <label class="field">My cost each<div class="input-group"><span>${esc(S.settings.currency_symbol)}</span><input data-extra="${i}" data-xf="unit_cost" value="${esc(x.unit_cost === null || x.unit_cost === undefined ? '' : x.unit_cost)}" inputmode="decimal" placeholder="${x.material_id ? 'from database' : '0.00'}"></div></label>
            <div class="row"><strong data-extra-total="${i}"></strong><span class="spacer"></span><button type="button" class="btn-sm btn-danger" data-del-extra="${i}">Remove</button></div>
          </div>
        </div>`).join('');
    }

    // ----- computed sections -----
    function recalc() {
      result = computeEst(e);
      renderLines();
      renderSummary();
      result.lines.filter(l => l.is_extra).forEach(l => {
        const t = $(`[data-extra-total="${l.extra_index}"]`);
        if (t) t.textContent = money(l.price);
      });
      $('#bar-total').textContent = money(result.totals.total);
    }

    function renderLines() {
      const el = $('#lines');
      if (!el) return;
      const ft = S.ftById[e.fence_type_id];
      const lines = result.lines.filter(l => !l.is_extra);
      const removed = ft ? ft.components.filter(c => e.overrides[c.id] && e.overrides[c.id].removed) : [];
      if (!lines.length && !removed.length) {
        el.innerHTML = '<div class="empty small">Choose a fence type and enter lengths to see the material list.</div>';
        return;
      }
      el.innerHTML = `
        <div class="table-wrap"><table class="data cards">
          <thead><tr><th>Item</th><th>Material</th><th class="num">Qty</th>${showCost ? '<th class="num">Cost</th>' : ''}<th class="num">Price</th><th></th></tr></thead>
          <tbody>${lines.map(l => {
            const comp = l.component_id ? ft && ft.components.find(c => c.id === l.component_id) : null;
            const sel = l.component_id
              ? `<select data-line-mat="${l.component_id}">${materialOptions(l.material_id, comp ? comp.category : l.category, '(none)')}</select>`
              : esc(l.name);
            return `<tr>
              <td class="primary-cell">${esc(l.label)}<div class="muted small">${esc(C.RULES[l.rule] ? qtyFmt(l.qty_per) + ' ' + C.RULES[l.rule] : '')}${l.waste_pct ? ` · +${qtyFmt(l.waste_pct)}% waste` : ''}${l.pack_size > 1 ? ` · ${qtyFmt(l.raw_qty)} needed, ${qtyFmt(l.pack_size)}/${esc(l.unit)}` : ''}</div></td>
              <td data-label="Material">${sel}${l.swapped ? ' <span class="badge">swapped</span>' : ''}</td>
              <td data-label="Qty" class="num"><div class="input-group" style="justify-content:flex-end"><input data-line-qty="${esc(l.key)}" value="${l.manual ? esc(l.qty) : ''}" placeholder="${esc(l.calc_qty)}" inputmode="decimal" style="width:80px;text-align:right"><span>${esc(l.unit)}</span></div></td>
              ${showCost ? `<td data-label="Cost" class="num">${money(l.cost)}<div class="muted small">${money(l.unit_cost)} ea</div></td>` : ''}
              <td data-label="Price" class="num"><strong>${money(l.price)}</strong><div class="muted small">${money(l.unit_price)} ea</div></td>
              <td>${l.component_id ? `<button type="button" class="btn-sm btn-ghost" data-remove-comp="${l.component_id}" aria-label="Remove line">Remove</button>` : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        ${removed.length ? `<p class="small muted">Removed from this job: ${removed.map(c => `${esc(c.label || c.category)} <button type="button" class="btn-sm btn-ghost" data-restore-comp="${c.id}">Restore</button>`).join(' ')}</p>` : ''}`;
    }

    function renderSummary() {
      const el = $('#summary');
      const g = result.geometry, t = result.totals;
      el.innerHTML = `
        <h2>Summary</h2>
        <div class="stats">
          ${statBox('Fence', qtyFmt(g.fenceLength) + ' ' + unit())}
          ${statBox('Posts', g.posts.total)}
          ${statBox('Sections', g.sections)}
          ${statBox('Gates', g.gateCount)}
        </div>
        <p class="muted small" style="margin:.5rem 0">Posts: ${g.posts.line} line · ${g.posts.corner} corner · ${g.posts.end} end · ${g.posts.gate} gate</p>
        ${result.warnings.length ? `<div class="notice"><strong>Check:</strong><ul>${result.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        <table class="totals">
          <tr><td>Materials</td><td>${money(t.materials_price)}</td></tr>
          <tr><td>Labour</td><td>${money(t.labor_price)}</td></tr>
          ${t.discount ? `<tr><td>Discount</td><td>-${money(t.discount)}</td></tr>` : ''}
          <tr><td>${esc(S.settings.tax_label || 'Tax')} (${qtyFmt(t.tax_rate)}%)</td><td>${money(t.tax)}</td></tr>
          <tr class="grand"><td>Total</td><td>${money(t.total)}</td></tr>
          <tr><td class="muted">Deposit (${qtyFmt(t.deposit_pct)}%)</td><td class="muted">${money(t.deposit)}</td></tr>
          <tr><td class="muted">Per ${unit()} of fence</td><td class="muted">${money(t.price_per_ft)}</td></tr>
          ${showCost ? `
          <tr class="internal"><td colspan="2" style="padding-top:.8rem"><strong>Internal</strong></td></tr>
          <tr class="internal"><td>Material cost</td><td>${money(t.materials_cost)}</td></tr>
          <tr class="internal"><td>Labour cost</td><td>${money(t.labor_cost)}</td></tr>
          <tr class="internal"><td>Gross profit</td><td>${money(t.profit)}</td></tr>
          <tr class="internal"><td>Margin</td><td>${qtyFmt(t.margin_pct)}%</td></tr>` : ''}
        </table>`;
    }

    // ----- events -----
    const TOP_NUM = ['height', 'post_spacing', 'labor_price_per_ft', 'labor_cost_per_ft', 'labor_price_per_gate',
      'labor_cost_per_gate', 'labor_extra', 'discount', 'tax_rate', 'deposit_pct'];

    function onInput(ev) {
      const t = ev.target;
      if (t.closest('#tool')) return;
      if (t.name) {
        if (t.name === 'fence_type_id' || t.name === 'status') return; // handled on change
        e[t.name] = TOP_NUM.includes(t.name) ? (t.value.trim() === '' ? '' : num(t.value)) : t.value;
        markDirty();
        if (TOP_NUM.includes(t.name)) { recalc(); if (tool && t.name === 'post_spacing') tool.draw(); }
        return;
      }
      if (t.dataset.run !== undefined && t.dataset.rf === 'length') {
        const v = C.parseLength(t.value);
        e.runs[+t.dataset.run].length = Number.isFinite(v) ? v : '';
        markDirty(); recalc();
      } else if (t.dataset.run !== undefined && t.dataset.rf === 'label') {
        e.runs[+t.dataset.run].label = t.value; markDirty();
      } else if (t.dataset.gate !== undefined && (t.dataset.gf === 'width' || t.dataset.gf === 'label')) {
        const g = e.gates[+t.dataset.gate];
        if (t.dataset.gf === 'width') { const v = C.parseLength(t.value); g.width = Number.isFinite(v) ? v : 0; recalc(); if (tool) tool.draw(); }
        else g.label = t.value;
        markDirty();
      } else if (t.dataset.extra !== undefined && t.tagName === 'INPUT') {
        const x = e.extras[+t.dataset.extra];
        const f = t.dataset.xf;
        x[f] = f === 'description' ? t.value : (t.value.trim() === '' ? '' : num(t.value));
        markDirty(); recalc();
      }
    }

    function onChange(ev) {
      const t = ev.target;
      if (t.closest('#tool')) return;
      if (t.id === 'show-cost') {
        showCost = t.checked;
        localStorage.setItem('show-cost', showCost ? '1' : '0');
        recalc();
        return;
      }
      if (t.name === 'fence_type_id') {
        const ft = S.ftById[t.value];
        try { localStorage.setItem('last-fence-type', t.value); } catch { /* storage unavailable */ }
        applyFenceType(e, ft);
        markDirty();
        renderAll();
        return;
      }
      if (t.name === 'status') { e.status = t.value; markDirty(); return; }
      if (t.dataset.run !== undefined) {
        const r = e.runs[+t.dataset.run];
        if (t.dataset.rf === 'length') { renderRuns(); renderGates(); return; } // reformat 12'6" as 12.5
        if (t.type === 'checkbox') { r[t.dataset.rf] = t.checked; markDirty(); recalc(); }
        return;
      }
      if (t.dataset.seglen !== undefined) {
        const v = C.parseLength(t.value);
        if (Number.isFinite(v) && v > 0) e.layout.lengths[t.dataset.seglen] = v;
        else delete e.layout.lengths[t.dataset.seglen];
        markDirty(); renderRuns(); renderGates(); recalc(); if (tool) tool.draw();
        return;
      }
      if (t.dataset.gate !== undefined) {
        const g = e.gates[+t.dataset.gate];
        const f = t.dataset.gf;
        if (f === 'leaves') g.leaves = Number(t.value);
        else if (f === 'run') g.run = Number(t.value);
        else if (f === 'material_id') g.material_id = t.value ? Number(t.value) : null;
        else return;
        markDirty(); recalc();
        return;
      }
      if (t.dataset.lineMat !== undefined) {
        const cid = t.dataset.lineMat;
        const ft = S.ftById[e.fence_type_id];
        const comp = ft && ft.components.find(c => String(c.id) === cid);
        const ov = e.overrides[cid] = e.overrides[cid] || {};
        const v = t.value ? Number(t.value) : null;
        if (comp && v === comp.material_id) delete ov.material_id; else ov.material_id = v;
        delete ov.qty; // quantity override no longer applies to a different product
        markDirty(); recalc();
        return;
      }
      if (t.dataset.lineQty !== undefined) {
        const key = t.dataset.lineQty;
        const id = key.startsWith('c') ? key.slice(1) : key;
        const ov = e.overrides[id] = e.overrides[id] || {};
        if (t.value.trim() === '') delete ov.qty; else ov.qty = num(t.value);
        markDirty(); recalc();
        return;
      }
      if (t.dataset.extra !== undefined && t.dataset.xf === 'material_id') {
        const x = e.extras[+t.dataset.extra];
        x.material_id = t.value ? Number(t.value) : null;
        x.unit_price = ''; x.unit_cost = '';
        markDirty(); renderExtras(); recalc();
      }
    }

    async function onClick(ev) {
      const b = ev.target.closest('button, a');
      if (!b || b.closest('#tool')) return;
      if (b.dataset.inputMode) {
        if (b.dataset.inputMode === e.input_mode || (b.dataset.inputMode === 'manual' && e.input_mode !== 'drawing')) return;
        e.input_mode = b.dataset.inputMode;
        if (e.input_mode === 'drawing' && !e.layout) e.layout = window.FenceLayout.emptyLayout();
        markDirty(); renderAll();
      } else if (b.id === 'read-sketch') {
        $('#sketch-file').click();
      } else if (b.id === 'dismiss-sketch') {
        delete e.sketch;
        markDirty();
        $('#sketch-result').innerHTML = '';
      } else if (b.id === 'add-run') {
        e.runs.push({ length: '', joinPrev: true, closes: false });
        markDirty(); renderRuns(); renderGates(); recalc();
        const inputs = $$('[data-rf=length]');
        if (inputs.length) inputs[inputs.length - 1].focus();
      } else if (b.dataset.delRun !== undefined) {
        const i = +b.dataset.delRun;
        e.runs.splice(i, 1);
        e.gates.forEach(g => { if (!g.pos) { if (g.run === i) g.run = -1; else if (g.run > i) g.run--; } });
        if (!e.runs.length) e.runs.push({ length: '', joinPrev: false, closes: false });
        e.runs[0].joinPrev = false;
        markDirty(); renderRuns(); renderGates(); recalc();
      } else if (b.id === 'add-gate') {
        e.gates.push({ label: 'Gate ' + (e.gates.length + 1), width: 4, leaves: 1, run: effectiveRuns(e).length ? 0 : -1, material_id: null });
        markDirty(); renderGates(); recalc();
      } else if (b.dataset.delGate !== undefined) {
        e.gates.splice(+b.dataset.delGate, 1);
        markDirty(); renderGates(); recalc(); if (tool) tool.draw();
      } else if (b.id === 'add-extra') {
        e.extras.push({ material_id: null, description: '', qty: 1, unit_price: '', unit_cost: '' });
        markDirty(); renderExtras(); recalc();
      } else if (b.dataset.delExtra !== undefined) {
        e.extras.splice(+b.dataset.delExtra, 1);
        markDirty(); renderExtras(); recalc();
      } else if (b.dataset.removeComp !== undefined) {
        const ov = e.overrides[b.dataset.removeComp] = e.overrides[b.dataset.removeComp] || {};
        ov.removed = true;
        markDirty(); recalc();
      } else if (b.dataset.restoreComp !== undefined) {
        const ov = e.overrides[b.dataset.restoreComp] || {};
        delete ov.removed;
        markDirty(); recalc();
      } else if (b.id === 'save') {
        await save();
      } else if (b.dataset.needsave !== undefined && dirty) {
        ev.preventDefault();
        const href = b.getAttribute('href');
        if (await save()) go(href);
      }
    }

    async function save() {
      const btn = $('#save');
      btn.disabled = true;
      try {
        result = computeEst(e);
        const body = Object.assign({}, e, {
          manual_runs: e.runs,
          result: { geometry: result.geometry, lines: result.lines, totals: result.totals, warnings: result.warnings, runs: effectiveRuns(e), saved_at: new Date().toISOString() },
          fence_type_name: (S.ftById[e.fence_type_id] || {}).name || '',
        });
        delete body.runs;
        const saved = await api(id ? 'PUT' : 'POST', id ? `/api/estimates/${id}` : '/api/estimates', body);
        dirty = false;
        toast('Estimate saved');
        if (!id) { go('#/estimate/' + saved.id, true); return true; }
        e.number = saved.number;
        $('#dirty').classList.add('hidden');
        return true;
      } catch (err) {
        toast('Save failed: ' + err.message, true);
        return false;
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    }

    renderAll();
  }

  // =====================================================================
  // Quote (customer facing) and order list
  // =====================================================================
  async function loadSavedEstimate(id) {
    const e = await api('GET', `/api/estimates/${id}`);
    if (!e.result) {
      if (e.manual_runs) e.runs = e.manual_runs;
      e.result = computeEst(e);
    }
    return e;
  }

  async function viewQuote(id) {
    const e = await loadSavedEstimate(id);
    const r = e.result, t = r.totals, g = r.geometry;
    const st = S.settings;
    const ft = S.ftById[e.fence_type_id];
    const itemizedPref = localStorage.getItem('quote-itemized') === '1';
    const validDays = num(st.quote_valid_days, 30);
    const quoteDate = e.updated_at ? new Date(e.updated_at.replace(' ', 'T') + 'Z') : new Date();
    const validUntil = new Date(quoteDate.getTime() + validDays * 86400000);
    const lines = r.lines || [];
    const runs = r.runs || [];

    view.innerHTML = `
      <div class="page-head no-print">
        <a class="btn btn-ghost btn-sm" href="#/estimate/${id}">&larr; Back to estimate</a>
        <span class="spacer"></span>
        <label class="check small"><input type="checkbox" id="itemized"${itemizedPref ? ' checked' : ''}> Itemize materials</label>
        <button type="button" class="btn-sm" id="share">Share</button>
        <button type="button" class="btn-sm btn-primary" id="print">Print / PDF</button>
      </div>
      <p class="muted small no-print">Prices are as of the last save (${dateFmt(r.saved_at || e.updated_at)}). Open the estimate and save it to refresh prices.</p>
      <article class="doc">
        <div class="doc-head">
          <div>
            <h1 style="margin-bottom:4px">${esc(st.company_name)}</h1>
            <div style="white-space:pre-line;color:#555">${esc([st.company_address, st.company_phone, st.company_email].filter(Boolean).join('\n'))}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.4rem;font-weight:800;color:#1d5c3f">QUOTE</div>
            <table class="doc-meta" style="margin-left:auto">
              <tr><td>Quote #</td><td><strong>${esc(e.number)}</strong></td></tr>
              <tr><td>Date</td><td>${quoteDate.toLocaleDateString()}</td></tr>
              <tr><td>Valid until</td><td>${validUntil.toLocaleDateString()}</td></tr>
            </table>
          </div>
        </div>
        <div class="grid cols-2" style="margin-bottom:18px">
          <div><div class="muted small">PREPARED FOR</div>
            <strong>${esc(e.customer_name)}</strong><br>${esc(e.customer_phone || '')}${e.customer_phone && e.customer_email ? '<br>' : ''}${esc(e.customer_email || '')}</div>
          <div><div class="muted small">JOB SITE</div>${esc(e.site_address || '')}</div>
        </div>
        <h2>Scope of work</h2>
        <p>Supply and install <strong>${qtyFmt(g.fenceLength)} ${unit()}</strong> of ${esc(ft ? ft.name : 'fence')}${g.height ? `, ${qtyFmt(g.height)} ${unit()} high` : ''}${g.gateCount ? `, with ${g.gateCount} gate${g.gateCount > 1 ? 's' : ''}` : ''}.
          ${ft && ft.description ? esc(ft.description) : ''}</p>
        ${runs.length > 1 ? `<p class="small" style="color:#555">Runs: ${runs.map(x => `${esc(x.label)}: ${qtyFmt(x.length)} ${unit()}`).join(' · ')}</p>` : ''}
        <div class="drawing" id="drawing" style="margin:10px 0"></div>
        <div id="items"></div>
        <table class="totals" style="max-width:360px;margin-left:auto;margin-top:12px">
          <tr><td>Subtotal</td><td>${money(t.subtotal)}</td></tr>
          ${t.discount ? `<tr><td>Discount</td><td>-${money(t.discount)}</td></tr>` : ''}
          <tr><td>${esc(st.tax_label || 'Tax')} ${qtyFmt(t.tax_rate)}%</td><td>${money(t.tax)}</td></tr>
          <tr class="grand"><td>Total</td><td>${money(t.total)}</td></tr>
          ${t.deposit_pct ? `<tr><td>Deposit due (${qtyFmt(t.deposit_pct)}%)</td><td>${money(t.deposit)}</td></tr>` : ''}
        </table>
        ${e.customer_notes ? `<h3 style="margin-top:18px">Notes</h3><p style="white-space:pre-line">${esc(e.customer_notes)}</p>` : ''}
        ${st.quote_terms ? `<h3 style="margin-top:18px">Terms</h3><p class="small" style="white-space:pre-line;color:#555">${esc(st.quote_terms)}</p>` : ''}
        <div class="sig"><div>Customer signature / date</div><div>${esc(st.company_name)}</div></div>
      </article>`;

    const drawItems = () => {
      const itemized = $('#itemized').checked;
      localStorage.setItem('quote-itemized', itemized ? '1' : '0');
      const rows = itemized
        ? lines.map(l => `<tr><td>${esc(l.name)}${l.size && !l.name.includes(l.size) ? ` <span class="muted">(${esc(l.size)})</span>` : ''}</td><td class="num">${qtyFmt(l.qty)} ${esc(l.unit)}</td><td class="num">${money(l.unit_price)}</td><td class="num">${money(l.price)}</td></tr>`).join('')
          + `<tr><td>Installation labour</td><td class="num"></td><td class="num"></td><td class="num">${money(t.labor_price)}</td></tr>`
        : `<tr><td>Materials: ${esc(ft ? ft.name : 'fencing')}${g.gateCount ? ' including gates and hardware' : ''}</td><td></td><td></td><td class="num">${money(t.materials_price)}</td></tr>
           <tr><td>Installation labour</td><td></td><td></td><td class="num">${money(t.labor_price)}</td></tr>`;
      $('#items').innerHTML = `<table class="data"><thead><tr><th>Description</th><th class="num">${itemized ? 'Qty' : ''}</th><th class="num">${itemized ? 'Each' : ''}</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    $('#itemized').addEventListener('change', drawItems);
    drawItems();

    if (e.input_mode === 'drawing' && e.layout) {
      const cv = document.createElement('canvas');
      window.FenceLayout.renderStatic(cv, e, unit(), Math.min(700, $('#drawing').clientWidth || 700)).then(ok => { if (ok) $('#drawing').appendChild(cv); });
    }
    $('#print').addEventListener('click', () => window.print());
    $('#share').addEventListener('click', async () => {
      const text = `${st.company_name} quote ${e.number} for ${e.customer_name || ''}: ${qtyFmt(g.fenceLength)} ${unit()} ${ft ? ft.name : 'fence'}${g.gateCount ? `, ${g.gateCount} gate(s)` : ''}. Total ${money(t.total)}${t.deposit_pct ? `, deposit ${money(t.deposit)}` : ''}. Valid until ${validUntil.toLocaleDateString()}.`;
      if (navigator.share) { try { await navigator.share({ title: 'Quote ' + e.number, text }); } catch { /* cancelled */ } }
      else { await copyText(text); }
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch { prompt('Copy this text:', text); }
  }

  async function viewOrder(id) {
    const e = await loadSavedEstimate(id);
    const lines = (e.result.lines || []).filter(l => l.material_id);
    const groups = {};
    lines.forEach(l => {
      const k = l.supplier || 'No supplier set';
      (groups[k] = groups[k] || []).push(l);
    });
    // Merge duplicate materials (e.g. the same tension bar used by several recipe lines)
    Object.keys(groups).forEach(k => {
      const merged = {};
      groups[k].forEach(l => {
        const m = merged[l.material_id];
        if (m) { m.qty += l.qty; m.cost += l.cost; } else merged[l.material_id] = Object.assign({}, l);
      });
      groups[k] = Object.values(merged);
    });
    const names = Object.keys(groups).sort();
    const text = `Material order: ${e.number} ${e.customer_name || ''}\n${e.site_address || ''}\n\n` + names.map(n =>
      `${n}\n` + groups[n].map(l => `  ${qtyFmt(l.qty)} ${l.unit} x ${l.name}${l.supplier_sku ? ' [' + l.supplier_sku + ']' : (l.sku ? ' [' + l.sku + ']' : '')}`).join('\n')).join('\n\n');

    view.innerHTML = `
      <div class="page-head no-print">
        <a class="btn btn-ghost btn-sm" href="#/estimate/${id}">&larr; Back to estimate</a>
        <span class="spacer"></span>
        <button type="button" class="btn-sm" id="copy">Copy as text</button>
        ${navigator.share ? '<button type="button" class="btn-sm" id="share">Share</button>' : ''}
        <button type="button" class="btn-sm btn-primary" id="print">Print</button>
      </div>
      <article class="doc">
        <h1>Material order list</h1>
        <p>${esc(e.number)} · ${esc(e.customer_name || '')}<br>${esc(e.site_address || '')}</p>
        ${names.length ? names.map(n => `
          <h2 style="margin-top:18px">${esc(n)}</h2>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Item</th><th>Supplier SKU</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Ext. cost</th></tr></thead>
            <tbody>${groups[n].map(l => `<tr><td>${esc(l.name)}${l.size && !l.name.includes(l.size) ? ` <span class="muted small">${esc(l.size)}</span>` : ''}</td><td>${esc(l.supplier_sku || l.sku || '')}</td><td class="num">${qtyFmt(l.qty)} ${esc(l.unit)}</td><td class="num">${money(l.unit_cost)}</td><td class="num">${money(l.cost)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="4" class="num"><strong>Total</strong></td><td class="num"><strong>${money(groups[n].reduce((s, l) => s + l.cost, 0))}</strong></td></tr></tfoot>
          </table></div>`).join('') : '<div class="empty">No materials on this estimate.</div>'}
      </article>`;
    $('#print').addEventListener('click', () => window.print());
    $('#copy').addEventListener('click', () => copyText(text));
    if ($('#share')) $('#share').addEventListener('click', async () => { try { await navigator.share({ title: 'Material order ' + e.number, text }); } catch { /* cancelled */ } });
  }

  // =====================================================================
  // Materials
  // =====================================================================
  function viewMaterials() {
    const f = JSON.parse(sessionStorage.getItem('mat-filter') || '{}');
    view.innerHTML = `
      <div class="page-head">
        <h1>Materials</h1>
        <button type="button" class="btn-sm" id="export">Export CSV</button>
        <button type="button" class="btn-sm" id="import">Import CSV</button>
        <input type="file" id="csv" accept=".csv,text/csv" hidden>
        <a class="btn btn-primary" href="#/material/new">+ New material</a>
      </div>
      <div class="card">
        <div class="search-bar">
          <input type="search" id="q" placeholder="Search name, size, SKU, colour" value="${esc(f.q || '')}">
          <select id="cat">${opt('', 'All categories', f.cat)}${C.CATEGORIES.map(c => opt(c, c, f.cat)).join('')}</select>
          <select id="type">${opt('', 'All material types', f.type)}${C.MATERIAL_TYPES.map(c => opt(c, c, f.type)).join('')}</select>
          <label class="check small"><input type="checkbox" id="inactive"${f.inactive ? ' checked' : ''}> Show inactive</label>
        </div>
        <div id="list"></div>
      </div>`;
    const draw = () => {
      const q = $('#q').value.toLowerCase(), cat = $('#cat').value, type = $('#type').value, inactive = $('#inactive').checked;
      sessionStorage.setItem('mat-filter', JSON.stringify({ q, cat, type, inactive }));
      const rows = S.materials.filter(m => (inactive || m.active) && (!cat || m.category === cat) && (!type || m.material_type === type)
        && (!q || [m.name, m.size, m.sku, m.color, m.description].join(' ').toLowerCase().includes(q)));
      $('#list').innerHTML = rows.length ? `
        <div class="table-wrap"><table class="data cards">
          <thead><tr><th>Material</th><th>Category</th><th>Unit</th><th class="num">My cost</th><th class="num">Quote price</th><th class="num">Markup</th><th>Supplier</th></tr></thead>
          <tbody>${rows.map(m => {
            const cost = C.materialCost(m), price = C.materialPrice(m, S.settings);
            const best = C.bestSupplierPrice(m);
            return `<tr class="click" data-href="#/material/${m.id}">
              <td class="primary-cell">${esc(m.name)}${m.active ? '' : ' <span class="badge">inactive</span>'}<div class="muted small">${esc([m.size, m.color, m.sku].filter(Boolean).join(' · '))}</div></td>
              <td data-label="Category">${esc(m.category)}${m.material_type ? `<div class="muted small">${esc(m.material_type)}</div>` : ''}</td>
              <td data-label="Unit">${esc(m.unit)}${m.pack_size > 1 ? ` of ${qtyFmt(m.pack_size)}` : ''}</td>
              <td data-label="My cost" class="num">${cost ? money(cost) : '<span class="muted">none</span>'}</td>
              <td data-label="Quote price" class="num"><strong>${money(price)}</strong>${num(m.sell_price) > 0 ? '' : '<div class="muted small">by markup</div>'}</td>
              <td data-label="Markup" class="num">${cost ? qtyFmt((price / cost - 1) * 100) + '%' : ''}</td>
              <td data-label="Supplier">${esc(best ? best.supplier_name : '')}${m.prices.length > 1 ? ` <span class="muted small">+${m.prices.length - 1}</span>` : ''}</td>
            </tr>`;
          }).join('')}</tbody></table></div>`
        : `<div class="empty">${S.materials.length ? 'No materials match.' : 'No materials yet.'}</div>`;
    };
    ['input', 'change'].forEach(ev => $('.search-bar').addEventListener(ev, draw));
    $('#list').addEventListener('click', ev => { const tr = ev.target.closest('[data-href]'); if (tr) location.hash = tr.dataset.href; });
    $('#export').addEventListener('click', exportMaterialsCsv);
    $('#import').addEventListener('click', () => $('#csv').click());
    $('#csv').addEventListener('change', async () => {
      const file = $('#csv').files[0];
      $('#csv').value = '';
      if (file) await importMaterialsCsv(await file.text());
    });
    draw();
  }

  const CSV_COLS = ['id', 'name', 'category', 'material_type', 'sku', 'description', 'size', 'length', 'width', 'height', 'thickness',
    'dim_unit', 'color', 'grade', 'unit', 'pack_size', 'sell_price', 'markup_pct', 'waste_pct', 'stock_qty', 'reorder_level', 'notes', 'active',
    'supplier', 'supplier_sku', 'cost'];

  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportMaterialsCsv() {
    const rows = [CSV_COLS.join(',')];
    S.materials.forEach(m => {
      const best = C.bestSupplierPrice(m);
      const r = Object.assign({}, m, { supplier: best ? best.supplier_name : '', supplier_sku: best ? best.supplier_sku : '', cost: best ? best.cost : '' });
      rows.push(CSV_COLS.map(c => csvCell(r[c])).join(','));
    });
    download('materials.csv', rows.join('\n'), 'text/csv');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  async function importMaterialsCsv(text) {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    if (rows.length < 2) return toast('The CSV file has no rows', true);
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (!head.includes('name')) return toast('The CSV needs at least a "name" column', true);
    const numeric = ['id', 'length', 'width', 'height', 'thickness', 'pack_size', 'sell_price', 'markup_pct', 'waste_pct', 'stock_qty', 'reorder_level', 'active', 'cost'];
    const items = rows.slice(1).map(r => {
      const o = {};
      head.forEach((h, i) => {
        const v = (r[i] || '').trim();
        if (v === '') return;
        o[h] = numeric.includes(h) ? num(v.replace(/[^0-9.-]/g, ''), null) : v;
      });
      return o;
    }).filter(o => o.name || o.id);
    if (!confirm(`Import ${items.length} materials? Rows with a matching id or SKU will be updated; others will be added.`)) return;
    try {
      // Create any suppliers named in the file that don't exist yet
      const byName = Object.fromEntries(S.suppliers.map(s => [s.name.toLowerCase(), s.id]));
      for (const it of items) {
        if (!it.supplier) continue;
        const key = it.supplier.toLowerCase();
        if (!byName[key]) byName[key] = (await api('POST', '/api/suppliers', { name: it.supplier })).id;
        it.supplier_id = byName[key];
      }
      const r = await api('POST', '/api/materials/bulk', { items });
      await loadAll();
      toast(`Imported: ${r.created} added, ${r.updated} updated`);
      viewMaterials();
    } catch (err) { toast('Import failed: ' + err.message, true); }
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function viewMaterial(id) {
    const m = id ? S.matById[id] : { category: 'post', unit: 'each', pack_size: 1, waste_pct: 0, taxable: 1, active: 1, dim_unit: 'in', prices: [] };
    if (!m) { view.innerHTML = '<div class="empty">Material not found. <a href="#/materials">Back</a></div>'; return; }
    let prices = (m.prices || []).map(p => Object.assign({}, p));
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    const usedIn = id ? S.fenceTypes.filter(f => f.components.some(c => c.material_id === id) || f.default_gate_material_id === id) : [];

    view.innerHTML = `
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/materials">&larr; Materials</a>
        <h1>${id ? esc(m.name) : 'New material'}</h1>
      </div>
      <form id="f" autocomplete="off">
        <section class="card">
          <h2>Details</h2>
          <div class="grid cols-2">
            ${field('Name', 'name', m.name, { required: true, cls: 'span-all', placeholder: 'e.g. 4x4x8 PT Post' })}
            ${field('Category', 'category', m.category, { type: 'select', options: C.CATEGORIES.map(c => opt(c, c, m.category)).join(''), hint: 'Used to offer swaps in estimates' })}
            ${field('Material type', 'material_type', m.material_type, { type: 'select', options: opt('', '(none)', m.material_type) + C.MATERIAL_TYPES.map(c => opt(c, c, m.material_type)).join('') })}
            ${field('Your SKU / item code', 'sku', m.sku)}
            ${field('Colour / finish', 'color', m.color)}
            ${field('Grade / spec', 'grade', m.grade, { placeholder: 'e.g. #2, UC4B, 11.5ga' })}
            ${field('Description', 'description', m.description, { cls: 'span-all' })}
          </div>
        </section>
        <section class="card">
          <h2>Size</h2>
          <div class="grid cols-3">
            ${field('Size label', 'size', m.size, { placeholder: 'e.g. 4x4, 6ft x 8ft, 2-3/8"', cls: 'span-all' })}
            ${field('Length', 'length', m.length, { type: 'num' })}
            ${field('Width', 'width', m.width, { type: 'num' })}
            ${field('Height', 'height', m.height, { type: 'num' })}
            ${field('Thickness / gauge', 'thickness', m.thickness, { type: 'num' })}
            ${field('Dimension unit', 'dim_unit', m.dim_unit, { type: 'select', options: ['in', 'ft', 'mm', 'cm', 'm'].map(u => opt(u, u, m.dim_unit)).join('') })}
          </div>
        </section>
        <section class="card">
          <h2>Selling</h2>
          <div class="grid cols-3">
            ${field('Sold by (unit)', 'unit', m.unit, { type: 'select', options: UNITS.concat(UNITS.includes(m.unit) ? [] : [m.unit]).map(u => opt(u, u, m.unit)).join('') })}
            ${field('Pieces per unit', 'pack_size', m.pack_size, { type: 'num', hint: 'e.g. 350 screws per box, 50 ft per roll. Use 1 for single items.' })}
            ${field('Waste allowance', 'waste_pct', m.waste_pct, { type: 'num', suffix: '%', hint: 'Extra added for cuts and breakage' })}
            ${field('My quoted price per unit', 'sell_price', m.sell_price, { type: 'num', prefix: S.settings.currency_symbol, hint: 'Leave blank to use markup on cost' })}
            ${field('Markup on cost', 'markup_pct', m.markup_pct, { type: 'num', suffix: '%', hint: `Blank = default (${S.settings.default_markup_pct}%)` })}
            <div class="stat" id="price-preview"></div>
            ${field('Taxable', 'taxable', m.taxable, { type: 'checkbox' })}
            ${field('Active (offer in estimates)', 'active', m.active, { type: 'checkbox' })}
          </div>
        </section>
        <section class="card">
          <h2><span class="grow">Suppliers &amp; costs</span><button type="button" class="btn-sm" id="add-price">+ Add supplier</button></h2>
          <p class="muted small" style="margin-top:0">The preferred supplier's cost is used in estimates. With no preferred supplier, the cheapest is used.</p>
          <div id="prices" data-skip></div>
          ${!S.suppliers.length ? '<div class="notice">Add suppliers first on the <a href="#/suppliers">Suppliers</a> page.</div>' : ''}
        </section>
        <section class="card">
          <h2>Stock &amp; notes</h2>
          <div class="grid cols-2">
            ${field('In stock', 'stock_qty', m.stock_qty, { type: 'num' })}
            ${field('Reorder when below', 'reorder_level', m.reorder_level, { type: 'num' })}
            ${field('Notes', 'notes', m.notes, { type: 'textarea', cls: 'span-all' })}
          </div>
          ${usedIn.length ? `<p class="small muted">Used in fence types: ${usedIn.map(f => `<a href="#/fence-type/${f.id}">${esc(f.name)}</a>`).join(', ')}</p>` : ''}
        </section>
        <div class="row end">
          ${id ? '<button type="button" class="btn-danger" id="del">Delete</button><button type="button" id="dup">Duplicate</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn-primary">Save material</button>
        </div>
      </form>`;

    const form = $('#f');
    function drawPrices() {
      $('#prices').innerHTML = prices.length ? `
        <div class="table-wrap"><table class="data cards">
          <thead><tr><th>Supplier</th><th>Supplier SKU</th><th class="num">Cost / unit</th><th>Lead days</th><th>Min order</th><th>Price date</th><th>Preferred</th><th></th></tr></thead>
          <tbody>${prices.map((p, i) => `<tr>
            <td class="primary-cell"><select data-p="${i}" data-pf="supplier_id">${opt('', 'Choose supplier', p.supplier_id)}${S.suppliers.map(s => opt(s.id, s.name, p.supplier_id)).join('')}</select></td>
            <td data-label="Supplier SKU"><input data-p="${i}" data-pf="supplier_sku" value="${esc(p.supplier_sku || '')}"></td>
            <td data-label="Cost / unit" class="num"><input data-p="${i}" data-pf="cost" value="${esc(p.cost)}" inputmode="decimal" style="text-align:right"></td>
            <td data-label="Lead days"><input data-p="${i}" data-pf="lead_time_days" value="${esc(p.lead_time_days === null || p.lead_time_days === undefined ? '' : p.lead_time_days)}" inputmode="numeric"></td>
            <td data-label="Min order"><input data-p="${i}" data-pf="min_order_qty" value="${esc(p.min_order_qty === null || p.min_order_qty === undefined ? '' : p.min_order_qty)}" inputmode="decimal"></td>
            <td data-label="Price date"><input type="date" data-p="${i}" data-pf="price_date" value="${esc(p.price_date || '')}"></td>
            <td data-label="Preferred"><input type="radio" name="preferred_pick" data-p="${i}" data-pf="preferred"${p.preferred ? ' checked' : ''}></td>
            <td><button type="button" class="btn-sm btn-ghost" data-del-price="${i}">Remove</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="muted small">No supplier costs yet.</div>';
    }
    function preview() {
      const f = readFields(form);
      const tmp = Object.assign({}, f, { prices: prices.map(p => Object.assign({}, p, { cost: num(p.cost) })) });
      const cost = C.materialCost(tmp), price = C.materialPrice(tmp, S.settings);
      $('#price-preview').innerHTML = `<div class="k">Estimates will use</div><div class="v">${money(price)} / ${esc(f.unit || 'each')}</div>
        <div class="small muted">Cost ${money(cost)}${cost ? ` · margin ${qtyFmt((price - cost) / price * 100)}%` : ''}</div>`;
    }
    drawPrices();
    preview();

    form.addEventListener('input', ev => {
      dirty = true;
      const t = ev.target;
      if (t.dataset.p !== undefined && t.dataset.pf !== 'preferred') {
        prices[+t.dataset.p][t.dataset.pf] = t.value;
      }
      preview();
    });
    form.addEventListener('change', ev => {
      const t = ev.target;
      if (t.dataset.pf === 'preferred') { prices.forEach((p, i) => { p.preferred = i === +t.dataset.p ? 1 : 0; }); preview(); }
      if (t.dataset.pf === 'supplier_id') prices[+t.dataset.p].supplier_id = Number(t.value) || null;
    });
    form.addEventListener('click', async ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.id === 'add-price') {
        prices.push({ supplier_id: S.suppliers.length === 1 ? S.suppliers[0].id : null, cost: '', preferred: prices.length ? 0 : 1, price_date: new Date().toISOString().slice(0, 10) });
        dirty = true; drawPrices();
      } else if (b.dataset.delPrice !== undefined) {
        prices.splice(+b.dataset.delPrice, 1); dirty = true; drawPrices(); preview();
      } else if (b.id === 'del') {
        if (!confirm(`Delete "${m.name}"? Fence types using it will lose this component's material.${usedIn.length ? ' Tip: untick Active instead to hide it but keep history.' : ''}`)) return;
        await api('DELETE', `/api/materials/${id}`);
        await loadAll();
        toast('Material deleted');
        go('#/materials');
      } else if (b.id === 'dup') {
        const body = Object.assign(readFields(form), { name: readFields(form).name + ' (copy)', prices: prices.map(p => Object.assign({}, p, { id: undefined })) });
        const saved = await api('POST', '/api/materials', body);
        await loadAll();
        toast('Duplicated');
        go('#/material/' + saved.id);
      }
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = readFields(form);
      delete body.preferred_pick;
      body.prices = prices.filter(p => p.supplier_id).map(p => ({
        supplier_id: p.supplier_id, supplier_sku: p.supplier_sku || null, cost: num(p.cost),
        lead_time_days: blankToNull(p.lead_time_days), min_order_qty: blankToNull(p.min_order_qty),
        preferred: p.preferred ? 1 : 0, price_date: p.price_date || null, notes: p.notes || null,
      }));
      try {
        await api(id ? 'PUT' : 'POST', id ? `/api/materials/${id}` : '/api/materials', body);
        await loadAll();
        dirty = false;
        toast('Material saved');
        go('#/materials');
      } catch (err) { toast(err.message, true); }
    });
  }

  // =====================================================================
  // Suppliers
  // =====================================================================
  function viewSuppliers() {
    view.innerHTML = `
      <div class="page-head"><h1>Suppliers</h1><a class="btn btn-primary" href="#/supplier/new">+ New supplier</a></div>
      <div class="card">
        ${S.suppliers.length ? `<div class="list">${S.suppliers.map(s => {
          const count = S.materials.filter(m => m.prices.some(p => p.supplier_id === s.id)).length;
          return `<a class="list-item" href="#/supplier/${s.id}">
            <div class="main"><div class="title">${esc(s.name)}${s.active ? '' : ' <span class="badge">inactive</span>'}</div>
            <div class="sub">${esc([s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details')}</div></div>
            <div class="muted small nowrap">${count} item${count === 1 ? '' : 's'}</div></a>`;
        }).join('')}</div>` : '<div class="empty">No suppliers yet.</div>'}
      </div>`;
  }

  function viewSupplier(id) {
    const s = id ? S.supById[id] : { active: 1 };
    if (!s) { view.innerHTML = '<div class="empty">Supplier not found.</div>'; return; }
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    const items = id ? S.materials.filter(m => m.prices.some(p => p.supplier_id === id)) : [];
    view.innerHTML = `
      <div class="page-head"><a class="btn btn-ghost btn-sm" href="#/suppliers">&larr; Suppliers</a><h1>${id ? esc(s.name) : 'New supplier'}</h1></div>
      <form id="f">
        <section class="card">
          <div class="grid cols-2">
            ${field('Company name', 'name', s.name, { required: true, cls: 'span-all' })}
            ${field('Contact person', 'contact_name', s.contact_name)}
            ${field('Phone', 'phone', s.phone, { inputType: 'tel' })}
            ${field('Email', 'email', s.email, { inputType: 'email' })}
            ${field('Website', 'website', s.website, { inputType: 'url' })}
            ${field('Address', 'address', s.address, { type: 'textarea', cls: 'span-all', rows: 2 })}
            ${field('Account number', 'account_number', s.account_number)}
            ${field('Payment terms', 'payment_terms', s.payment_terms, { placeholder: 'e.g. Net 30, COD' })}
            ${field('Delivery info', 'delivery_notes', s.delivery_notes, { cls: 'span-all', placeholder: 'e.g. Free delivery over $1000, Tues/Thurs only' })}
            ${field('Notes', 'notes', s.notes, { type: 'textarea', cls: 'span-all' })}
            ${field('Active', 'active', s.active, { type: 'checkbox' })}
          </div>
        </section>
        ${items.length ? `<section class="card"><h2>Materials from this supplier</h2>
          <div class="table-wrap"><table class="data"><thead><tr><th>Material</th><th>Their SKU</th><th class="num">Cost</th><th>Preferred</th></tr></thead><tbody>
          ${items.map(m => { const p = m.prices.find(x => x.supplier_id === id); return `<tr class="click" data-href="#/material/${m.id}"><td>${esc(m.name)}</td><td>${esc(p.supplier_sku || '')}</td><td class="num">${money(p.cost)} / ${esc(m.unit)}</td><td>${p.preferred ? 'Yes' : ''}</td></tr>`; }).join('')}
          </tbody></table></div></section>` : ''}
        <div class="row end">
          ${id ? '<button type="button" class="btn-danger" id="del">Delete</button>' : ''}
          <span class="spacer"></span>
          ${s.phone ? `<a class="btn" href="tel:${esc(s.phone)}">Call</a>` : ''}
          ${s.email ? `<a class="btn" href="mailto:${esc(s.email)}">Email</a>` : ''}
          <button type="submit" class="btn-primary">Save supplier</button>
        </div>
      </form>`;
    const form = $('#f');
    form.addEventListener('input', () => { dirty = true; });
    form.addEventListener('click', ev => { const tr = ev.target.closest('[data-href]'); if (tr) location.hash = tr.dataset.href; });
    if ($('#del')) $('#del').addEventListener('click', async () => {
      if (!confirm(`Delete ${s.name}? Their prices will be removed from all materials.`)) return;
      await api('DELETE', `/api/suppliers/${id}`);
      await loadAll();
      go('#/suppliers');
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        await api(id ? 'PUT' : 'POST', id ? `/api/suppliers/${id}` : '/api/suppliers', readFields(form));
        await loadAll();
        dirty = false;
        toast('Supplier saved');
        go('#/suppliers');
      } catch (err) { toast(err.message, true); }
    });
  }

  // =====================================================================
  // Fence types
  // =====================================================================
  function viewFenceTypes() {
    view.innerHTML = `
      <div class="page-head"><h1>Fence types</h1><a class="btn btn-primary" href="#/fence-type/new">+ New fence type</a></div>
      <p class="muted">A fence type is a recipe: which materials go into the fence and how many per foot, post, section or gate.</p>
      <div class="card">
        ${S.fenceTypes.length ? `<div class="list">${S.fenceTypes.map(f => `
          <a class="list-item" href="#/fence-type/${f.id}">
            <div class="main"><div class="title">${esc(f.name)}${f.active ? '' : ' <span class="badge">inactive</span>'}</div>
            <div class="sub">${esc([f.material_type, qtyFmt(f.default_height) + ' ' + unit() + ' high', 'posts every ' + qtyFmt(f.post_spacing) + ' ' + unit(), f.components.length + ' components'].filter(Boolean).join(' · '))}</div></div>
            <div class="muted small nowrap">${money(f.labor_price_per_ft)}/${unit()} labour</div>
          </a>`).join('')}</div>` : '<div class="empty">No fence types yet.</div>'}
      </div>`;
  }

  function viewFenceType(id) {
    const src = id ? S.ftById[id] : { default_height: 6, post_spacing: 8, active: 1, components: [] };
    if (!src) { view.innerHTML = '<div class="empty">Fence type not found.</div>'; return; }
    const comps = src.components.map(c => Object.assign({}, c));
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    const cur = S.settings.currency_symbol;

    view.innerHTML = `
      <div class="page-head"><a class="btn btn-ghost btn-sm" href="#/fence-types">&larr; Fence types</a><h1>${id ? esc(src.name) : 'New fence type'}</h1></div>
      <form id="f" autocomplete="off">
        <section class="card">
          <div class="grid cols-3">
            ${field('Name', 'name', src.name, { required: true, cls: 'span-all', placeholder: 'e.g. Wood Privacy 6ft' })}
            ${field('Style', 'style', src.style, { placeholder: 'privacy, picket, chain link...' })}
            ${field('Material type', 'material_type', src.material_type, { type: 'select', options: opt('', '(none)', src.material_type) + C.MATERIAL_TYPES.map(c => opt(c, c, src.material_type)).join('') })}
            ${field('Default height', 'default_height', src.default_height, { type: 'num', suffix: unit() })}
            ${field('Post spacing', 'post_spacing', src.post_spacing, { type: 'num', suffix: unit(), hint: 'Max centre-to-centre distance' })}
            ${field('Default gate', 'default_gate_material_id', src.default_gate_material_id, { type: 'select', options: materialOptions(src.default_gate_material_id, 'gate', '(none)') })}
            ${field('Active', 'active', src.active, { type: 'checkbox' })}
            ${field('Description (shown on quotes)', 'description', src.description, { type: 'textarea', cls: 'span-all', rows: 2 })}
          </div>
        </section>
        <section class="card">
          <h2>Labour rates</h2>
          <div class="grid cols-4">
            ${field('Price per ' + unit(), 'labor_price_per_ft', src.labor_price_per_ft, { type: 'num', prefix: cur })}
            ${field('My cost per ' + unit(), 'labor_cost_per_ft', src.labor_cost_per_ft, { type: 'num', prefix: cur })}
            ${field('Price per gate', 'labor_price_per_gate', src.labor_price_per_gate, { type: 'num', prefix: cur })}
            ${field('My cost per gate', 'labor_cost_per_gate', src.labor_cost_per_gate, { type: 'num', prefix: cur })}
          </div>
        </section>
        <section class="card" data-skip>
          <h2><span class="grow">Materials recipe</span><button type="button" class="btn-sm" id="add-comp">+ Add component</button></h2>
          <p class="muted small" style="margin-top:0">Each line says how many of a material go into the fence. Example: 3 rails <em>per section</em>, 2 bags of concrete <em>per post</em>, 2.18 pickets <em>per ${unit()}</em>. Items sold in packs (screws, fabric rolls) are converted to packs automatically.</p>
          <div id="comps"></div>
        </section>
        <section class="card" data-skip>
          <h2>Test it</h2>
          <div class="row">
            <label class="field" style="flex:1">Fence length<div class="input-group"><input id="t-len" value="100" inputmode="decimal"><span>${unit()}</span></div></label>
            <label class="field" style="flex:1">Corners<input id="t-corners" value="1" inputmode="numeric"></label>
            <label class="field" style="flex:1">Gates<input id="t-gates" value="1" inputmode="numeric"></label>
          </div>
          <div id="preview" style="margin-top:10px"></div>
        </section>
        <div class="row end">
          ${id ? '<button type="button" class="btn-danger" id="del">Delete</button><button type="button" id="dup">Duplicate</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn-primary">Save fence type</button>
        </div>
      </form>`;

    const form = $('#f');
    function drawComps() {
      $('#comps').innerHTML = comps.length ? `
        <div class="table-wrap"><table class="data cards">
          <thead><tr><th>Label</th><th>Category</th><th>Material</th><th class="num">Qty</th><th>Per</th><th class="num">Waste % override</th><th></th></tr></thead>
          <tbody>${comps.map((c, i) => `<tr>
            <td class="primary-cell"><input data-c="${i}" data-cf="label" value="${esc(c.label || '')}" placeholder="e.g. Rails"></td>
            <td data-label="Category"><select data-c="${i}" data-cf="category">${C.CATEGORIES.map(k => opt(k, k, c.category)).join('')}</select></td>
            <td data-label="Material"><select data-c="${i}" data-cf="material_id">${materialOptions(c.material_id, c.category, '(choose)')}</select></td>
            <td data-label="Qty" class="num"><input data-c="${i}" data-cf="qty" value="${esc(c.qty)}" inputmode="decimal" style="width:80px;text-align:right"></td>
            <td data-label="Per"><select data-c="${i}" data-cf="rule">${Object.entries(C.RULES).map(([k, v]) => opt(k, v, c.rule)).join('')}</select></td>
            <td data-label="Waste %" class="num"><input data-c="${i}" data-cf="waste_pct" value="${esc(c.waste_pct === null || c.waste_pct === undefined ? '' : c.waste_pct)}" placeholder="material" inputmode="decimal" style="width:90px;text-align:right"></td>
            <td class="nowrap">
              <button type="button" class="btn-sm btn-ghost btn-icon" data-move="${i}" data-dir="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>&uarr;</button>
              <button type="button" class="btn-sm btn-ghost btn-icon" data-move="${i}" data-dir="1" aria-label="Move down"${i === comps.length - 1 ? ' disabled' : ''}>&darr;</button>
              <button type="button" class="btn-sm btn-ghost" data-del-comp="${i}">Remove</button>
            </td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty small">No components yet. Add posts, rails, pickets, concrete, hardware...</div>';
    }
    function preview() {
      const f = readFields(form);
      const len = C.parseLength($('#t-len').value) || 0;
      const corners = Math.max(0, parseInt($('#t-corners').value, 10) || 0);
      const gates = Math.max(0, parseInt($('#t-gates').value, 10) || 0);
      // Split the test length into (corners + 1) equal connected runs
      const n = corners + 1;
      const runs = Array.from({ length: n }, (_, i) => ({ length: len / n, joinPrev: i > 0 }));
      const ft = Object.assign({}, f, { components: comps.map((c, i) => Object.assign({}, c, { id: c.id || 'new' + i, qty: num(c.qty), material_id: c.material_id ? Number(c.material_id) : null })) });
      const r = C.computeEstimate({
        estimate: { runs, gates: Array.from({ length: gates }, () => ({ width: 4, leaves: 1, run: 0 })), height: f.default_height, post_spacing: f.post_spacing,
          labor_price_per_ft: f.labor_price_per_ft, labor_cost_per_ft: f.labor_cost_per_ft, labor_price_per_gate: f.labor_price_per_gate, labor_cost_per_gate: f.labor_cost_per_gate, tax_rate: 0 },
        fenceType: ft, materialsById: S.matById, suppliersById: S.supById, settings: S.settings,
      });
      const t = r.totals;
      $('#preview').innerHTML = `
        <p class="small muted">${r.geometry.posts.total} posts (${r.geometry.posts.line} line, ${r.geometry.posts.corner} corner, ${r.geometry.posts.end} end, ${r.geometry.posts.gate} gate), ${r.geometry.sections} sections</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Price</th></tr></thead><tbody>
        ${r.lines.map(l => `<tr><td>${esc(l.label)}<div class="muted small">${esc(l.name)}</div></td><td class="num">${qtyFmt(l.qty)} ${esc(l.unit)}</td><td class="num">${money(l.cost)}</td><td class="num">${money(l.price)}</td></tr>`).join('')}
        </tbody></table></div>
        <table class="totals" style="max-width:340px;margin-left:auto">
          <tr><td>Materials</td><td>${money(t.materials_price)}</td></tr>
          <tr><td>Labour</td><td>${money(t.labor_price)}</td></tr>
          <tr class="grand"><td>Before tax</td><td>${money(t.taxable)}</td></tr>
          <tr class="internal"><td>Per ${unit()}</td><td>${money(len ? t.taxable / len : 0)}</td></tr>
          <tr class="internal"><td>Margin</td><td>${qtyFmt(t.margin_pct)}%</td></tr>
        </table>`;
    }
    drawComps();
    preview();

    form.addEventListener('input', ev => {
      dirty = true;
      const t = ev.target;
      if (t.dataset.c !== undefined && t.tagName === 'INPUT') comps[+t.dataset.c][t.dataset.cf] = t.value;
      preview();
    });
    form.addEventListener('change', ev => {
      const t = ev.target;
      if (t.dataset.c === undefined || t.tagName !== 'SELECT') return;
      const c = comps[+t.dataset.c];
      c[t.dataset.cf] = t.dataset.cf === 'material_id' ? (Number(t.value) || null) : t.value;
      if (t.dataset.cf === 'category') {
        const m = S.matById[c.material_id];
        if (m && m.category !== c.category) c.material_id = null;
        drawComps();
      }
      dirty = true;
      preview();
    });
    form.addEventListener('click', async ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.id === 'add-comp') {
        comps.push({ label: '', category: 'post', material_id: null, rule: 'per_post', qty: 1, waste_pct: null });
        dirty = true; drawComps(); preview();
      } else if (b.dataset.delComp !== undefined) {
        comps.splice(+b.dataset.delComp, 1); dirty = true; drawComps(); preview();
      } else if (b.dataset.move !== undefined) {
        const i = +b.dataset.move, j = i + Number(b.dataset.dir);
        [comps[i], comps[j]] = [comps[j], comps[i]];
        dirty = true; drawComps(); preview();
      } else if (b.id === 'del') {
        if (!confirm(`Delete fence type "${src.name}"? Saved estimates keep their saved totals.`)) return;
        await api('DELETE', `/api/fence-types/${id}`);
        await loadAll();
        go('#/fence-types');
      } else if (b.id === 'dup') {
        const body = Object.assign(readFields(form), { name: readFields(form).name + ' (copy)', components: comps.map(c => Object.assign({}, c, { id: undefined })) });
        const saved = await api('POST', '/api/fence-types', body);
        await loadAll();
        go('#/fence-type/' + saved.id);
      }
    });
    ['t-len', 't-corners', 't-gates'].forEach(i => $('#' + i).addEventListener('input', preview));
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const body = readFields(form);
      body.components = comps.map(c => ({
        id: c.id, label: c.label, category: c.category, material_id: c.material_id ? Number(c.material_id) : null,
        rule: c.rule, qty: num(c.qty), waste_pct: c.waste_pct === '' || c.waste_pct === null || c.waste_pct === undefined ? null : num(c.waste_pct), notes: c.notes || null,
      }));
      try {
        await api(id ? 'PUT' : 'POST', id ? `/api/fence-types/${id}` : '/api/fence-types', body);
        await loadAll();
        dirty = false;
        toast('Fence type saved');
        go('#/fence-types');
      } catch (err) { toast(err.message, true); }
    });
  }

  // =====================================================================
  // Settings
  // =====================================================================
  async function viewSettings() {
    const s = S.settings;
    const auth = await api('GET', '/api/auth');
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    view.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <form id="f">
        <section class="card">
          <h2>Company (shown on quotes)</h2>
          <div class="grid cols-2">
            ${field('Company name', 'company_name', s.company_name, { cls: 'span-all' })}
            ${field('Phone', 'company_phone', s.company_phone, { inputType: 'tel' })}
            ${field('Email', 'company_email', s.company_email, { inputType: 'email' })}
            ${field('Address', 'company_address', s.company_address, { type: 'textarea', rows: 2, cls: 'span-all' })}
          </div>
        </section>
        <section class="card">
          <h2>Pricing defaults</h2>
          <div class="grid cols-3">
            ${field('Currency symbol', 'currency_symbol', s.currency_symbol, { hint: 'e.g. $, BBD $, US$' })}
            ${field('Length unit', 'length_unit', s.length_unit, { type: 'select', options: [opt('ft', 'feet (ft)', s.length_unit), opt('m', 'metres (m)', s.length_unit)].join(''), hint: 'Recipes and labour rates use this unit' })}
            ${field('Default markup on cost', 'default_markup_pct', s.default_markup_pct, { suffix: '%', hint: 'Used when a material has no quoted price' })}
            ${field('Tax name', 'tax_label', s.tax_label)}
            ${field('Tax rate', 'tax_rate', s.tax_rate, { suffix: '%' })}
            ${field('Deposit', 'deposit_pct', s.deposit_pct, { suffix: '%' })}
          </div>
        </section>
        <section class="card">
          <h2>Quotes</h2>
          <div class="grid cols-3">
            ${field('Quote number prefix', 'estimate_prefix', s.estimate_prefix)}
            ${field('Next quote number', 'next_estimate_number', s.next_estimate_number)}
            ${field('Quote valid for (days)', 'quote_valid_days', s.quote_valid_days)}
            ${field('Terms & conditions', 'quote_terms', s.quote_terms, { type: 'textarea', rows: 5, cls: 'span-all' })}
          </div>
        </section>
        <div class="row end"><button class="btn-primary" type="submit">Save settings</button></div>
      </form>
      <section class="card" style="margin-top:14px">
        <h2>Backup</h2>
        <p class="muted small" style="margin-top:0">Download everything (materials, suppliers, fence types, estimates, settings) as one file. Restoring replaces all current data. Drawing images are not included in the file.</p>
        <div class="row">
          <button type="button" id="backup">Download backup</button>
          <button type="button" id="restore">Restore from backup</button>
          <input type="file" id="restore-file" accept=".json,application/json" hidden>
        </div>
      </section>
      ${auth.required ? '<section class="card"><h2>Account</h2><button type="button" id="logout">Sign out</button></section>' : `
      <section class="card"><h2>Security</h2><p class="muted small" style="margin:0">No password is set. Before putting this app on the internet, set the <code>APP_PASSWORD</code> environment variable on the server (see README).</p></section>`}`;

    $('#f').addEventListener('input', () => { dirty = true; });
    $('#f').addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        S.settings = await api('PUT', '/api/settings', readFields($('#f')));
        await loadAll();
        dirty = false;
        toast('Settings saved');
      } catch (err) { toast(err.message, true); }
    });
    $('#backup').addEventListener('click', async () => {
      const data = await api('GET', '/api/backup');
      download(`fence-estimator-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
    });
    $('#restore').addEventListener('click', () => $('#restore-file').click());
    $('#restore-file').addEventListener('change', async () => {
      const file = $('#restore-file').files[0];
      $('#restore-file').value = '';
      if (!file) return;
      if (!confirm('Replace ALL current data with this backup? This cannot be undone.')) return;
      try {
        await api('POST', '/api/restore', JSON.parse(await file.text()));
        await loadAll();
        toast('Backup restored');
        viewSettings();
      } catch (err) { toast('Restore failed: ' + err.message, true); }
    });
    if ($('#logout')) $('#logout').addEventListener('click', async () => { await api('POST', '/api/logout'); showLogin(); });
  }

  // ---------- start ----------
  async function start() {
    try {
      const auth = await api('GET', '/api/auth');
      if (!auth.authed) return showLogin();
      await loadAll();
      route();
    } catch (err) {
      if (err.message !== 'Login required') view.innerHTML = `<div class="card"><h2>Can't reach the server</h2><p>${esc(err.message)}</p></div>`;
    }
  }
  start();
})();
