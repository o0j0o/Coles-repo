'use strict';
// Starter data so the app is usable on first run. Every price, rate and
// recipe here is a placeholder; replace them with your real numbers.

function seed(db) {
  const energy = db.prepare(`INSERT INTO energy_sources (name, kind, unit, pack_label, pack_size, pack_price, notes, price_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, date('now'))`);
  const en = {};
  function addEnergy(key, name, kind, unit, label, size, price, notes) {
    en[key] = Number(energy.run(name, kind, unit, label, size, price, notes || null).lastInsertRowid);
  }
  addEnergy('power', 'Electricity', 'electricity', 'kWh', 'per kWh on the bill', 1, 0.8, 'Total bill divided by kWh used, including fuel charge and taxes');
  addEnergy('propane', 'Propane', 'propane', 'lb', '25 lb cylinder', 25, 65);
  addEnergy('charcoal', 'Lump charcoal', 'charcoal', 'lb', '20 lb bag', 20, 35);
  addEnergy('pellets', 'Wood pellets (hickory)', 'wood pellets', 'lb', '40 lb bag', 40, 95);
  addEnergy('chips', 'Wood chips (cherry)', 'wood chips', 'lb', '5 lb bag', 5, 30);

  const equip = db.prepare(`INSERT INTO equipment (name, kind, purchase_cost, salvage_value, life_years, hours_per_year,
    maintenance_per_year, energy_use, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const eq = {};
  function addEquip(key, name, kind, cost, salvage, life, hours, maint, use, notes) {
    eq[key] = Number(equip.run(name, kind, cost, salvage, life, hours, maint,
      JSON.stringify(use.map(([k, qty, per]) => ({ energy_id: en[k], qty, per: per || 'hour' }))), notes || null).lastInsertRowid);
  }
  addEquip('pellet', 'Pellet smoker', 'smoker', 2500, 300, 5, 800, 150, [['pellets', 2], ['power', 0.3]]);
  addEquip('offset', 'Charcoal smoker', 'smoker', 1200, 100, 8, 400, 50, [['charcoal', 1.5], ['chips', 0.5]]);
  addEquip('dehyd', 'Dehydrator', 'dehydrator', 600, 0, 5, 1000, 20, [['power', 0.6]], 'About 1000 W element; thermostat cycles so real use is lower');
  addEquip('grinder', 'Meat grinder', 'grinder', 900, 0, 8, 150, 40, [['power', 0.75]]);
  addEquip('stuffer', 'Sausage stuffer', 'stuffer', 700, 0, 10, 100, 20, []);
  addEquip('burner', 'Propane burner + stock pot', 'stove / burner', 400, 0, 8, 200, 0, [['propane', 1.5]]);
  addEquip('blender', 'Commercial blender', 'mixer / blender', 800, 0, 5, 100, 0, [['power', 1.2]]);
  addEquip('sealer', 'Vacuum sealer', 'vacuum sealer', 1000, 0, 5, 200, 30, [['power', 0.4]]);

  const ing = db.prepare(`INSERT INTO ingredients (name, category, purchase_qty, purchase_unit, purchase_price, yield_pct, density, notes, price_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'))`);
  const i = {};
  function addIng(key, name, category, qty, unit, price, yieldPct, density, notes) {
    i[key] = Number(ing.run(name, category, qty, unit, price, yieldPct || 100, density || null, notes || null).lastInsertRowid);
  }
  addIng('bonnet', 'Scotch bonnet peppers', 'pepper', 1, 'kg', 20, 92, null, 'Usable after stems removed');
  addIng('onion', 'Onions', 'produce', 1, 'kg', 6, 90);
  addIng('garlic', 'Garlic', 'produce', 1, 'kg', 18, 85);
  addIng('mustard', 'Yellow mustard', 'other', 2.5, 'kg', 25, 100, 1.05);
  addIng('vinegar', 'White vinegar', 'vinegar', 1, 'gal', 15, 100, 1.01);
  addIng('turmeric', 'Turmeric, ground', 'spice', 500, 'g', 18, 100, 0.5);
  addIng('salt', 'Salt, fine', 'salt', 1, 'kg', 3, 100, 1.2);
  addIng('sugar', 'Brown sugar', 'sugar', 2, 'kg', 9, 100, 0.9);
  addIng('pepper', 'Black pepper, coarse', 'spice', 500, 'g', 30, 100, 0.45);
  addIng('soy', 'Soy sauce', 'liquid', 1, 'L', 10, 100, 1.15);
  addIng('worc', 'Worcestershire sauce', 'liquid', 1, 'L', 12, 100, 1.1);
  addIng('cure', 'Prague powder #1 (curing salt)', 'cure', 500, 'g', 25, 100, 1.2, 'Common guideline: 2.5 g per kg of meat. Always check against your approved process.');
  addIng('beef', 'Beef eye of round', 'meat', 1, 'kg', 32, 90, null, 'Usable after trimming');
  addIng('brisket', 'Beef brisket flat', 'meat', 1, 'kg', 35, 80);
  addIng('rum', 'Gold rum', 'spirit', 1, 'L', 30, 100, 0.95);
  addIng('bottle150', 'Sauce bottle 150 ml with cap', 'packaging', 24, 'each', 36);
  addIng('bottle375', 'Spirit bottle 375 ml with cork', 'packaging', 12, 'each', 42);
  addIng('label', 'Printed label', 'packaging', 500, 'each', 120);
  addIng('bag', 'Vacuum pouch 100 g', 'packaging', 100, 'each', 45);

  const recipe = db.prepare(`INSERT INTO recipes (name, product, description, yield_qty, yield_unit, density, pack_name, pack_qty,
    pack_unit, sell_price, method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const line = db.prepare(`INSERT INTO recipe_lines (recipe_id, ingredient_id, qty, unit, basis, note, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const step = db.prepare(`INSERT INTO recipe_steps (recipe_id, label, equipment_id, hours, scaling, load_capacity, load_unit,
    energy, labor_hours, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  function equipEnergy(key) {
    return db.prepare('SELECT energy_use FROM equipment WHERE id = ?').get(eq[key]).energy_use;
  }
  function addRecipe(r, lines, steps) {
    const id = Number(recipe.run(r.name, r.product, r.description || null, r.yield_qty, r.yield_unit, r.density || null,
      r.pack_name || null, r.pack_qty || null, r.pack_unit || null, r.sell_price || null, r.method || null,
      'Sample recipe with placeholder prices. Edit or delete it.').lastInsertRowid);
    lines.forEach(([k, qty, unit, basis, note], n) => line.run(id, i[k], qty, unit, basis || 'batch', note || null, n));
    steps.forEach((s, n) => step.run(id, s.label, s.equip ? eq[s.equip] : null, s.hours || 0, s.scaling || 'fixed',
      s.cap || null, s.capUnit || null, s.equip ? equipEnergy(s.equip) : '[]', s.labor || 0, n));
  }

  addRecipe({
    name: 'Sample: Bajan pepper sauce', product: 'pepper sauce', yield_qty: 3.9, yield_unit: 'L', density: 1.05,
    pack_name: 'bottle', pack_qty: 150, pack_unit: 'ml', sell_price: 15,
    method: '1. Stem the peppers, peel the onions and garlic.\n2. Blend everything until smooth.\n3. Bring to a simmer and hold for 10 minutes.\n4. Hot fill bottles and cap.',
  }, [
    ['bonnet', 1, 'kg'], ['onion', 500, 'g'], ['garlic', 60, 'g'], ['mustard', 1, 'kg'], ['vinegar', 1.5, 'L'],
    ['turmeric', 30, 'g'], ['salt', 60, 'g'],
    ['bottle150', 1, 'each', 'per_pack'], ['label', 1, 'each', 'per_pack'],
  ], [
    { label: 'Prep and blend', equip: 'blender', hours: 0.25, scaling: 'linear', labor: 1 },
    { label: 'Cook', equip: 'burner', hours: 1, scaling: 'fixed', labor: 0.5 },
    { label: 'Bottle and label', hours: 0, scaling: 'linear', labor: 1 },
  ]);

  addRecipe({
    name: 'Sample: Smoked beef jerky', product: 'jerky', yield_qty: 2, yield_unit: 'kg',
    pack_name: 'pouch', pack_qty: 100, pack_unit: 'g', sell_price: 22,
    description: '5 kg of trimmed beef makes about 2 kg of jerky.',
    method: '1. Trim and slice the beef 5 mm thick against the grain.\n2. Mix the marinade and cure, coat the beef, and refrigerate overnight.\n3. Smoke, then finish in the dehydrator until dry.\n4. Cool, vacuum pack and label.',
  }, [
    ['beef', 5, 'kg'], ['soy', 500, 'ml'], ['worc', 250, 'ml'], ['sugar', 150, 'g'], ['pepper', 20, 'g'],
    ['garlic', 30, 'g'], ['bonnet', 50, 'g'], ['cure', 12.5, 'g', 'batch', '2.5 g per kg of meat'],
    ['bag', 1, 'each', 'per_pack'], ['label', 1, 'each', 'per_pack'],
  ], [
    { label: 'Slice and marinate', hours: 0, scaling: 'linear', labor: 1.5 },
    { label: 'Smoke', equip: 'offset', hours: 2, scaling: 'loads', cap: 2.5, capUnit: 'kg', labor: 0.5 },
    { label: 'Dry', equip: 'dehyd', hours: 5, scaling: 'loads', cap: 1.5, capUnit: 'kg', labor: 0.25 },
    { label: 'Vacuum pack', equip: 'sealer', hours: 0.5, scaling: 'linear', labor: 0.5 },
  ]);

  addRecipe({
    name: 'Sample: Smoked scotch bonnet rum', product: 'infused rum', yield_qty: 2.9, yield_unit: 'L', density: 0.95,
    pack_name: 'bottle', pack_qty: 375, pack_unit: 'ml', sell_price: 45,
    method: '1. Cold smoke the peppers.\n2. Split the peppers and add to the rum with the sugar.\n3. Infuse to taste, strain and bottle.',
  }, [
    ['rum', 3, 'L'], ['bonnet', 100, 'g'], ['sugar', 50, 'g'],
    ['bottle375', 1, 'each', 'per_pack'], ['label', 1, 'each', 'per_pack'],
  ], [
    { label: 'Smoke peppers', equip: 'pellet', hours: 1, scaling: 'fixed', labor: 0.25 },
    { label: 'Infuse, strain and bottle', hours: 0, scaling: 'linear', labor: 0.75 },
  ]);

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('labor_rate', '15')").run();
}

module.exports = { seed };
