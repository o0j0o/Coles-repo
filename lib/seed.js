'use strict';
// Starter data so the app is usable on first run. Every price here is a
// placeholder; replace them with your real supplier costs.

function seed(db) {
  const sup = db.prepare(`INSERT INTO suppliers (name, contact_name, phone, email, payment_terms, notes)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const lumber = Number(sup.run('Sample Lumber Supply', '', '', '', 'Net 30', 'Sample supplier: edit or delete').lastInsertRowid);
  const hardware = Number(sup.run('Sample Hardware & Fence Wholesale', '', '', '', 'COD', 'Sample supplier: edit or delete').lastInsertRowid);

  const mat = db.prepare(`INSERT INTO materials
    (name, category, material_type, sku, size, length, dim_unit, color, unit, pack_size, waste_pct, markup_pct, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const price = db.prepare(`INSERT INTO material_prices (material_id, supplier_id, cost, preferred, price_date)
    VALUES (?, ?, ?, ?, date('now'))`);

  const m = {};
  function add(key, f, prices) {
    const id = Number(mat.run(f.name, f.category, f.type || null, f.sku || null, f.size || null,
      f.length || null, f.dim_unit || 'ft', f.color || null, f.unit || 'each', f.pack || 1,
      f.waste || 0, f.markup === undefined ? null : f.markup, f.notes || null).lastInsertRowid);
    prices.forEach(([supplierId, cost, preferred]) => price.run(id, supplierId, cost, preferred ? 1 : 0));
    m[key] = id;
  }

  // Wood
  add('post4x4', { name: '4x4x8 PT Post', category: 'post', type: 'wood', size: '4x4', length: 8, waste: 0 }, [[lumber, 28.5, 1], [hardware, 31, 0]]);
  add('post6x6', { name: '6x6x10 PT Post', category: 'post', type: 'wood', size: '6x6', length: 10 }, [[lumber, 62, 1]]);
  add('rail2x4', { name: '2x4x8 PT Rail', category: 'rail', type: 'wood', size: '2x4', length: 8, waste: 5 }, [[lumber, 14.25, 1]]);
  add('picket1x6', { name: '1x6x6 PT Picket', category: 'picket', type: 'wood', size: '1x6 (5.5" actual)', length: 6, waste: 5 }, [[lumber, 6.4, 1]]);
  add('woodcap', { name: '4x4 Post Cap', category: 'cap', type: 'wood', size: '4x4' }, [[hardware, 4.5, 1]]);
  add('woodgate', { name: 'Wood Walk Gate 4ft (built)', category: 'gate', type: 'wood', size: '4ft x 6ft' }, [[lumber, 185, 1]]);
  add('screws', { name: 'Exterior Deck Screws 2-1/2"', category: 'fastener', type: 'galvanized', unit: 'box', pack: 350, notes: 'Box of 350' }, [[hardware, 38, 1]]);

  // Shared
  add('concrete', { name: 'Concrete Mix 80 lb Bag', category: 'concrete', type: 'concrete', unit: 'bag' }, [[hardware, 14.9, 1], [lumber, 15.5, 0]]);
  add('hinge', { name: 'Gate Hinge Set (pair)', category: 'hardware', type: 'galvanized', unit: 'set' }, [[hardware, 32, 1]]);
  add('latch', { name: 'Gravity Gate Latch', category: 'hardware', type: 'galvanized' }, [[hardware, 18, 1]]);

  // Chain link
  add('cl_line', { name: 'Chain Link Line Post 1-7/8" x 8ft', category: 'post', type: 'chain link', size: '1-7/8"', length: 8 }, [[hardware, 36, 1]]);
  add('cl_term', { name: 'Chain Link Terminal Post 2-3/8" x 8ft', category: 'post', type: 'chain link', size: '2-3/8"', length: 8 }, [[hardware, 52, 1]]);
  add('cl_rail', { name: 'Chain Link Top Rail 1-5/8" x 21ft', category: 'rail', type: 'chain link', size: '1-5/8"', length: 21, unit: 'length', pack: 21, waste: 5, notes: 'Recipe qty is in feet; sold in 21ft lengths' }, [[hardware, 58, 1]]);
  add('cl_fabric', { name: 'Chain Link Fabric 6ft x 50ft 11.5ga', category: 'mesh/wire', type: 'chain link', size: '6ft', unit: 'roll', pack: 50, waste: 3, notes: 'Recipe qty is in feet; sold in 50ft rolls' }, [[hardware, 245, 1]]);
  add('cl_tband', { name: 'Tension Band 2-3/8"', category: 'hardware', type: 'chain link' }, [[hardware, 2.1, 1]]);
  add('cl_bband', { name: 'Brace Band 2-3/8"', category: 'hardware', type: 'chain link' }, [[hardware, 2.3, 1]]);
  add('cl_tbar', { name: 'Tension Bar 6ft', category: 'hardware', type: 'chain link' }, [[hardware, 9.5, 1]]);
  add('cl_loop', { name: 'Loop Cap 1-7/8"', category: 'cap', type: 'chain link' }, [[hardware, 3.2, 1]]);
  add('cl_dome', { name: 'Dome Cap 2-3/8"', category: 'cap', type: 'chain link' }, [[hardware, 3.6, 1]]);
  add('cl_ties', { name: 'Aluminium Fence Ties 6-1/2"', category: 'fastener', type: 'aluminium', unit: 'bag', pack: 100, notes: 'Bag of 100' }, [[hardware, 16, 1]]);
  add('cl_gate', { name: 'Chain Link Walk Gate 4ft x 6ft', category: 'gate', type: 'chain link', size: '4ft x 6ft' }, [[hardware, 210, 1]]);

  // Vinyl
  add('v_panel', { name: 'Vinyl Privacy Panel 6ft H x 8ft W White', category: 'panel', type: 'vinyl/PVC', size: '6ft H x 8ft W', color: 'White' }, [[hardware, 148, 1]]);
  add('v_post', { name: 'Vinyl Post 5x5x9 White', category: 'post', type: 'vinyl/PVC', size: '5x5', length: 9, color: 'White' }, [[hardware, 64, 1]]);
  add('v_cap', { name: 'Vinyl New England Post Cap 5x5', category: 'cap', type: 'vinyl/PVC', size: '5x5', color: 'White' }, [[hardware, 9.8, 1]]);
  add('v_stiff', { name: 'Aluminium Post Stiffener', category: 'hardware', type: 'aluminium' }, [[hardware, 41, 1]]);
  add('v_gate', { name: 'Vinyl Privacy Gate 4ft x 6ft', category: 'gate', type: 'vinyl/PVC', size: '4ft x 6ft', color: 'White' }, [[hardware, 320, 1]]);

  // Aluminium
  add('a_panel', { name: 'Aluminium Picket Panel 4ft H x 6ft W Black', category: 'panel', type: 'aluminium', size: '4ft H x 6ft W', color: 'Black' }, [[hardware, 135, 1]]);
  add('a_post', { name: 'Aluminium Post 2x2x6 Black', category: 'post', type: 'aluminium', size: '2x2', length: 6, color: 'Black' }, [[hardware, 46, 1]]);
  add('a_bracket', { name: 'Aluminium Rail Mount Bracket', category: 'hardware', type: 'aluminium', color: 'Black' }, [[hardware, 3.25, 1]]);
  add('a_gate', { name: 'Aluminium Walk Gate 4ft x 4ft Black', category: 'gate', type: 'aluminium', size: '4ft x 4ft', color: 'Black' }, [[hardware, 295, 1]]);

  const ft = db.prepare(`INSERT INTO fence_types
    (name, style, material_type, default_height, post_spacing, labor_price_per_ft, labor_cost_per_ft,
     labor_price_per_gate, labor_cost_per_gate, default_gate_material_id, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const comp = db.prepare(`INSERT INTO fence_type_components
    (fence_type_id, label, category, material_id, rule, qty, sort_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  function fenceType(f, components) {
    const id = Number(ft.run(f.name, f.style, f.type, f.height, f.spacing, f.lp, f.lc, f.gp, f.gc, f.gate, f.desc).lastInsertRowid);
    components.forEach((c, i) => comp.run(id, c[0], c[1], c[2], c[3], c[4], i, c[5] || null));
  }

  fenceType({ name: 'Wood Privacy 6ft', style: 'privacy', type: 'wood', height: 6, spacing: 8, lp: 18, lc: 9, gp: 120, gc: 60, gate: m.woodgate,
    desc: 'Pressure treated posts, 3 rails, 1x6 pickets butted tight.' }, [
    ['Posts', 'post', m.post4x4, 'per_post', 1],
    ['Rails (3 per section)', 'rail', m.rail2x4, 'per_section', 3],
    ['Pickets', 'picket', m.picket1x6, 'per_ft', 2.18, '12in / 5.5in picket = 2.18 per ft'],
    ['Post caps', 'cap', m.woodcap, 'per_post', 1],
    ['Concrete (2 bags per post)', 'concrete', m.concrete, 'per_post', 2],
    ['Screws (6 per picket + 4 per rail end)', 'fastener', m.screws, 'per_ft', 15],
    ['Hinges', 'hardware', m.hinge, 'per_gate_leaf', 1],
    ['Latch', 'hardware', m.latch, 'per_gate', 1],
  ]);

  fenceType({ name: 'Chain Link 6ft Galvanized', style: 'chain link', type: 'chain link', height: 6, spacing: 10, lp: 12, lc: 6, gp: 100, gc: 50, gate: m.cl_gate,
    desc: 'Galvanized 11.5ga fabric with top rail. Line posts every 10ft.' }, [
    ['Line posts', 'post', m.cl_line, 'per_line_post', 1],
    ['Terminal posts (corner, end, gate)', 'post', m.cl_term, 'per_terminal_post', 1],
    ['Top rail (ft)', 'rail', m.cl_rail, 'per_ft', 1],
    ['Fabric (ft)', 'mesh/wire', m.cl_fabric, 'per_ft', 1],
    ['Tension bars: end', 'hardware', m.cl_tbar, 'per_end_post', 1],
    ['Tension bars: corner', 'hardware', m.cl_tbar, 'per_corner_post', 2],
    ['Tension bars: gate', 'hardware', m.cl_tbar, 'per_gate_post', 1],
    ['Tension bands (5 per bar)', 'hardware', m.cl_tband, 'per_terminal_post', 6],
    ['Brace bands', 'hardware', m.cl_bband, 'per_terminal_post', 2],
    ['Loop caps', 'cap', m.cl_loop, 'per_line_post', 1],
    ['Dome caps', 'cap', m.cl_dome, 'per_terminal_post', 1],
    ['Fence ties (1 per ft on rail + posts)', 'fastener', m.cl_ties, 'per_ft', 1.5],
    ['Concrete', 'concrete', m.concrete, 'per_post', 2],
    ['Hinges', 'hardware', m.hinge, 'per_gate_leaf', 1],
    ['Latch', 'hardware', m.latch, 'per_gate', 1],
  ]);

  fenceType({ name: 'Vinyl Privacy 6ft', style: 'privacy', type: 'vinyl/PVC', height: 6, spacing: 8, lp: 20, lc: 10, gp: 120, gc: 60, gate: m.v_gate,
    desc: '6x8 white vinyl privacy panels on 5x5 posts.' }, [
    ['Panels', 'panel', m.v_panel, 'per_section', 1],
    ['Posts', 'post', m.v_post, 'per_post', 1],
    ['Post caps', 'cap', m.v_cap, 'per_post', 1],
    ['Gate post stiffeners', 'hardware', m.v_stiff, 'per_gate_post', 1],
    ['Concrete', 'concrete', m.concrete, 'per_post', 2],
    ['Hinges', 'hardware', m.hinge, 'per_gate_leaf', 1],
    ['Latch', 'hardware', m.latch, 'per_gate', 1],
  ]);

  fenceType({ name: 'Aluminium Picket 4ft', style: 'ornamental', type: 'aluminium', height: 4, spacing: 6, lp: 16, lc: 8, gp: 100, gc: 50, gate: m.a_gate,
    desc: 'Black aluminium ornamental panels, 6ft sections.' }, [
    ['Panels', 'panel', m.a_panel, 'per_section', 1],
    ['Posts', 'post', m.a_post, 'per_post', 1],
    ['Rail brackets (4 per panel)', 'hardware', m.a_bracket, 'per_section', 4],
    ['Concrete', 'concrete', m.concrete, 'per_post', 1],
    ['Hinges', 'hardware', m.hinge, 'per_gate_leaf', 1],
    ['Latch', 'hardware', m.latch, 'per_gate', 1],
  ]);
}

module.exports = { seed };
