/*
 * Fence estimate calculation engine.
 * Shared by the browser (window.FenceCalc) and Node (require) so the
 * numbers on screen and in tests always match.
 */
(function (root) {
  'use strict';

  // How a recipe component's quantity is multiplied.
  const RULES = {
    per_ft: 'per foot of fence',
    per_section: 'per section (bay between posts)',
    per_post: 'per post (all posts)',
    per_line_post: 'per line post',
    per_terminal_post: 'per terminal post (corner + end + gate)',
    per_corner_post: 'per corner post',
    per_end_post: 'per end post',
    per_gate_post: 'per gate post',
    per_gate: 'per gate',
    per_gate_leaf: 'per gate leaf (double gate = 2)',
    per_sqft: 'per sq ft of fence face (length x height)',
    per_job: 'per job (fixed)',
  };

  const CATEGORIES = [
    'post', 'rail', 'picket', 'panel', 'gate', 'hardware', 'fastener',
    'concrete', 'cap', 'mesh/wire', 'finish', 'other',
  ];

  const MATERIAL_TYPES = [
    'wood', 'vinyl/PVC', 'aluminium', 'steel', 'chain link', 'galvanized',
    'concrete', 'composite', 'wrought iron', 'other',
  ];

  function num(v, d) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : (d === undefined ? 0 : d);
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // Ceil that ignores float noise (e.g. 3.0000000001 -> 3)
  function ceilSafe(n) {
    return Math.ceil(n - 1e-9);
  }

  /**
   * Parse a length typed by a person: 12.5, 12' 6", 12'6, 12 6, 12ft 6in.
   * Returns a number in feet (or whatever single unit is used) or NaN.
   */
  function parseLength(input) {
    if (typeof input === 'number') return input;
    if (input == null) return NaN;
    let s = String(input).trim().toLowerCase();
    if (!s) return NaN;
    s = s.replace(/feet|foot|ft/g, "'").replace(/inches|inch|in/g, '"').replace(/[’‘]/g, "'").replace(/[”“]/g, '"');
    const ftIn = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/);
    if (ftIn) return num(ftIn[1]) + num(ftIn[2]) / 12;
    const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
    if (inOnly) return num(inOnly[1]) / 12;
    const twoNums = s.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    if (twoNums) return num(twoNums[1]) + num(twoNums[2]) / 12;
    const plain = s.match(/^-?\d+(?:\.\d+)?$/);
    if (plain) return parseFloat(s);
    return NaN;
  }

  function formatLength(n, unit) {
    unit = unit || 'ft';
    const v = round2(num(n));
    return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')) + ' ' + unit;
  }

  /**
   * Material pricing.
   * cost  = what I pay: preferred supplier price, else the cheapest one.
   * price = what I charge: explicit quoted price, else cost + markup.
   */
  function bestSupplierPrice(material) {
    const prices = (material && material.prices) || [];
    const valid = prices.filter(p => num(p.cost) > 0);
    if (!valid.length) return null;
    const preferred = valid.find(p => p.preferred);
    if (preferred) return preferred;
    return valid.reduce((a, b) => (num(b.cost) < num(a.cost) ? b : a));
  }

  function materialCost(material) {
    const p = bestSupplierPrice(material);
    return p ? num(p.cost) : 0;
  }

  function materialPrice(material, settings) {
    if (!material) return 0;
    if (num(material.sell_price) > 0) return num(material.sell_price);
    const markup = material.markup_pct !== null && material.markup_pct !== undefined && material.markup_pct !== ''
      ? num(material.markup_pct)
      : num(settings && settings.default_markup_pct, 0);
    return round2(materialCost(material) * (1 + markup / 100));
  }

  /**
   * Work out sections and post counts from fence runs and gates.
   *
   * runs:  [{ length, joinPrev, closes }]
   *        joinPrev: run starts at the end of the previous run (shares a corner post)
   *        closes:   run ends at the start of its group (closed shape)
   * gates: [{ width, leaves, run }]  run = index of run the gate sits in
   */
  function computeGeometry(input) {
    const runs = (input.runs || []).map(r => ({
      length: Math.max(0, num(r.length)),
      joinPrev: !!r.joinPrev,
      closes: !!r.closes,
      label: r.label || '',
    }));
    const gates = (input.gates || []).map(g => ({
      width: Math.max(0, num(g.width)),
      leaves: num(g.leaves, 1) >= 2 ? 2 : 1,
      run: Number.isInteger(g.run) ? g.run : parseInt(g.run, 10),
    }));
    const spacing = Math.max(0.1, num(input.spacing, 8));
    const height = Math.max(0, num(input.height, 6));
    const warnings = [];

    const runDetails = runs.map((r, i) => {
      const myGates = gates.filter(g => g.run === i);
      const gateWidth = myGates.reduce((s, g) => s + g.width, 0);
      let net = r.length - gateWidth;
      if (net < 0) {
        warnings.push(`Run ${i + 1}: gates are wider than the run.`);
        net = 0;
      }
      const g = myGates.length;
      // Each gate splits the run into another piece of fence. Splitting can add at
      // most one partial section per gate, so this is a slightly conservative count.
      const sections = net > 0 ? ceilSafe(net / spacing) + g : 0;
      const posts = (net > 0 || g > 0) ? sections + g + 1 : 0;
      return { index: i, length: r.length, net, gates: g, gateWidth, sections, posts, joinPrev: r.joinPrev && i > 0, closes: r.closes };
    });

    // Gates pointing at a run that does not exist still count (stand-alone gate).
    const orphanGates = gates.filter(g => !(g.run >= 0 && g.run < runs.length));
    if (orphanGates.length && runs.length) warnings.push('Some gates are not assigned to a run.');

    let joints = 0;
    let groupStart = 0;
    runDetails.forEach((d, i) => {
      if (i > 0 && d.joinPrev && runDetails[i - 1].posts > 0 && d.posts > 0) joints++;
      if (!d.joinPrev) groupStart = i;
      // Closing back to the start of the group adds one more shared corner,
      // as long as the group has more than one run.
      if (d.closes && i > groupStart) joints++;
    });

    const fenceLength = runDetails.reduce((s, d) => s + d.net, 0);
    const totalLength = runDetails.reduce((s, d) => s + d.length, 0);
    const sections = runDetails.reduce((s, d) => s + d.sections, 0);
    const runEnds = runDetails.filter(d => d.posts > 0).length * 2;
    const orphanGatePosts = orphanGates.length * 2;
    const gateCount = gates.length;
    const gateLeaves = gates.reduce((s, g) => s + g.leaves, 0);
    const gatePosts = gateCount * 2;

    const total = runDetails.reduce((s, d) => s + d.posts, 0) - joints + orphanGatePosts;
    const corner = joints;
    const end = Math.max(0, runEnds - 2 * joints);
    const line = Math.max(0, total - corner - end - gatePosts);

    return {
      spacing,
      height,
      fenceLength: round2(fenceLength),
      totalLength: round2(totalLength),
      gateWidth: round2(gates.reduce((s, g) => s + g.width, 0)),
      gateCount,
      gateLeaves,
      sections,
      posts: { total, line, corner, end, gate: gatePosts, terminal: corner + end + gatePosts },
      sqft: round2(fenceLength * height),
      runDetails,
      warnings,
    };
  }

  function ruleMultiplier(rule, geo) {
    switch (rule) {
      case 'per_ft': return geo.fenceLength;
      case 'per_section': return geo.sections;
      case 'per_post': return geo.posts.total;
      case 'per_line_post': return geo.posts.line;
      case 'per_terminal_post': return geo.posts.terminal;
      case 'per_corner_post': return geo.posts.corner;
      case 'per_end_post': return geo.posts.end;
      case 'per_gate_post': return geo.posts.gate;
      case 'per_gate': return geo.gateCount;
      case 'per_gate_leaf': return geo.gateLeaves;
      case 'per_sqft': return geo.sqft;
      case 'per_job': return 1;
      default: return 0;
    }
  }

  function supplierName(material, suppliersById) {
    const p = bestSupplierPrice(material);
    if (!p) return '';
    const s = suppliersById && suppliersById[p.supplier_id];
    return s ? s.name : (p.supplier_name || '');
  }

  /**
   * Full estimate.
   * opts: { estimate, fenceType, materialsById, suppliersById, settings }
   */
  function computeEstimate(opts) {
    const est = opts.estimate || {};
    const ft = opts.fenceType || null;
    const mats = opts.materialsById || {};
    const settings = opts.settings || {};
    const overrides = est.overrides || {};

    const geo = computeGeometry({
      runs: est.runs,
      gates: est.gates,
      spacing: num(est.post_spacing) || (ft && ft.post_spacing) || 8,
      height: num(est.height) || (ft && ft.default_height) || 6,
    });

    const lines = [];
    const warnings = geo.warnings.slice();

    function addLine(base, material, rawQty, wastePct, manualQty) {
      if (!(rawQty > 0) && !(manualQty > 0)) return;
      const pack = material ? Math.max(1, num(material.pack_size, 1)) : 1;
      const withWaste = rawQty * (1 + num(wastePct) / 100);
      const calcQty = ceilSafe(withWaste / pack);
      const qty = manualQty !== undefined && manualQty !== null && manualQty !== '' ? num(manualQty) : calcQty;
      const unitCost = material ? materialCost(material) : 0;
      const unitPrice = material ? materialPrice(material, settings) : 0;
      if (material && !(unitCost > 0)) warnings.push(`${material.name}: no supplier cost entered.`);
      lines.push(Object.assign({
        material_id: material ? material.id : null,
        name: material ? material.name : '(no material selected)',
        sku: material ? material.sku || '' : '',
        size: material ? material.size || '' : '',
        unit: material ? material.unit || 'each' : 'each',
        pack_size: pack,
        supplier: material ? supplierName(material, opts.suppliersById) : '',
        supplier_sku: (material && bestSupplierPrice(material) && bestSupplierPrice(material).supplier_sku) || '',
        raw_qty: round2(rawQty),
        waste_pct: num(wastePct),
        calc_qty: calcQty,
        qty,
        manual: qty !== calcQty,
        unit_cost: unitCost,
        unit_price: unitPrice,
        cost: round2(qty * unitCost),
        price: round2(qty * unitPrice),
      }, base));
    }

    // Recipe components from the fence type
    (opts.components || (ft && ft.components) || []).forEach(c => {
      const ov = overrides[c.id] || {};
      if (ov.removed) return;
      const matId = ov.material_id || c.material_id;
      const material = matId ? mats[matId] : null;
      if (!material) warnings.push(`${c.label || c.category}: no material selected.`);
      const raw = num(c.qty) * ruleMultiplier(c.rule, geo);
      const waste = c.waste_pct !== null && c.waste_pct !== undefined && c.waste_pct !== ''
        ? num(c.waste_pct)
        : num(material && material.waste_pct);
      addLine({
        key: 'c' + c.id,
        component_id: c.id,
        label: c.label || (material && material.name) || c.category,
        category: c.category || (material && material.category) || 'other',
        rule: c.rule,
        qty_per: num(c.qty),
        swapped: !!ov.material_id && ov.material_id !== c.material_id,
      }, material, raw, waste, ov.qty);
    });

    // Gate panels / kits, grouped by the material chosen on each gate
    const gateGroups = {};
    (est.gates || []).forEach(g => {
      const id = g.material_id || (ft && ft.default_gate_material_id) || 0;
      gateGroups[id] = (gateGroups[id] || 0) + 1;
    });
    Object.keys(gateGroups).forEach(id => {
      const material = mats[id] || null;
      if (!material) warnings.push('A gate has no gate material selected.');
      addLine({
        key: 'g' + id,
        label: 'Gate',
        category: 'gate',
        rule: 'per_gate',
        qty_per: 1,
      }, material, gateGroups[id], 0, overrides['g' + id] && overrides['g' + id].qty);
    });

    // Extra items: catalogue materials or free-text charges
    (est.extras || []).forEach((x, i) => {
      const material = x.material_id ? mats[x.material_id] : null;
      const qty = num(x.qty, 1);
      const unitCost = x.unit_cost !== undefined && x.unit_cost !== '' && x.unit_cost !== null
        ? num(x.unit_cost) : (material ? materialCost(material) : 0);
      const unitPrice = x.unit_price !== undefined && x.unit_price !== '' && x.unit_price !== null
        ? num(x.unit_price) : (material ? materialPrice(material, settings) : 0);
      lines.push({
        key: 'x' + i,
        extra_index: i,
        material_id: material ? material.id : null,
        label: x.description || (material ? material.name : 'Extra'),
        name: material ? material.name : (x.description || 'Extra'),
        category: material ? material.category : 'other',
        sku: material ? material.sku || '' : '',
        size: material ? material.size || '' : '',
        unit: material ? material.unit : (x.unit || 'each'),
        pack_size: 1,
        supplier: material ? supplierName(material, opts.suppliersById) : '',
        supplier_sku: (material && bestSupplierPrice(material) && bestSupplierPrice(material).supplier_sku) || '',
        rule: 'extra',
        raw_qty: qty,
        waste_pct: 0,
        calc_qty: qty,
        qty,
        manual: false,
        unit_cost: unitCost,
        unit_price: unitPrice,
        cost: round2(qty * unitCost),
        price: round2(qty * unitPrice),
        is_extra: true,
      });
    });

    const materialLines = lines;
    const materialsCost = round2(materialLines.reduce((s, l) => s + l.cost, 0));
    const materialsPrice = round2(materialLines.reduce((s, l) => s + l.price, 0));

    const laborPricePerFt = num(est.labor_price_per_ft);
    const laborCostPerFt = num(est.labor_cost_per_ft);
    const laborPerGate = num(est.labor_price_per_gate);
    const laborCostPerGate = num(est.labor_cost_per_gate);
    const laborExtra = num(est.labor_extra);
    const laborPrice = round2(geo.fenceLength * laborPricePerFt + geo.gateCount * laborPerGate + laborExtra);
    const laborCost = round2(geo.fenceLength * laborCostPerFt + geo.gateCount * laborCostPerGate);

    const subtotal = round2(materialsPrice + laborPrice);
    const discount = Math.min(subtotal, Math.max(0, num(est.discount)));
    const taxable = round2(subtotal - discount);
    const taxRate = est.tax_rate !== undefined && est.tax_rate !== null && est.tax_rate !== ''
      ? num(est.tax_rate) : num(settings.tax_rate);
    const tax = round2(taxable * taxRate / 100);
    const total = round2(taxable + tax);
    const totalCost = round2(materialsCost + laborCost);
    const profit = round2(taxable - totalCost);
    const depositPct = est.deposit_pct !== undefined && est.deposit_pct !== null && est.deposit_pct !== ''
      ? num(est.deposit_pct) : num(settings.deposit_pct);

    return {
      geometry: geo,
      lines: materialLines,
      warnings: Array.from(new Set(warnings)),
      totals: {
        materials_cost: materialsCost,
        materials_price: materialsPrice,
        labor_cost: laborCost,
        labor_price: laborPrice,
        subtotal,
        discount: round2(discount),
        taxable,
        tax_rate: taxRate,
        tax,
        total,
        total_cost: totalCost,
        profit,
        margin_pct: taxable > 0 ? round2(profit / taxable * 100) : 0,
        price_per_ft: geo.fenceLength > 0 ? round2(total / geo.fenceLength) : 0,
        deposit_pct: depositPct,
        deposit: round2(total * depositPct / 100),
      },
    };
  }

  const FenceCalc = {
    RULES, CATEGORIES, MATERIAL_TYPES,
    parseLength, formatLength, round2, num,
    bestSupplierPrice, materialCost, materialPrice,
    computeGeometry, ruleMultiplier, computeEstimate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FenceCalc;
  else root.FenceCalc = FenceCalc;
})(typeof self !== 'undefined' ? self : this);
