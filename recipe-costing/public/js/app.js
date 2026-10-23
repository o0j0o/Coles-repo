/* Recipe costing single page app (no framework, no build step). */
(function () {
  'use strict';

  const C = window.RecipeCalc;
  const S = { settings: {}, ingredients: [], energy: [], equipment: [], recipes: [], ingById: {}, enById: {}, eqById: {}, recById: {} };
  const view = document.getElementById('view');

  // ---------- utilities ----------
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = C.num;
  const metric = () => S.settings.unit_system !== 'imperial';
  function money(n, precise) {
    const v = Number(n) || 0;
    const digits = precise && Math.abs(v) < 0.1 && v !== 0 ? 4 : 2;
    const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return (v < 0 ? '-' : '') + (S.settings.currency_symbol || '$') + s;
  }
  function qtyFmt(n) {
    const v = Number(n) || 0;
    const a = Math.abs(v);
    return v.toLocaleString(undefined, { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3 });
  }
  // "2.5 kg", tidied into a sensible unit.
  function amount(qty, unit) {
    const t = C.tidy(qty, unit);
    return `${qtyFmt(t.qty)} ${t.unit}`;
  }
  function altAmount(qty, unit) {
    const a = C.alt(qty, unit);
    return a ? amount(a.qty, a.unit) : '';
  }
  function plural(word, n) {
    word = word || 'pack';
    if (n === 1) return word;
    return /(s|x|ch|sh)$/.test(word) ? word + 'es' : word + 's';
  }
  function pct(n) { return n == null ? '' : qtyFmt(n) + '%'; }
  function dateFmt(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + (s.length <= 10 ? 'T00:00:00' : (s.length <= 19 ? 'Z' : '')));
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function opt(value, label, selected) {
    return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
  }
  const today = () => new Date().toISOString().slice(0, 10);

  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, isError ? 4500 : 2600);
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
    S.ingredients = d.ingredients;
    S.energy = d.energy_sources;
    S.equipment = d.equipment;
    S.recipes = d.recipes;
    S.ingById = Object.fromEntries(S.ingredients.map(x => [x.id, x]));
    S.enById = Object.fromEntries(S.energy.map(x => [x.id, x]));
    S.eqById = Object.fromEntries(S.equipment.map(x => [x.id, x]));
    S.recById = Object.fromEntries(S.recipes.map(x => [x.id, x]));
    $('#brand-name').textContent = S.settings.company_name || 'Recipe Costing';
  }

  function compute(recipe, scale) {
    return C.computeRecipe({
      recipe, scale, settings: S.settings,
      ingredientsById: S.ingById, equipmentById: S.eqById, energyById: S.enById,
    });
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

  // Unit picker. allowed limits it to some of weight / volume / count.
  const DIM_OF_GROUP = { Weight: 'weight', Volume: 'volume', Count: 'count' };
  function unitOptionsFor(selected, allowed) {
    return C.UNIT_GROUPS.filter(([g]) => !allowed || allowed.includes(DIM_OF_GROUP[g]))
      .map(([g, units]) => `<optgroup label="${g}">${units.map(u => opt(u, u, selected)).join('')}</optgroup>`).join('');
  }

  function ingredientOptions(selected, withNew) {
    const list = S.ingredients.filter(i => i.active || i.id === Number(selected));
    const groups = {};
    list.forEach(i => { (groups[i.category] = groups[i.category] || []).push(i); });
    let html = opt('', '(choose ingredient)', selected || '');
    C.INGREDIENT_CATEGORIES.concat(Object.keys(groups).filter(k => !C.INGREDIENT_CATEGORIES.includes(k))).forEach(cat => {
      if (!groups[cat]) return;
      html += `<optgroup label="${esc(cat)}">` + groups[cat].map(i => opt(i.id, i.name, selected)).join('') + '</optgroup>';
    });
    if (withNew) html += opt('__new', '+ New ingredient…', '');
    return html;
  }

  function energyOptions(selected) {
    return opt('', '(choose fuel / energy)', selected || '') +
      S.energy.filter(e => e.active || e.id === Number(selected)).map(e => opt(e.id, `${e.name} (${e.unit})`, selected)).join('');
  }

  // "lb per hour / per run / per day" choices for a fuel or energy line.
  function perOptions(unitName, per) {
    return opt('hour', unitName + ' per hour', per) + opt('run', unitName + ' per run', per) + opt('day', unitName + ' per day', per);
  }

  function equipmentOptions(selected) {
    return opt('', '(no equipment / hand work)', selected || '') +
      S.equipment.filter(e => e.active || e.id === Number(selected)).map(e => opt(e.id, e.name, selected)).join('');
  }

  function statBox(k, v, sub) {
    return `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</div>`;
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

  // Cost of a purchase unit, shown the way people buy it.
  function ingredientUnitCosts(ing) {
    const d = C.dim(ing.purchase_unit);
    const units = d === 'weight' ? (metric() ? ['kg', 'lb'] : ['lb', 'kg']) : d === 'volume' ? (metric() ? ['L', 'gal'] : ['gal', 'L']) : ['each'];
    return units.map(u => {
      const c = C.ingredientCost(ing, 1, u);
      return Number.isFinite(c) ? `${money(c, true)} / ${u}` : null;
    }).filter(Boolean).join(' · ');
  }

  // ---------- navigation ----------
  const ICONS = {
    recipes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5M8 7h8M8 11h6"/></svg>',
    ingredients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c0-2 1-3 3-3M7 8c-3 2-3 7-1 10s5 4 6 4 4-1 6-4 2-8-1-10-5-1-5-1-2-1-5 1z"/></svg>',
    equipment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="12" rx="2"/><path d="M7 7V5M17 7V5M3 12h18M8 16h2"/></svg>',
    energy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  };
  const NAV = [
    ['#/', 'Recipes', 'recipes', ['', 'recipe']],
    ['#/ingredients', 'Ingredients', 'ingredients', ['ingredients']],
    ['#/equipment', 'Equipment', 'equipment', ['equipment']],
    ['#/energy', 'Energy', 'energy', ['energy']],
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
    view.onclick = view.oninput = view.onchange = null;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    renderNav(true);
    window.scrollTo(0, 0);
    const [a, b, c] = parts;
    const id = b === 'new' ? null : Number(b);
    try {
      if (!a) return viewRecipes();
      if (a === 'recipe' && b && c === 'make') return viewMake(Number(b));
      if (a === 'recipe' && b) return viewRecipe(id);
      if (a === 'ingredients') return b ? viewIngredient(id) : viewIngredients();
      if (a === 'equipment') return b ? viewEquipment(id) : viewEquipmentList();
      if (a === 'energy') return b ? viewEnergy(id) : viewEnergyList();
      if (a === 'settings') return await viewSettings();
      view.innerHTML = '<div class="empty">Page not found. <a href="#/">Go to recipes</a></div>';
    } catch (err) {
      if (err.message === 'Login required') return;
      console.error(err);
      view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a href="#/">Back to recipes</a></div>`;
    }
  }

  // ---------- login ----------
  function showLogin() {
    renderNav(false);
    leaveGuard = null;
    view.innerHTML = `
      <form class="card login" id="login">
        <img class="login-logo" src="/img/logo.jpg" alt="Black Belly Smokers">
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

  // ---------- shared cost display ----------
  function costBreakdown(res, opts) {
    const t = res.totals;
    const parts = [
      ['k-ing', 'Ingredients', t.ingredients],
      ['k-pack', 'Packaging', t.packaging],
      ['k-energy', 'Energy & fuel', t.energy],
      ['k-equip', 'Equipment depreciation', t.equipment],
      ['k-labor', `Labour (${qtyFmt(t.laborHours)} h)`, t.labor],
    ];
    const bar = t.total > 0 ? parts.map(([c, , v]) => `<span class="${c}" style="width:${(v / t.total * 100).toFixed(2)}%"></span>`).join('') : '';
    const packName = (opts && opts.packName) || 'pack';
    const u = res.output.unit;
    const per = [];
    if (t.perPack != null) per.push([`Cost per ${packName}`, money(t.perPack)]);
    per.push([`Cost per ${u}`, money(t.perYieldUnit, true)]);
    if (t.perKg != null && u !== 'kg') per.push(['Cost per kg', money(t.perKg)]);
    if (t.perLb != null && u !== 'lb') per.push(['Cost per lb', money(t.perLb)]);
    if (t.perL != null && u !== 'L' && C.dim(u) === 'volume') per.push(['Cost per L', money(t.perL)]);
    const sellUnit = res.packs > 0 ? packName : u;
    return `
      <div class="bar">${bar}</div>
      <div class="legend">
        ${parts.map(([c, k, v]) => `<i class="${c}"></i><span>${esc(k)}</span><span class="v">${money(v)}</span>`).join('')}
      </div>
      <table class="totals" style="margin-top:.6rem">
        <tr class="grand"><td>Total batch cost</td><td>${money(t.total)}</td></tr>
        ${per.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}
        ${t.sellPrice ? `
          <tr><td>Selling price per ${esc(sellUnit)}</td><td>${money(t.sellPrice)}</td></tr>
          <tr><td>Batch sales value</td><td>${money(t.revenue)}</td></tr>
          <tr><td><b>Gross profit</b></td><td><b>${money(t.profit)}</b> (${pct(t.margin)})</td></tr>` : ''}
        ${t.suggestedPrice ? `<tr class="internal"><td>Price for ${esc(S.settings.target_margin_pct || 0)}% margin</td><td>${money(t.suggestedPrice)} / ${esc(sellUnit)}</td></tr>` : ''}
      </table>
      ${res.warnings.length ? `<div class="notice" style="margin-top:.8rem">Check these:<ul>${res.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`;
  }

  // =====================================================================
  // Recipes list
  // =====================================================================
  function viewRecipes() {
    const pref = sessionStorage.getItem('recipe-filter') || '';
    view.innerHTML = `
      <div class="page-head">
        <h1>Recipes</h1>
        <a class="btn btn-primary" href="#/recipe/new">+ New recipe</a>
      </div>
      <div class="card">
        <div class="search-bar">
          <input type="search" id="q" placeholder="Search recipes">
          <select id="pr">${opt('', 'All products', pref)}${C.PRODUCTS.map(p => opt(p, p[0].toUpperCase() + p.slice(1), pref)).join('')}</select>
        </div>
        <div id="list"></div>
      </div>
      ${S.ingredients.length ? '' : '<div class="notice info">Start by adding your <a href="#/ingredients">ingredients</a> with what you pay for them.</div>'}`;
    const draw = () => {
      const q = $('#q').value.toLowerCase();
      const pr = $('#pr').value;
      sessionStorage.setItem('recipe-filter', pr);
      const rows = S.recipes.filter(r => (!pr || r.product === pr) && (!q || [r.name, r.code, r.product, r.description].join(' ').toLowerCase().includes(q)));
      $('#list').innerHTML = rows.length ? `<div class="list">${rows.map(r => {
        const res = compute(r);
        const t = res.totals;
        const each = res.packs > 0 ? `${money(t.perPack)} / ${esc(r.pack_name || 'pack')}` : `${money(t.perYieldUnit)} / ${esc(r.yield_unit)}`;
        return `
        <a class="list-item" href="#/recipe/${r.id}/make">
          <div class="main">
            <div class="title">${esc(r.name)} ${r.code ? `<span class="muted small">${esc(r.code)}</span>` : ''}</div>
            <div class="sub">${esc([r.product, 'makes ' + amount(r.yield_qty, r.yield_unit), res.packs ? `${res.packs} ${plural(r.pack_name, res.packs)}` : ''].filter(Boolean).join(' · '))}</div>
            <div class="sub">Batch cost ${money(t.total)}${t.margin != null ? ` · margin ${pct(t.margin)}` : ''}</div>
          </div>
          <div class="right">
            <div class="amount">${each}</div>
            ${r.active ? '' : '<span class="badge">inactive</span>'}
            ${res.warnings.length ? '<span class="badge declined">check</span>' : ''}
          </div>
        </a>`;
      }).join('')}</div>`
        : `<div class="empty">${S.recipes.length ? 'No recipes match.' : 'No recipes yet. Tap <b>New recipe</b> to add one.'}</div>`;
    };
    $('#q').addEventListener('input', draw);
    $('#pr').addEventListener('change', draw);
    draw();
  }

  // =====================================================================
  // Recipe editor
  // =====================================================================
  function newRecipe() {
    return {
      name: '', product: C.PRODUCTS[0], code: '', description: '',
      yield_qty: '', yield_unit: metric() ? 'kg' : 'lb', density: '',
      pack_name: '', pack_qty: '', pack_unit: '', sell_price: '',
      lines: [], steps: [], method: '', notes: '', active: 1,
    };
  }

  function copyRecipe(r) {
    const out = JSON.parse(JSON.stringify(r));
    out.lines = out.lines || [];
    out.steps = (out.steps || []).map(s => Object.assign({ energy: [] }, s));
    return out;
  }

  // Quick "add an ingredient" form used from inside the recipe editor.
  function quickIngredient() {
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.innerHTML = `
        <form method="dialog" id="qi">
          <h2>New ingredient</h2>
          <div class="grid cols-2">
            ${field('Name', 'name', '', { required: true, cls: 'span-all', placeholder: 'e.g. Pimento wood chips' })}
            ${field('Category', 'category', 'other', { type: 'select', options: C.INGREDIENT_CATEGORIES.map(c => opt(c, c, 'other')).join('') })}
            ${field('Price paid', 'purchase_price', '', { type: 'num', prefix: S.settings.currency_symbol })}
            ${field('For this much', 'purchase_qty', 1, { type: 'num' })}
            ${field('Unit', 'purchase_unit', metric() ? 'kg' : 'lb', { type: 'select', options: unitOptionsFor(metric() ? 'kg' : 'lb') })}
          </div>
          <p class="small muted">You can add density, trim loss and supplier later on the Ingredients page.</p>
          <div class="row end"><button value="cancel" formnovalidate>Cancel</button><button class="btn-primary" value="ok">Add ingredient</button></div>
        </form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('close', async () => {
        const data = readFields(dlg);
        dlg.remove();
        if (dlg.returnValue !== 'ok' || !data.name) return resolve(null);
        try {
          data.price_date = today();
          const ing = await api('POST', '/api/ingredients', data);
          S.ingredients.push(ing);
          S.ingredients.sort((a, b) => a.name.localeCompare(b.name));
          S.ingById[ing.id] = ing;
          toast('Ingredient added');
          resolve(ing);
        } catch (err) { toast(err.message, true); resolve(null); }
      });
      dlg.showModal();
    });
  }

  function viewRecipe(id) {
    const src = id ? S.recById[id] : newRecipe();
    if (!src) { view.innerHTML = '<div class="empty">Recipe not found. <a href="#/">Back</a></div>'; return; }
    const r = copyRecipe(src);
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('You have unsaved changes. Leave without saving?'));

    function markDirty() {
      dirty = true;
      const dot = $('#dirty');
      if (dot) dot.classList.remove('hidden');
    }

    function renderAll() {
      view.innerHTML = `
        <div class="page-head">
          <a class="btn btn-ghost btn-sm" href="${id ? `#/recipe/${id}/make` : '#/'}">&larr; ${id ? 'Back' : 'Recipes'}</a>
          <h1>${id ? esc(r.name) : 'New recipe'}</h1>
        </div>
        <div class="split">
          <div>
            <section class="card" id="basics">
              <h2>Recipe</h2>
              <div class="grid cols-2">
                ${field('Name', 'name', r.name, { required: true, cls: 'span-all', placeholder: 'e.g. Bajan pepper sauce, hot' })}
                ${field('Product', 'product', r.product, { type: 'select', options: C.PRODUCTS.concat(C.PRODUCTS.includes(r.product) ? [] : [r.product]).map(p => opt(p, p, r.product)).join('') })}
                ${field('Code / SKU', 'code', r.code)}
                ${field('Description', 'description', r.description, { cls: 'span-all' })}
              </div>
            </section>
            <section class="card" id="output">
              <h2>What one batch makes</h2>
              <div class="grid cols-3">
                ${field('Finished yield', 'yield_qty', r.yield_qty, { type: 'num', hint: 'Weigh or measure what comes out, after cooking or drying' })}
                ${field('Yield unit', 'yield_unit', r.yield_unit, { type: 'select', options: unitOptionsFor(r.yield_unit) })}
                ${field('Product density', 'density', r.density, { type: 'num', suffix: 'g/ml', hint: 'Only needed to switch between weight and volume. Water = 1, rum ≈ 0.95' })}
                ${field('Pack name', 'pack_name', r.pack_name, { placeholder: 'bottle, pouch, tub' })}
                ${field('Pack size', 'pack_qty', r.pack_qty, { type: 'num', hint: 'Leave blank if you sell it loose' })}
                ${field('Pack unit', 'pack_unit', r.pack_unit, { type: 'select', options: opt('', '(none)', r.pack_unit) + unitOptionsFor(r.pack_unit) })}
                ${field(`Selling price per ${r.pack_qty ? (r.pack_name || 'pack') : (r.yield_unit || 'unit')}`, 'sell_price', r.sell_price, { type: 'num', prefix: S.settings.currency_symbol, hint: 'Optional. Shows your margin' })}
              </div>
            </section>
            <section class="card">
              <h2><span class="grow">Ingredients &amp; packaging</span></h2>
              <p class="muted small" style="margin-top:0">Amounts for one batch. Packaging such as bottles, caps and labels is usually <b>per pack</b>, so it follows the number of packs filled.</p>
              <div class="line-row line-head"><span>Ingredient</span><span>Amount</span><span>Unit</span><span>Basis</span><span>Note</span><span>Cost</span><span></span></div>
              <div id="lines"></div>
              <div class="row" style="margin-top:10px">
                <button type="button" class="btn-sm" data-act="add-line">+ Ingredient</button>
                <button type="button" class="btn-sm" data-act="add-pack-line">+ Packaging</button>
              </div>
            </section>
            <section class="card">
              <h2>Process, equipment &amp; energy</h2>
              <p class="muted small" style="margin-top:0">Each step can use a smoker, grill or piece of kitchen equipment (its depreciation and upkeep per hour of use is costed) and fuel or electricity. Use <b>days in fridge / freezer</b> for curing, marinating and storage. Labour is person-hours at ${money(S.settings.labor_rate)}/h (change it in Settings).</p>
              <div id="steps"></div>
              <button type="button" class="btn-sm" data-act="add-step">+ Step</button>
            </section>
            <section class="card" id="method">
              <h2>Method &amp; notes</h2>
              <div class="grid">
                ${field('Method', 'method', r.method, { type: 'textarea', rows: 8, placeholder: 'Step by step instructions, temperatures, times, hold points' })}
                ${field('Notes', 'notes', r.notes, { type: 'textarea', rows: 3 })}
                ${field('Active', 'active', r.active, { type: 'checkbox' })}
              </div>
            </section>
            ${id ? `<div class="row"><button type="button" class="btn-danger" data-act="delete">Delete recipe</button><button type="button" data-act="duplicate">Duplicate</button></div>` : ''}
          </div>
          <div class="sticky">
            <section class="card">
              <h2>Batch cost</h2>
              <div id="summary"></div>
            </section>
          </div>
        </div>
        <div class="save-bar">
          <div class="inner">
            <span id="dirty" class="dirty-dot${dirty ? '' : ' hidden'}" title="Unsaved changes"></span>
            <span class="total" id="bar-total"></span>
            <span class="spacer"></span>
            ${id ? `<a class="btn" href="#/recipe/${id}/make">Make a batch</a>` : ''}
            <button class="btn-primary" data-act="save">Save</button>
          </div>
        </div>`;
      renderLines();
      renderSteps();
      recalc();
    }

    function renderLines() {
      $('#lines').innerHTML = r.lines.length ? r.lines.map((l, i) => {
        const ing = S.ingById[l.ingredient_id];
        return `
        <div class="line-row" data-line="${i}">
          <select class="c-ing" data-k="ingredient_id" aria-label="Ingredient">${ingredientOptions(l.ingredient_id, true)}</select>
          <input class="c-qty" data-k="qty" value="${esc(l.qty)}" inputmode="decimal" aria-label="Amount" placeholder="0">
          <select class="c-unit" data-k="unit" aria-label="Unit">${unitOptionsFor(l.unit)}</select>
          <select class="c-basis" data-k="basis" aria-label="Basis">${opt('batch', 'per batch', l.basis)}${opt('per_pack', 'per pack', l.basis)}</select>
          <input class="c-note note" data-k="note" value="${esc(l.note || '')}" placeholder="${ing && ing.category === 'cure' ? 'e.g. 2.5 g per kg meat' : 'note'}" aria-label="Note">
          <span class="cost" id="lc-${i}"></span>
          <button type="button" class="btn-icon btn-ghost c-del" data-act="del-line" data-i="${i}" aria-label="Remove">✕</button>
          <span class="warn hidden" id="lw-${i}"></span>
        </div>`;
      }).join('') : '<div class="empty">No ingredients yet.</div>';
    }

    function fuelRows(list, si) {
      return list.map((e, j) => {
        const en = S.enById[e.energy_id];
        const u = en ? en.unit : 'units';
        return `
        <div class="fuel-row" data-step="${si}" data-fuel="${j}">
          <select data-k="energy_id" aria-label="Fuel or energy">${energyOptions(e.energy_id)}</select>
          <input data-k="qty" value="${esc(e.qty)}" inputmode="decimal" aria-label="Amount used">
          <select data-k="per" aria-label="Per">${perOptions(u, e.per)}</select>
          <button type="button" class="btn-icon btn-ghost" data-act="del-fuel" data-step="${si}" data-fuel="${j}" aria-label="Remove">✕</button>
        </div>`;
      }).join('');
    }

    function renderSteps() {
      $('#steps').innerHTML = r.steps.map((s, i) => {
        const hoursLabel = s.scaling === 'loads' ? 'Hours per load' : s.scaling === 'linear' ? 'Hours for this batch' : 'Hours';
        return `
        <div class="step" data-step="${i}">
          <div class="step-head">
            <span class="n">${i + 1}</span>
            <input data-k="label" value="${esc(s.label || '')}" placeholder="e.g. Smoke, Dehydrate, Bottle" aria-label="Step name">
            <button type="button" class="btn-icon btn-ghost" data-act="up-step" data-i="${i}" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>
            <button type="button" class="btn-icon btn-ghost" data-act="del-step" data-i="${i}" aria-label="Remove step">✕</button>
          </div>
          <div class="grid cols-3">
            <label class="field">Equipment<select data-k="equipment_id">${equipmentOptions(s.equipment_id)}</select></label>
            ${s.scaling === 'storage' ? `
              <label class="field">Days stored<input data-k="days" value="${esc(s.days == null ? '' : s.days)}" inputmode="decimal"><span class="hint">e.g. 1 for overnight, 7 for a pastrami cure</span></label>` : `
              <label class="field">${hoursLabel}<input data-k="hours" value="${esc(s.hours)}" inputmode="decimal"></label>`}
            <label class="field">When you scale the batch<select data-k="scaling">${Object.entries(C.STEP_SCALING).map(([k, v]) => opt(k, v, s.scaling || 'fixed')).join('')}</select></label>
            ${s.scaling === 'loads' ? `
              <label class="field">One load makes<input data-k="load_capacity" value="${esc(s.load_capacity == null ? '' : s.load_capacity)}" inputmode="decimal"><span class="hint">Finished product per smoker or dehydrator load</span></label>
              <label class="field">Unit<select data-k="load_unit">${unitOptionsFor(s.load_unit || r.yield_unit)}</select></label>` : ''}
            ${s.scaling === 'storage' ? `
              <label class="field">Amount stored<input data-k="store_qty" value="${esc(s.store_qty == null ? '' : s.store_qty)}" inputmode="decimal" placeholder="${esc(r.yield_qty || '')}"><span class="hint">For this batch, e.g. raw meat plus brine. Blank = finished yield</span></label>
              <label class="field">Unit<select data-k="store_unit">${unitOptionsFor(s.store_unit || r.yield_unit, ['weight', 'volume'])}</select></label>` : ''}
            <label class="field">Labour (person-hours)<input data-k="labor_hours" value="${esc(s.labor_hours || '')}" inputmode="decimal" placeholder="0"><span class="hint">${s.scaling === 'loads' ? 'Per load' : s.scaling === 'linear' ? 'For this batch; grows with it' : 'Per batch'}</span></label>
          </div>
          <div class="sub-h">Fuel &amp; energy</div>
          ${fuelRows(s.energy || [], i)}
          <button type="button" class="btn-sm btn-ghost" data-act="add-fuel" data-i="${i}">+ Fuel / energy</button>
          <div class="step-cost" id="sc-${i}"></div>
        </div>`;
      }).join('') || '<div class="empty">No process steps yet. Add smoking, drying, cooking or bottling here to cost equipment, energy and labour.</div>';
    }

    function recalc() {
      const res = compute(r);
      $('#summary').innerHTML = `
        <div class="small muted">Makes ${amount(res.output.qty, res.output.unit)}${altAmount(res.output.qty, res.output.unit) ? ` (${altAmount(res.output.qty, res.output.unit)})` : ''}${res.packs ? ` · ${res.packs} ${esc(plural(r.pack_name, res.packs))}` : ''}</div>
        ${costBreakdown(res, { packName: r.pack_name })}`;
      $('#bar-total').textContent = money(res.totals.total) + (res.totals.perPack != null ? ` · ${money(res.totals.perPack)}/${r.pack_name || 'pack'}` : '');
      res.lines.forEach(l => {
        const c = $('#lc-' + l.index);
        const w = $('#lw-' + l.index);
        if (c) c.textContent = r.lines[l.index].ingredient_id ? money(l.cost) : '';
        if (w) { w.textContent = r.lines[l.index].ingredient_id ? (l.warning || '') : ''; w.classList.toggle('hidden', !l.warning || !r.lines[l.index].ingredient_id); }
      });
      res.steps.forEach(s => {
        const el = $('#sc-' + s.index);
        if (!el) return;
        const bits = [];
        if (s.runs > 1 || s.scaling === 'loads') bits.push(`${s.runs} ${s.runs === 1 ? 'load' : 'loads'}`);
        if (s.scaling === 'storage') bits.push(`${qtyFmt(s.days)} ${s.days === 1 ? 'day' : 'days'} using ${pct(s.share * 100)} of the space`);
        else if (s.hours) bits.push(`${qtyFmt(s.hours)} h machine time`);
        s.energy.forEach(e => bits.push(`${qtyFmt(e.qty)} ${e.unit} ${e.name} ${money(e.cost)}`));
        if (s.equipmentCost) bits.push(`depreciation ${money(s.equipmentCost)}`);
        if (s.laborHours) bits.push(`labour ${money(s.laborCost)}`);
        el.textContent = (bits.join(' · ') || 'No cost yet') + (s.warning ? ` (${s.warning})` : '');
      });
    }

    const TOP = ['name', 'product', 'code', 'description', 'yield_qty', 'yield_unit', 'density', 'pack_name', 'pack_qty', 'pack_unit', 'sell_price', 'method', 'notes'];

    function onInput(ev) {
      const el = ev.target;
      if (el.name && TOP.includes(el.name)) {
        r[el.name] = el.value;
        if (el.name === 'name') $('h1').textContent = el.value || 'New recipe';
      } else if (el.name === 'active') {
        r.active = el.checked ? 1 : 0;
      } else if (el.dataset.k) {
        const lineEl = el.closest('[data-line]');
        const fuelEl = el.closest('[data-fuel]');
        const stepEl = el.closest('[data-step]');
        if (lineEl) r.lines[+lineEl.dataset.line][el.dataset.k] = el.value;
        else if (fuelEl) r.steps[+fuelEl.dataset.step].energy[+fuelEl.dataset.fuel][el.dataset.k] = el.value;
        else if (stepEl) r.steps[+stepEl.dataset.step][el.dataset.k] = el.value;
        else return;
      } else return;
      markDirty();
      recalc();
    }

    async function onChange(ev) {
      const el = ev.target;
      if (el.tagName !== 'SELECT') return;
      const lineEl = el.closest('[data-line]');
      const fuelEl = el.closest('[data-fuel]');
      const stepEl = el.closest('[data-step]');
      if (lineEl && el.dataset.k === 'ingredient_id') {
        const line = r.lines[+lineEl.dataset.line];
        if (el.value === '__new') {
          const ing = await quickIngredient();
          if (!ing) { el.value = line.ingredient_id || ''; return; }
          el.value = ing.id;
        }
        line.ingredient_id = el.value ? Number(el.value) : '';
        const ing = S.ingById[line.ingredient_id];
        // Start in a unit that can be priced against how it's bought.
        if (ing && !Number.isFinite(C.convert(1, line.unit, ing.purchase_unit, ing.density))) line.unit = ing.purchase_unit;
        if (ing && ing.category === 'packaging' && line.basis !== 'per_pack' && !num(line.qty)) { line.basis = 'per_pack'; line.unit = 'each'; line.qty = 1; }
        markDirty();
        renderLines();
        recalc();
        return;
      }
      if (fuelEl && el.dataset.k === 'energy_id') {
        r.steps[+fuelEl.dataset.step].energy[+fuelEl.dataset.fuel].energy_id = el.value ? Number(el.value) : '';
        markDirty();
        renderSteps();
        recalc();
        return;
      }
      if (stepEl && !fuelEl && el.dataset.k === 'equipment_id') {
        const s = r.steps[+stepEl.dataset.step];
        s.equipment_id = el.value ? Number(el.value) : null;
        const eq = S.eqById[s.equipment_id];
        if (eq) {
          s.energy = (eq.energy_use || []).map(e => Object.assign({}, e));
          if (!s.label) s.label = eq.name;
          if (num(eq.always_on)) {
            s.scaling = 'storage';
            if (!num(s.days)) s.days = 1;
            if (!s.store_unit) s.store_unit = eq.capacity_unit || r.yield_unit;
          } else if (s.scaling === 'storage') s.scaling = 'fixed';
          if (s.energy.length) toast('Fuel use filled in from the equipment. Adjust it for this recipe if needed.');
        }
        markDirty();
        renderSteps();
        recalc();
        return;
      }
      if (stepEl && !fuelEl && el.dataset.k === 'scaling') {
        const s = r.steps[+stepEl.dataset.step];
        s.scaling = el.value;
        if (s.scaling === 'loads' && !s.load_unit) s.load_unit = r.yield_unit;
        if (s.scaling === 'storage' && !s.store_unit) s.store_unit = C.dim(r.yield_unit) === 'count' ? 'kg' : r.yield_unit;
        markDirty();
        renderSteps();
        recalc();
        return;
      }
    }

    async function onClick(ev) {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const i = Number(b.dataset.i);
      if (act === 'add-line') r.lines.push({ ingredient_id: '', qty: '', unit: metric() ? 'g' : 'oz', basis: 'batch', note: '' });
      else if (act === 'add-pack-line') r.lines.push({ ingredient_id: '', qty: 1, unit: 'each', basis: 'per_pack', note: '' });
      else if (act === 'del-line') r.lines.splice(i, 1);
      else if (act === 'add-step') r.steps.push({ label: '', equipment_id: null, hours: '', scaling: 'fixed', energy: [], labor_hours: '' });
      else if (act === 'del-step') { if (!confirm('Remove this step?')) return; r.steps.splice(i, 1); }
      else if (act === 'up-step' && i > 0) { const [s] = r.steps.splice(i, 1); r.steps.splice(i - 1, 0, s); }
      else if (act === 'add-fuel') r.steps[i].energy.push({ energy_id: '', qty: '', per: 'hour' });
      else if (act === 'del-fuel') r.steps[+b.dataset.step].energy.splice(+b.dataset.fuel, 1);
      else if (act === 'save') return save();
      else if (act === 'delete') {
        if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
        await api('DELETE', '/api/recipes/' + id);
        await loadAll();
        toast('Recipe deleted');
        return go('#/');
      } else if (act === 'duplicate') {
        if (dirty && !confirm('Duplicate the saved version? Unsaved changes here are not included.')) return;
        const copy = await api('POST', `/api/recipes/${id}/duplicate`);
        await loadAll();
        toast('Copy created');
        return go('#/recipe/' + copy.id);
      } else return;
      markDirty();
      if (act.includes('line')) renderLines(); else renderSteps();
      recalc();
    }

    async function save() {
      if (!String(r.name || '').trim()) { toast('Give the recipe a name', true); $('[name=name]').focus(); return; }
      if (!(num(r.yield_qty) > 0)) { toast('Enter what one batch makes (finished yield)', true); $('[name=yield_qty]').focus(); return; }
      const body = Object.assign({}, r, {
        lines: r.lines.filter(l => l.ingredient_id),
        steps: r.steps.map(s => Object.assign({}, s, { energy: (s.energy || []).filter(e => e.energy_id) })),
      });
      try {
        const saved = id ? await api('PUT', '/api/recipes/' + id, body) : await api('POST', '/api/recipes', body);
        await loadAll();
        dirty = false;
        toast('Recipe saved');
        go(`#/recipe/${saved.id}/make`, !id);
      } catch (err) { toast(err.message, true); }
    }

    renderAll();
    view.oninput = onInput;
    view.onchange = onChange;
    view.onclick = onClick;
  }

  // =====================================================================
  // Make a batch: scale, cost and print
  // =====================================================================
  function viewMake(id) {
    const r = S.recById[id];
    if (!r) { view.innerHTML = '<div class="empty">Recipe not found. <a href="#/">Back</a></div>'; return; }
    const base = compute(r);
    const key = 'scale-' + id;
    let scale;
    try { scale = JSON.parse(sessionStorage.getItem(key)); } catch { scale = null; }
    if (!scale) {
      scale = base.packs > 0 ? { mode: 'packs', packs: base.packs } : { mode: 'output', qty: r.yield_qty, unit: r.yield_unit };
      scale.factor = 1;
      scale.qty = scale.qty || r.yield_qty;
      scale.unit = scale.unit || r.yield_unit;
      scale.line = 0;
    }
    const batch = r.lines.filter(l => l.basis !== 'per_pack');
    const outputDims = num(r.density) > 0 ? ['weight', 'volume'] : [C.dim(r.yield_unit)];
    let showCosts = true;
    try { showCosts = localStorage.getItem('print-costs') !== '0'; } catch { /* storage unavailable */ }
    const lot = { no: '', date: today() };

    view.innerHTML = `
      <div class="page-head no-print">
        <a class="btn btn-ghost btn-sm" href="#/">&larr; Recipes</a>
        <h1>${esc(r.name)}</h1>
        <a class="btn btn-sm" href="#/recipe/${id}">Edit recipe</a>
        <button class="btn-sm btn-primary" id="print">Print batch sheet</button>
      </div>
      <section class="card no-print">
        <h2>How much do you want to make?</h2>
        <p class="muted small" style="margin-top:0">The saved recipe makes ${amount(r.yield_qty, r.yield_unit)}${base.packs ? ` (${base.packs} ${esc(plural(r.pack_name, base.packs))} of ${esc(qtyFmt(r.pack_qty))} ${esc(r.pack_unit)})` : ''}.</p>
        <div class="seg" id="modes">
          ${[['output', 'Amount'], ['packs', plural(r.pack_name, 2).replace(/^./, c => c.toUpperCase())], ['factor', 'Multiply'], ['ingredient', 'What I have']]
            .filter(([m]) => m !== 'packs' || base.packs > 0 || num(r.pack_qty) > 0)
            .map(([m, label]) => `<button type="button" data-mode="${m}" class="${scale.mode === m ? 'on' : ''}">${esc(label)}</button>`).join('')}
        </div>
        <div class="scale-inputs" id="scale-inputs"></div>
        <div class="grid cols-3" style="margin-top:12px">
          ${field('Lot / batch number', 'lot_no', '', { placeholder: 'For the printout' })}
          ${field('Production date', 'lot_date', lot.date, { inputType: 'date' })}
          <label class="check"><input type="checkbox" id="show-costs"${showCosts ? ' checked' : ''}> Include costs on the printout</label>
        </div>
      </section>
      <div id="result"></div>`;

    function renderInputs() {
      const box = $('#scale-inputs');
      if (scale.mode === 'output') {
        box.innerHTML = `
          <label class="field">Make this much<input id="s-qty" value="${esc(scale.qty)}" inputmode="decimal"></label>
          <label class="field">Unit<select id="s-unit">${unitOptionsFor(scale.unit, outputDims)}</select></label>`;
      } else if (scale.mode === 'packs') {
        box.innerHTML = `<label class="field">Number of ${esc(plural(r.pack_name, 2))}<input id="s-packs" value="${esc(scale.packs)}" inputmode="numeric"><span class="hint">${esc(qtyFmt(r.pack_qty))} ${esc(r.pack_unit)} each</span></label>`;
      } else if (scale.mode === 'factor') {
        box.innerHTML = `<label class="field">Times the recipe<input id="s-factor" value="${esc(scale.factor)}" inputmode="decimal"><span class="hint">2 = double, 0.5 = half</span></label>`;
      } else {
        const line = batch[num(scale.line)];
        const ing = line && S.ingById[line.ingredient_id];
        const dims = ing && num(ing.density) > 0 ? ['weight', 'volume'] : [C.dim(line ? line.unit : 'g')];
        box.innerHTML = `
          <label class="field">Ingredient<select id="s-line">${batch.map((l, i) => opt(i, (S.ingById[l.ingredient_id] || {}).name || '?', scale.line)).join('')}</select>
            <span class="hint">e.g. the meat or peppers you have on hand</span></label>
          <label class="field">I have<input id="s-have" value="${esc(scale.qty)}" inputmode="decimal"></label>
          <label class="field">Unit<select id="s-have-unit">${unitOptionsFor(scale.unit, dims)}</select></label>`;
      }
    }

    function renderResult() {
      try { sessionStorage.setItem(key, JSON.stringify(scale)); } catch { /* storage unavailable */ }
      const res = compute(r, scale);
      const t = res.totals;
      const packLines = res.lines.filter(l => l.basis === 'per_pack');
      const ingLines = res.lines.filter(l => l.basis !== 'per_pack');
      const costCls = showCosts ? '' : ' no-print';
      const scaleText = `×${qtyFmt(res.factor)} of the saved recipe`;
      $('#result').innerHTML = `
        <div class="print-only">
          <div class="sheet-head">
            <img src="/img/logo.jpg" alt="">
            <div>
              <h1>${esc(r.name)}</h1>
              <p>${esc(S.settings.company_name || '')} · Batch sheet${lot.no ? ` · Lot <b>${esc(lot.no)}</b>` : ''}</p>
              <p>${esc(dateFmt(lot.date))} · ${esc(scaleText)}</p>
            </div>
          </div>
        </div>
        <div class="stats" style="margin-bottom:14px">
          ${statBox('Makes', amount(res.output.qty, res.output.unit), altAmount(res.output.qty, res.output.unit))}
          ${res.packs || num(r.pack_qty) ? statBox(plural(r.pack_name, 2), res.packs, res.leftover && res.leftover.qty > 1e-6 ? `${amount(res.leftover.qty, res.leftover.unit)} left over` : '') : ''}
          ${statBox('Scale', '×' + qtyFmt(res.factor))}
          <div class="stat${costCls}"><div class="k">Batch cost</div><div class="v">${money(t.total)}</div></div>
          ${t.perPack != null ? `<div class="stat${costCls}"><div class="k">Per ${esc(r.pack_name || 'pack')}</div><div class="v">${money(t.perPack)}</div></div>` : ''}
        </div>
        ${res.warnings.length ? `<div class="notice no-print">Check these:<ul>${res.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        <section class="card">
          <h2>Ingredients</h2>
          <div class="table-wrap"><table class="data cards">
            <thead><tr><th class="tick"></th><th>Ingredient</th><th class="num">Amount</th><th class="num">Also</th><th class="num">% of mix</th><th class="num${costCls}">Cost</th></tr></thead>
            <tbody>${ingLines.map(l => `
              <tr>
                <td class="tick"><span></span></td>
                <td class="primary-cell">${esc(l.name)}${l.note ? `<div class="small muted">${esc(l.note)}</div>` : ''}${l.warning ? `<div class="small" style="color:var(--warn-ink)">${esc(l.warning)}</div>` : ''}</td>
                <td class="num" data-label="Amount"><b>${amount(l.qty, l.unit)}</b></td>
                <td class="num muted" data-label="Also">${altAmount(l.qty, l.unit)}</td>
                <td class="num" data-label="% of mix">${pct(l.pct)}</td>
                <td class="num${costCls}" data-label="Cost">${money(l.cost)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
          ${packLines.length ? `
          <h3 style="margin-top:1rem">Packaging for ${res.packs} ${esc(plural(r.pack_name, res.packs))}</h3>
          <div class="table-wrap"><table class="data cards">
            <tbody>${packLines.map(l => `
              <tr><td class="tick"><span></span></td><td class="primary-cell">${esc(l.name)}</td><td class="num" data-label="Amount"><b>${amount(l.qty, l.unit)}</b></td><td class="num${costCls}" data-label="Cost">${money(l.cost)}</td></tr>`).join('')}
            </tbody>
          </table></div>` : ''}
        </section>
        ${res.steps.length ? `
        <section class="card">
          <h2>Process</h2>
          <div class="table-wrap"><table class="data cards">
            <thead><tr><th>Step</th><th class="num">Loads</th><th class="num">Time</th><th>Fuel &amp; energy</th><th class="num">Labour</th><th class="num${costCls}">Cost</th></tr></thead>
            <tbody>${res.steps.map((s, i) => `
              <tr>
                <td class="primary-cell">${i + 1}. ${esc(s.label)}${s.equipmentName && s.equipmentName !== s.label ? `<div class="small muted">${esc(s.equipmentName)}</div>` : ''}</td>
                <td class="num" data-label="Loads">${s.scaling === 'loads' ? s.runs : ''}</td>
                <td class="num" data-label="Time">${s.scaling === 'storage' ? `${qtyFmt(s.days)} ${s.days === 1 ? 'day' : 'days'}<div class="small muted">${pct(s.share * 100)} of space</div>` : s.hours ? qtyFmt(s.hours) + ' h' : ''}</td>
                <td data-label="Fuel">${s.energy.map(e => `${qtyFmt(e.qty)} ${esc(e.unit)} ${esc(e.name)}`).join('<br>')}</td>
                <td class="num" data-label="Labour">${s.laborHours ? qtyFmt(s.laborHours) + ' h' : ''}</td>
                <td class="num${costCls}" data-label="Cost">${money(s.energyCost + s.equipmentCost + s.laborCost)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
          ${res.energyBySource.length ? `<h3 style="margin-top:1rem">Energy &amp; fuel for this batch</h3>
          <table class="totals">${res.energyBySource.map(e => `<tr><td>${esc(e.name)}</td><td>${qtyFmt(e.qty)} ${esc(e.unit)}<span class="${costCls}"> · ${money(e.cost)}</span></td></tr>`).join('')}</table>` : ''}
        </section>` : ''}
        <section class="card${costCls}">
          <h2>Production cost</h2>
          ${costBreakdown(Object.assign({}, res, { warnings: [] }), { packName: r.pack_name })}
        </section>
        ${r.method ? `<section class="card"><h2>Method</h2><div style="white-space:pre-wrap">${esc(r.method)}</div></section>` : ''}
        ${r.notes ? `<section class="card"><h2>Notes</h2><div style="white-space:pre-wrap">${esc(r.notes)}</div></section>` : ''}`;
    }

    view.oninput = ev => {
      const el = ev.target;
      if (el.id === 's-qty' || el.id === 's-have') scale.qty = el.value;
      else if (el.id === 's-packs') scale.packs = el.value;
      else if (el.id === 's-factor') scale.factor = el.value;
      else if (el.name === 'lot_no') lot.no = el.value;
      else if (el.name === 'lot_date') lot.date = el.value;
      else return;
      renderResult();
    };
    view.onchange = ev => {
      const el = ev.target;
      if (el.id === 's-unit' || el.id === 's-have-unit') scale.unit = el.value;
      else if (el.id === 's-line') {
        scale.line = Number(el.value);
        const line = batch[scale.line];
        scale.qty = line.qty;
        scale.unit = line.unit;
        renderInputs();
      } else if (el.id === 'show-costs') {
        showCosts = el.checked;
        try { localStorage.setItem('print-costs', showCosts ? '1' : '0'); } catch { /* storage unavailable */ }
      } else return;
      renderResult();
    };
    view.onclick = ev => {
      const m = ev.target.closest('[data-mode]');
      if (m) {
        const res = compute(r, scale);
        scale.mode = m.dataset.mode;
        // Carry the current size over to the new mode so switching doesn't jump.
        if (scale.mode === 'output') { scale.qty = +res.output.qty.toFixed(3); scale.unit = res.output.unit; }
        if (scale.mode === 'packs') scale.packs = res.packs || 1;
        if (scale.mode === 'factor') scale.factor = +res.factor.toFixed(3);
        if (scale.mode === 'ingredient') {
          const line = batch[num(scale.line)] || batch[0];
          scale.line = batch.indexOf(line);
          if (line) { scale.qty = +(num(line.qty) * res.factor).toFixed(3); scale.unit = line.unit; }
        }
        $$('#modes button').forEach(b => b.classList.toggle('on', b === m));
        renderInputs();
        renderResult();
      }
      if (ev.target.id === 'print') window.print();
    };

    renderInputs();
    renderResult();
  }

  // =====================================================================
  // Ingredients
  // =====================================================================
  function viewIngredients() {
    const pref = sessionStorage.getItem('ing-filter') || '';
    view.innerHTML = `
      <div class="page-head">
        <h1>Ingredients</h1>
        <a class="btn btn-primary" href="#/ingredients/new">+ New ingredient</a>
      </div>
      <div class="card">
        <div class="search-bar">
          <input type="search" id="q" placeholder="Search ingredients or supplier">
          <select id="cat">${opt('', 'All categories', pref)}${C.INGREDIENT_CATEGORIES.map(c => opt(c, c, pref)).join('')}</select>
        </div>
        <div id="list"></div>
      </div>`;
    const draw = () => {
      const q = $('#q').value.toLowerCase();
      const cat = $('#cat').value;
      sessionStorage.setItem('ing-filter', cat);
      const rows = S.ingredients.filter(i => (!cat || i.category === cat) && (!q || [i.name, i.supplier, i.category].join(' ').toLowerCase().includes(q)));
      $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table class="data cards">
        <thead><tr><th>Ingredient</th><th>Category</th><th class="num">You pay</th><th class="num">Works out to</th><th class="num">Usable</th><th>Price date</th></tr></thead>
        <tbody>${rows.map(i => `
          <tr class="click" data-href="#/ingredients/${i.id}">
            <td class="primary-cell">${esc(i.name)}${i.supplier ? `<div class="small muted">${esc(i.supplier)}</div>` : ''}${i.active ? '' : ' <span class="badge">inactive</span>'}</td>
            <td data-label="Category">${esc(i.category)}</td>
            <td class="num" data-label="You pay">${money(i.purchase_price)} / ${esc(qtyFmt(i.purchase_qty))} ${esc(i.purchase_unit)}</td>
            <td class="num" data-label="Works out to">${ingredientUnitCosts(i)}</td>
            <td class="num" data-label="Usable">${num(i.yield_pct, 100) < 100 ? pct(i.yield_pct) : ''}</td>
            <td data-label="Price date">${dateFmt(i.price_date)}</td>
          </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${S.ingredients.length ? 'Nothing matches.' : 'No ingredients yet.'}</div>`;
    };
    $('#q').addEventListener('input', draw);
    $('#cat').addEventListener('change', draw);
    $('#list').addEventListener('click', e => { const tr = e.target.closest('[data-href]'); if (tr) location.hash = tr.dataset.href; });
    draw();
  }

  function usedInRecipes(test) {
    return S.recipes.filter(test).map(r => `<a href="#/recipe/${r.id}">${esc(r.name)}</a>`).join(', ');
  }

  function viewIngredient(id) {
    const i = id ? S.ingById[id] : { category: 'meat', purchase_qty: 1, purchase_unit: metric() ? 'kg' : 'lb', yield_pct: 100, price_date: today(), active: 1 };
    if (!i) { view.innerHTML = '<div class="empty">Ingredient not found. <a href="#/ingredients">Back</a></div>'; return; }
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    const used = id ? usedInRecipes(r => r.lines.some(l => l.ingredient_id === id)) : '';
    view.innerHTML = `
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/ingredients">&larr; Ingredients</a>
        <h1>${id ? esc(i.name) : 'New ingredient'}</h1>
      </div>
      <form id="f" autocomplete="off">
        <section class="card">
          <h2>Details</h2>
          <div class="grid cols-2">
            ${field('Name', 'name', i.name, { required: true, cls: 'span-all', placeholder: 'e.g. Scotch bonnet peppers' })}
            ${field('Category', 'category', i.category, { type: 'select', options: C.INGREDIENT_CATEGORIES.concat(C.INGREDIENT_CATEGORIES.includes(i.category) ? [] : [i.category]).map(c => opt(c, c, i.category)).join(''), hint: 'Packaging is totalled separately from ingredients' })}
            ${field('Supplier', 'supplier', i.supplier)}
          </div>
        </section>
        <section class="card">
          <h2>What you pay</h2>
          <div class="grid cols-3">
            ${field('Price', 'purchase_price', i.purchase_price, { type: 'num', prefix: S.settings.currency_symbol })}
            ${field('For this much', 'purchase_qty', i.purchase_qty, { type: 'num', hint: 'e.g. 25 for a 25 lb box, 24 for a case of bottles' })}
            ${field('Unit', 'purchase_unit', i.purchase_unit, { type: 'select', options: unitOptionsFor(i.purchase_unit) })}
            ${field('Usable after trimming', 'yield_pct', i.yield_pct, { type: 'num', suffix: '%', hint: 'e.g. 80 if you trim 20% off a brisket. Recipe amounts are the usable weight.' })}
            ${field('Density', 'density', i.density, { type: 'num', suffix: 'g/ml', hint: 'Lets you buy by weight and measure by volume (or the reverse). Water = 1, salt ≈ 1.2, ground spice ≈ 0.5' })}
            ${field('Price date', 'price_date', i.price_date, { inputType: 'date' })}
          </div>
          <div class="stat" id="preview" style="margin-top:12px"></div>
        </section>
        <section class="card">
          <h2>Notes</h2>
          <div class="grid">
            ${field('Notes', 'notes', i.notes, { type: 'textarea' })}
            ${field('Active (offer in recipes)', 'active', i.active, { type: 'checkbox' })}
          </div>
          ${used ? `<p class="small muted">Used in: ${used}</p>` : ''}
        </section>
        <div class="row end">
          ${id ? '<button type="button" class="btn-danger" id="del">Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn-primary">Save ingredient</button>
        </div>
      </form>`;
    const form = $('#f');
    const preview = () => {
      const d = readFields(form);
      const costs = ingredientUnitCosts(d);
      const usable = num(d.yield_pct, 100) < 100 ? ` (allowing for ${qtyFmt(100 - num(d.yield_pct, 100))}% trim)` : '';
      $('#preview').innerHTML = `<div class="k">Cost per usable unit${esc(usable)}</div><div class="v">${costs || '—'}</div>`;
    };
    form.addEventListener('input', () => { dirty = true; preview(); });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        const body = readFields(form);
        if (id) await api('PUT', '/api/ingredients/' + id, body); else await api('POST', '/api/ingredients', body);
        await loadAll();
        dirty = false;
        toast('Ingredient saved');
        go('#/ingredients');
      } catch (err) { toast(err.message, true); }
    });
    if ($('#del')) $('#del').addEventListener('click', async () => {
      if (!confirm(`Delete ${i.name}?`)) return;
      try {
        await api('DELETE', '/api/ingredients/' + id);
        await loadAll();
        go('#/ingredients');
      } catch (err) { toast(err.message, true); }
    });
    preview();
  }

  // =====================================================================
  // Energy sources
  // =====================================================================
  function viewEnergyList() {
    view.innerHTML = `
      <div class="page-head">
        <h1>Energy &amp; fuel</h1>
        <a class="btn btn-primary" href="#/energy/new">+ New</a>
      </div>
      <div class="card">
        <p class="muted small" style="margin-top:0">Electricity, propane, charcoal, pellets and wood chips. Set what you pay here; each piece of equipment and recipe step says how much it uses.</p>
        ${S.energy.length ? `<div class="list">${S.energy.map(e => `
          <a class="list-item" href="#/energy/${e.id}">
            <div class="main">
              <div class="title">${esc(e.name)} ${e.active ? '' : '<span class="badge">inactive</span>'}</div>
              <div class="sub">${esc(e.kind)} · ${money(e.pack_price)} per ${esc(e.pack_label || `${qtyFmt(e.pack_size)} ${e.unit}`)}</div>
            </div>
            <div class="amount">${money(C.energyUnitCost(e), true)} / ${esc(e.unit)}</div>
          </a>`).join('')}</div>` : '<div class="empty">No energy sources yet.</div>'}
      </div>`;
  }

  function viewEnergy(id) {
    const e = id ? S.enById[id] : { kind: 'charcoal', unit: 'lb', pack_size: 1, price_date: today(), active: 1 };
    if (!e) { view.innerHTML = '<div class="empty">Not found. <a href="#/energy">Back</a></div>'; return; }
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    const unitList = C.ENERGY_UNITS.concat(C.ENERGY_UNITS.includes(e.unit) ? [] : [e.unit]);
    view.innerHTML = `
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/energy">&larr; Energy</a>
        <h1>${id ? esc(e.name) : 'New energy source'}</h1>
      </div>
      <form id="f" autocomplete="off">
        <section class="card">
          <div class="grid cols-3">
            ${field('Name', 'name', e.name, { required: true, cls: 'span-all', placeholder: 'e.g. Pimento wood chips, Propane' })}
            ${field('Type', 'kind', e.kind, { type: 'select', options: C.ENERGY_KINDS.map(k => opt(k, k, e.kind)).join('') })}
            ${field('Measured in', 'unit', e.unit, { type: 'select', options: unitList.map(u => opt(u, u, e.unit)).join(''), hint: 'The unit equipment usage is entered in' })}
            ${field('How you buy it', 'pack_label', e.pack_label, { placeholder: 'e.g. 25 lb cylinder, 20 lb bag' })}
            ${field('Price', 'pack_price', e.pack_price, { type: 'num', prefix: S.settings.currency_symbol })}
            ${field('Amount in that purchase', 'pack_size', e.pack_size, { type: 'num', hint: 'In the unit above. Electricity: 1 kWh at your all-in rate' })}
            ${field('Price date', 'price_date', e.price_date, { inputType: 'date' })}
            ${field('Notes', 'notes', e.notes, { type: 'textarea', rows: 2, cls: 'span-all' })}
            ${field('Active', 'active', e.active, { type: 'checkbox' })}
          </div>
          <div class="stat" id="preview" style="margin-top:12px"></div>
          <p class="small muted">Electricity tip: divide your last bill's total (including fuel charge and taxes) by the kWh used to get your real cost per kWh.</p>
          ${id ? `<p class="small muted">${(() => {
            const eqs = S.equipment.filter(q => (q.energy_use || []).some(u => u.energy_id === id)).map(q => `<a href="#/equipment/${q.id}">${esc(q.name)}</a>`).join(', ');
            const recs = usedInRecipes(r => r.steps.some(s => (s.energy || []).some(u => u.energy_id === id)));
            return [eqs && 'Equipment: ' + eqs, recs && 'Recipes: ' + recs].filter(Boolean).join('<br>');
          })()}</p>` : ''}
        </section>
        <div class="row end">
          ${id ? '<button type="button" class="btn-danger" id="del">Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>`;
    const form = $('#f');
    const preview = () => {
      const d = readFields(form);
      $('#preview').innerHTML = `<div class="k">Cost per ${esc(d.unit)}</div><div class="v">${money(C.energyUnitCost(d), true)}</div>`;
    };
    form.addEventListener('input', () => { dirty = true; preview(); });
    form.addEventListener('change', preview);
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        const body = readFields(form);
        if (id) await api('PUT', '/api/energy/' + id, body); else await api('POST', '/api/energy', body);
        await loadAll();
        dirty = false;
        toast('Saved');
        go('#/energy');
      } catch (err) { toast(err.message, true); }
    });
    if ($('#del')) $('#del').addEventListener('click', async () => {
      if (!confirm(`Delete ${e.name}?`)) return;
      try {
        await api('DELETE', '/api/energy/' + id);
        await loadAll();
        go('#/energy');
      } catch (err) { toast(err.message, true); }
    });
    preview();
  }

  // =====================================================================
  // Equipment
  // =====================================================================
  function energyPerHour(list) {
    return (list || []).reduce((s, u) => {
      const rate = u.per === 'run' ? 0 : u.per === 'day' ? num(u.qty) / 24 : num(u.qty);
      return s + rate * C.energyUnitCost(S.enById[u.energy_id]);
    }, 0);
  }

  // Always-on equipment is easier to think about per day; everything else per hour of use.
  function equipmentRates(q, uses) {
    const per = num(q.always_on) ? 24 : 1;
    const wear = C.equipmentHourlyCost(q) * per;
    const energy = energyPerHour(uses || q.energy_use) * per;
    return { label: per === 24 ? 'day' : 'h', wear, energy, total: wear + energy };
  }

  function viewEquipmentList() {
    view.innerHTML = `
      <div class="page-head">
        <h1>Equipment</h1>
        <a class="btn btn-primary" href="#/equipment/new">+ New equipment</a>
      </div>
      <div class="card">
        <p class="muted small" style="margin-top:0">What each machine costs you to own and run. Smokers, grills and kitchen equipment are depreciated by the hours you use them; fridges and freezers that run all the time are costed per day and charged to the batches stored in them.</p>
        ${S.equipment.length ? `<div class="table-wrap"><table class="data cards">
          <thead><tr><th>Equipment</th><th class="num">Depreciation &amp; upkeep</th><th class="num">Energy</th><th class="num">Total</th><th class="num">Book value</th></tr></thead>
          <tbody>${S.equipment.map(q => {
            const r = equipmentRates(q);
            const dep = C.depreciation(q);
            return `
            <tr class="click" data-href="#/equipment/${q.id}">
              <td class="primary-cell">${esc(q.name)} <span class="muted small">${esc(q.kind)}${num(q.always_on) ? ' · always on' : ''}</span>${q.active ? '' : ' <span class="badge">inactive</span>'}</td>
              <td class="num" data-label="Depreciation & upkeep">${money(r.wear)} / ${r.label}</td>
              <td class="num" data-label="Energy">${money(r.energy)} / ${r.label}</td>
              <td class="num" data-label="Total"><b>${money(r.total)} / ${r.label}</b></td>
              <td class="num" data-label="Book value">${dep.bookValue != null ? money(dep.bookValue) : '<span class="muted small">add purchase date</span>'}</td>
            </tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">No equipment yet.</div>'}
      </div>`;
    $$('[data-href]').forEach(tr => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  }

  function viewEquipment(id) {
    const q = id ? S.eqById[id] : { kind: 'smoker', purchase_cost: '', salvage_value: 0, life_years: 5, hours_per_year: 500, maintenance_per_year: 0, energy_use: [], active: 1, always_on: 0 };
    if (!q) { view.innerHTML = '<div class="empty">Not found. <a href="#/equipment">Back</a></div>'; return; }
    let uses = (q.energy_use || []).map(u => Object.assign({}, u));
    let dirty = false;
    leaveGuard = silent => !dirty || (!silent && confirm('Discard unsaved changes?'));
    const used = id ? usedInRecipes(r => r.steps.some(s => s.equipment_id === id)) : '';
    view.innerHTML = `
      <div class="page-head">
        <a class="btn btn-ghost btn-sm" href="#/equipment">&larr; Equipment</a>
        <h1>${id ? esc(q.name) : 'New equipment'}</h1>
      </div>
      <form id="f" autocomplete="off">
        <section class="card">
          <h2>Details</h2>
          <div class="grid cols-2">
            ${field('Name', 'name', q.name, { required: true, placeholder: 'e.g. Offset smoker, Weber grill, walk-in fridge' })}
            ${field('Type', 'kind', q.kind, { type: 'select', options: C.EQUIPMENT_KINDS.concat(C.EQUIPMENT_KINDS.includes(q.kind) ? [] : [q.kind]).map(k => opt(k, k, q.kind)).join('') })}
            ${field('Runs all the time (fridge, freezer, walk-in)', 'always_on', num(q.always_on), { type: 'checkbox', cls: 'span-all' })}
          </div>
          <div class="grid cols-2 always-on-only" style="margin-top:12px">
            ${field('How much it holds', 'capacity_qty', q.capacity_qty, { type: 'num', hint: 'Product it can store when full. A batch taking a fifth of the space pays a fifth of the running cost' })}
            ${field('Unit', 'capacity_unit', q.capacity_unit || (metric() ? 'kg' : 'lb'), { type: 'select', options: unitOptionsFor(q.capacity_unit || (metric() ? 'kg' : 'lb'), ['weight', 'volume']) })}
          </div>
        </section>
        <section class="card">
          <h2>Ownership &amp; depreciation</h2>
          <div class="grid cols-3">
            ${field('Purchase price', 'purchase_cost', q.purchase_cost, { type: 'num', prefix: S.settings.currency_symbol, hint: 'Including shipping and duty' })}
            ${field('Date bought', 'purchase_date', q.purchase_date, { inputType: 'date', hint: 'For the book value today' })}
            ${field('Resale value at the end', 'salvage_value', q.salvage_value, { type: 'num', prefix: S.settings.currency_symbol, hint: 'Scrap or second-hand value; 0 if none' })}
            ${field('Working life', 'life_years', q.life_years, { type: 'num', suffix: 'years' })}
            ${field('Hours used per year', 'hours_per_year', q.hours_per_year, { type: 'num', cls: 'hours-field', hint: 'Your best estimate. Fewer hours means each hour carries more of the cost' })}
            ${field('Maintenance per year', 'maintenance_per_year', q.maintenance_per_year, { type: 'num', prefix: S.settings.currency_symbol, hint: 'Parts, servicing, grates, gaskets, blades' })}
          </div>
          <div class="stats" id="dep" style="margin-top:12px"></div>
          <p class="small muted" id="dep-note"></p>
        </section>
        <section class="card">
          <h2>Fuel &amp; energy it uses</h2>
          <p class="muted small" style="margin-top:0" id="energy-hint"></p>
          <div id="uses" data-skip></div>
          <button type="button" class="btn-sm btn-ghost" id="add-use">+ Fuel / energy</button>
          ${S.energy.length ? '' : '<div class="notice">Add energy sources first on the <a href="#/energy">Energy</a> page.</div>'}
        </section>
        <section class="card">
          <div class="stats" id="preview"></div>
          <div class="grid" style="margin-top:12px">
            ${field('Notes', 'notes', q.notes, { type: 'textarea', rows: 2 })}
            ${field('Active', 'active', q.active, { type: 'checkbox' })}
          </div>
          ${used ? `<p class="small muted">Used in: ${used}</p>` : ''}
        </section>
        <div class="row end">
          ${id ? '<button type="button" class="btn-danger" id="del">Delete</button>' : ''}
          <span class="spacer"></span>
          <button type="submit" class="btn-primary">Save equipment</button>
        </div>
      </form>`;
    const form = $('#f');
    function drawUses() {
      $('#uses').innerHTML = uses.map((u, j) => {
        const en = S.enById[u.energy_id];
        const unitName = en ? en.unit : 'units';
        return `
        <div class="fuel-row" data-j="${j}">
          <select data-k="energy_id" aria-label="Fuel or energy">${energyOptions(u.energy_id)}</select>
          <input data-k="qty" value="${esc(u.qty)}" inputmode="decimal" aria-label="Amount used">
          <select data-k="per" aria-label="Per">${perOptions(unitName, u.per)}</select>
          <button type="button" class="btn-icon btn-ghost" data-del="${j}" aria-label="Remove">✕</button>
        </div>`;
      }).join('');
    }
    const preview = () => {
      const d = readFields(form);
      const on = !!d.always_on;
      $$('.always-on-only').forEach(el => el.classList.toggle('hidden', !on));
      $('.hours-field').classList.toggle('hidden', on);
      $('#energy-hint').textContent = on
        ? 'Enter its average use per day. Check the energy label or a plug-in meter: e.g. a fridge rated 1,460 kWh a year uses 4 kWh a day.'
        : 'These fill in automatically when you pick this equipment in a recipe step, and you can change them per recipe. A 1500 W element at full power uses 1.5 kWh per hour; thermostats cycle, so real use is often about half.';
      const dep = C.depreciation(d);
      $('#dep').innerHTML = statBox('Depreciation / year', money(dep.perYear))
        + statBox('Book value today', dep.bookValue != null ? money(dep.bookValue) : '—', dep.ageYears != null ? `${qtyFmt(dep.ageYears)} years old` : 'Add the date bought')
        + statBox('Years left', dep.yearsLeft != null ? qtyFmt(dep.yearsLeft) : '—')
        + statBox(on ? 'Per day' : 'Per hour used', money(dep.perHour * (on ? 24 : 1)), 'incl. maintenance');
      $('#dep-note').textContent = on
        ? 'Runs all the time, so its yearly depreciation and maintenance are spread over every day of the year and charged to batches by days stored and space used.'
        : `Recipes are charged by the hours they use it: (price - resale) / (${qtyFmt(num(d.life_years))} years x ${qtyFmt(num(d.hours_per_year))} hours) plus maintenance / hours per year.`;
      const r = equipmentRates(d, uses);
      $('#preview').innerHTML = statBox(`Depreciation & upkeep / ${r.label}`, money(r.wear)) + statBox(`Energy / ${r.label}`, money(r.energy)) + statBox(`Total / ${r.label}`, money(r.total));
    };
    $('#uses').addEventListener('input', ev => {
      const row = ev.target.closest('[data-j]');
      if (row) { uses[+row.dataset.j][ev.target.dataset.k] = ev.target.value; preview(); }
    });
    $('#uses').addEventListener('change', ev => {
      const row = ev.target.closest('[data-j]');
      if (!row) return;
      const k = ev.target.dataset.k;
      uses[+row.dataset.j][k] = k === 'energy_id' ? Number(ev.target.value) || '' : ev.target.value;
      drawUses();
      preview();
    });
    $('#uses').addEventListener('click', ev => {
      const b = ev.target.closest('[data-del]');
      if (!b) return;
      uses.splice(+b.dataset.del, 1);
      dirty = true;
      drawUses();
      preview();
    });
    $('#add-use').addEventListener('click', () => { uses.push({ energy_id: '', qty: '', per: 'hour' }); dirty = true; drawUses(); });
    form.addEventListener('input', () => { dirty = true; preview(); });
    form.addEventListener('change', preview);
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        const body = Object.assign(readFields(form), { energy_use: uses.filter(u => u.energy_id) });
        if (id) await api('PUT', '/api/equipment/' + id, body); else await api('POST', '/api/equipment', body);
        await loadAll();
        dirty = false;
        toast('Equipment saved');
        go('#/equipment');
      } catch (err) { toast(err.message, true); }
    });
    if ($('#del')) $('#del').addEventListener('click', async () => {
      if (!confirm(`Delete ${q.name}?`)) return;
      try {
        await api('DELETE', '/api/equipment/' + id);
        await loadAll();
        go('#/equipment');
      } catch (err) { toast(err.message, true); }
    });
    drawUses();
    preview();
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
          <h2>Business</h2>
          <div class="grid cols-2">
            ${field('Business name', 'company_name', s.company_name, { hint: 'Shown at the top and on batch sheets' })}
            ${field('Currency symbol', 'currency_symbol', s.currency_symbol, { hint: 'e.g. $, BBD $, US$' })}
          </div>
        </section>
        <section class="card">
          <h2>Costing</h2>
          <div class="grid cols-3">
            ${field('Labour rate', 'labor_rate', s.labor_rate, { prefix: s.currency_symbol, suffix: '/ hour', hint: 'Include employer contributions. Use 0 to leave labour out' })}
            ${field('Target margin', 'target_margin_pct', s.target_margin_pct, { suffix: '%', hint: 'Used to suggest a selling price' })}
            ${field('Preferred units', 'unit_system', s.unit_system, { type: 'select', options: opt('metric', 'Metric (g, kg, ml, L)', s.unit_system) + opt('imperial', 'Imperial (oz, lb, cups, gal)', s.unit_system), hint: 'Default units for new recipes and ingredients' })}
          </div>
        </section>
        <div class="row end"><button class="btn-primary" type="submit">Save settings</button></div>
      </form>
      <section class="card" style="margin-top:14px">
        <h2>Backup</h2>
        <p class="muted small" style="margin-top:0">Download everything (recipes, ingredients, equipment, energy and settings) as one file. Restoring replaces all current data.</p>
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
      download(`recipes-backup-${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
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
