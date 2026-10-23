/*
 * Recipe scaling and production cost engine.
 * Shared by the browser (window.RecipeCalc) and Node (require) so the
 * numbers on screen and in tests always match.
 */
(function (root) {
  'use strict';

  // Every unit converts to a base: grams (weight), millilitres (volume) or pieces (count).
  // Volume measures are US kitchen measures.
  const UNITS = {
    g: { dim: 'weight', f: 1, sys: 'metric' },
    kg: { dim: 'weight', f: 1000, sys: 'metric' },
    oz: { dim: 'weight', f: 28.349523125, sys: 'imperial' },
    lb: { dim: 'weight', f: 453.59237, sys: 'imperial' },
    ml: { dim: 'volume', f: 1, sys: 'metric' },
    L: { dim: 'volume', f: 1000, sys: 'metric' },
    tsp: { dim: 'volume', f: 4.92892159375, sys: 'imperial' },
    tbsp: { dim: 'volume', f: 14.78676478125, sys: 'imperial' },
    'fl oz': { dim: 'volume', f: 29.5735295625, sys: 'imperial' },
    cup: { dim: 'volume', f: 236.5882365, sys: 'imperial' },
    pt: { dim: 'volume', f: 473.176473, sys: 'imperial' },
    qt: { dim: 'volume', f: 946.352946, sys: 'imperial' },
    gal: { dim: 'volume', f: 3785.411784, sys: 'imperial' },
    each: { dim: 'count', f: 1, sys: 'any' },
    dozen: { dim: 'count', f: 12, sys: 'any' },
  };
  const UNIT_GROUPS = [
    ['Weight', ['g', 'kg', 'oz', 'lb']],
    ['Volume', ['ml', 'L', 'tsp', 'tbsp', 'fl oz', 'cup', 'pt', 'qt', 'gal']],
    ['Count', ['each', 'dozen']],
  ];

  const INGREDIENT_CATEGORIES = [
    'meat', 'fat', 'pepper', 'produce', 'spice', 'salt', 'cure', 'sugar', 'vinegar', 'liquid',
    'spirit', 'oil', 'casing', 'packaging', 'other',
  ];
  const PRODUCTS = ['pepper sauce', 'smoked pâté', 'pastrami', 'jerky', 'meat sticks', 'infused rum', 'other'];
  const ENERGY_KINDS = ['electricity', 'propane', 'charcoal', 'wood pellets', 'wood chips', 'wood chunks', 'natural gas', 'other'];
  const ENERGY_UNITS = ['kWh', 'lb', 'kg', 'L', 'gal', 'bag', 'cylinder'];
  const EQUIPMENT_KINDS = ['smoker', 'grill', 'dehydrator', 'oven', 'stove / burner', 'grinder', 'slicer', 'stuffer',
    'mixer / blender', 'vacuum sealer', 'fridge / freezer', 'bottling', 'other'];
  const STEP_SCALING = {
    fixed: 'same for any batch size',
    linear: 'grows with batch size',
    loads: 'per load (by capacity)',
    storage: 'days in fridge / freezer',
  };
  const HOURS_PER_YEAR_ALWAYS_ON = 24 * 365;

  function num(v, d) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : (d === undefined ? 0 : d);
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function dim(unit) {
    return UNITS[unit] ? UNITS[unit].dim : null;
  }

  /**
   * Convert qty between units. density is g per ml and is only needed
   * between weight and volume. Returns NaN when it can't be done.
   */
  function convert(qty, from, to, density) {
    const a = UNITS[from];
    const b = UNITS[to];
    if (!a || !b) return NaN;
    let base = num(qty) * a.f;
    if (a.dim !== b.dim) {
      const d = num(density);
      if (!(d > 0)) return NaN;
      if (a.dim === 'weight' && b.dim === 'volume') base = base / d;
      else if (a.dim === 'volume' && b.dim === 'weight') base = base * d;
      else return NaN;
    }
    return base / b.f;
  }

  // Move to a friendlier unit in the same system (2500 g -> 2.5 kg, 9 tsp -> 3 tbsp).
  function tidy(qty, unit) {
    const q = num(qty);
    const steps = {
      g: q >= 1000 ? 'kg' : null, kg: q < 1 ? 'g' : null,
      oz: q >= 16 ? 'lb' : null, lb: q < 1 ? 'oz' : null,
      ml: q >= 1000 ? 'L' : null, L: q < 1 ? 'ml' : null,
      tsp: q >= 3 ? 'tbsp' : null, tbsp: q >= 8 ? 'cup' : (q < 1 ? 'tsp' : null),
      cup: q >= 16 ? 'gal' : (q < 0.5 ? 'tbsp' : null),
      'fl oz': q >= 128 ? 'gal' : null,
      pt: q >= 8 ? 'gal' : null, qt: q >= 4 ? 'gal' : null,
    };
    const to = steps[unit];
    return to ? { qty: convert(q, unit, to), unit: to } : { qty: q, unit };
  }

  // The same amount in the other measuring system, for people who think in both.
  function alt(qty, unit) {
    const u = UNITS[unit];
    if (!u || u.sys === 'any') return null;
    const g = num(qty) * u.f;
    let to;
    if (u.dim === 'weight') to = u.sys === 'metric' ? (g >= 453.59237 ? 'lb' : 'oz') : (g >= 1000 ? 'kg' : 'g');
    else if (u.sys === 'metric') to = g >= 3785.411784 ? 'gal' : g >= 236.5882365 ? 'cup' : g >= 14.78676478125 ? 'tbsp' : 'tsp';
    else to = g >= 1000 ? 'L' : 'ml';
    return { qty: convert(qty, unit, to), unit: to };
  }

  // ---------- prices ----------

  // What one recipe unit of an ingredient costs, allowing for trim loss.
  function ingredientCost(ing, qty, unit) {
    if (!ing) return NaN;
    const packQty = num(ing.purchase_qty);
    if (!(packQty > 0)) return NaN;
    const inPackUnits = convert(qty, unit, ing.purchase_unit, ing.density);
    if (!Number.isFinite(inPackUnits)) return NaN;
    const usable = num(ing.yield_pct, 100) > 0 ? num(ing.yield_pct, 100) / 100 : 1;
    return (inPackUnits / packQty) * num(ing.purchase_price) / usable;
  }

  function energyUnitCost(en) {
    if (!en) return 0;
    const size = num(en.pack_size, 1) > 0 ? num(en.pack_size, 1) : 1;
    return num(en.pack_price) / size;
  }

  // Equipment that is never switched off (fridges, freezers) wears out by the clock.
  function hoursPerYear(eq) {
    return num(eq.always_on) ? HOURS_PER_YEAR_ALWAYS_ON : num(eq.hours_per_year);
  }

  // Wear and upkeep per hour of use: (cost - resale) spread over its working life, plus yearly maintenance.
  function equipmentHourlyCost(eq) {
    if (!eq) return 0;
    const yearHours = hoursPerYear(eq);
    const lifeHours = num(eq.life_years) * yearHours;
    const wear = lifeHours > 0 ? Math.max(0, num(eq.purchase_cost) - num(eq.salvage_value)) / lifeHours : 0;
    const upkeep = yearHours > 0 ? num(eq.maintenance_per_year) / yearHours : 0;
    return wear + upkeep;
  }

  /**
   * Straight-line depreciation summary for one piece of equipment.
   * Costing uses hours of use; the book value here is by age, for reference.
   */
  function depreciation(eq, asOf) {
    const cost = num(eq.purchase_cost);
    const salvage = Math.min(num(eq.salvage_value), cost);
    const life = num(eq.life_years);
    const perYear = life > 0 ? (cost - salvage) / life : 0;
    const out = { perYear, perHour: equipmentHourlyCost(eq), lifeHours: life * hoursPerYear(eq), ageYears: null, bookValue: null, yearsLeft: null };
    const bought = eq.purchase_date ? new Date(eq.purchase_date + 'T00:00:00') : null;
    if (bought && !isNaN(bought)) {
      const now = asOf ? new Date(asOf) : new Date();
      const age = Math.max(0, (now - bought) / (365.25 * 86400000));
      out.ageYears = age;
      out.bookValue = Math.max(salvage, cost - perYear * age);
      out.yearsLeft = life > 0 ? Math.max(0, life - age) : null;
    }
    return out;
  }

  // ---------- scaling ----------

  function batchLines(recipe) {
    return (recipe.lines || []).filter(l => l.basis !== 'per_pack');
  }

  /**
   * How many times the saved recipe to make.
   * scale.mode: factor | output (qty + unit) | packs | ingredient (line index into
   * batch lines, plus qty + unit I have on hand).
   */
  function resolveFactor(recipe, scale, ingredientsById) {
    const s = scale || {};
    const yieldQty = num(recipe.yield_qty);
    if (s.mode === 'output' || s.mode === 'packs') {
      if (!(yieldQty > 0)) return { factor: 1, error: 'Set the batch yield on the recipe first' };
      let want;
      if (s.mode === 'output') want = convert(s.qty, s.unit, recipe.yield_unit, recipe.density);
      else want = convert(num(s.packs) * num(recipe.pack_qty), recipe.pack_unit, recipe.yield_unit, recipe.density);
      if (s.mode === 'packs' && !(num(recipe.pack_qty) > 0)) return { factor: 1, error: 'Set the pack size on the recipe first' };
      if (!Number.isFinite(want)) return { factor: 1, error: `Can't convert ${s.mode === 'packs' ? recipe.pack_unit : s.unit} to ${recipe.yield_unit}. Add the product density to the recipe.` };
      return { factor: want / yieldQty };
    }
    if (s.mode === 'ingredient') {
      const line = batchLines(recipe)[num(s.line)];
      if (!line || !(num(line.qty) > 0)) return { factor: 1, error: 'Pick an ingredient' };
      const ing = ingredientsById[line.ingredient_id];
      const have = convert(s.qty, s.unit, line.unit, ing && ing.density);
      if (!Number.isFinite(have)) return { factor: 1, error: `Can't convert ${s.unit} to ${line.unit} for this ingredient. Add its density.` };
      return { factor: have / num(line.qty) };
    }
    const f = num(s.factor, 1);
    return { factor: f > 0 ? f : 1 };
  }

  /**
   * Scale a recipe and cost it.
   * input: { recipe, scale, ingredientsById, equipmentById, energyById, settings }
   */
  function computeRecipe(input) {
    const recipe = input.recipe || {};
    const ings = input.ingredientsById || {};
    const eqs = input.equipmentById || {};
    const ens = input.energyById || {};
    const settings = input.settings || {};
    const warnings = [];

    const res = resolveFactor(recipe, input.scale, ings);
    if (res.error) warnings.push(res.error);
    const factor = res.factor;

    const outQty = num(recipe.yield_qty) * factor;
    const output = { qty: outQty, unit: recipe.yield_unit || 'kg' };

    let packs = 0;
    let leftover = null;
    if (num(recipe.pack_qty) > 0 && recipe.pack_unit) {
      const perPack = convert(recipe.pack_qty, recipe.pack_unit, output.unit, recipe.density);
      if (Number.isFinite(perPack) && perPack > 0) {
        packs = Math.floor(outQty / perPack + 1e-9);
        leftover = { qty: Math.max(0, outQty - packs * perPack), unit: output.unit };
      } else {
        warnings.push(`Pack size (${recipe.pack_unit}) can't be compared with the yield (${output.unit}). Add the product density.`);
      }
    }

    // Ingredients and packaging
    const lines = (recipe.lines || []).map((l, index) => {
      const ing = ings[l.ingredient_id];
      const perPack = l.basis === 'per_pack';
      const qty = num(l.qty) * (perPack ? packs : factor);
      const out = {
        index, ingredient_id: l.ingredient_id, name: ing ? ing.name : '(missing ingredient)',
        category: ing ? ing.category : 'other', basis: perPack ? 'per_pack' : 'batch',
        qty, unit: l.unit, note: l.note || '', cost: 0, grams: NaN, warning: null,
      };
      if (!ing) out.warning = 'Ingredient not found';
      else {
        const c = ingredientCost(ing, qty, l.unit);
        if (Number.isFinite(c)) out.cost = c;
        else out.warning = `Can't price ${l.unit} against ${ing.purchase_unit || 'no price'}${dim(l.unit) !== dim(ing.purchase_unit) ? ' (add density)' : ''}`;
        if (!perPack) out.grams = convert(qty, l.unit, 'g', ing.density);
      }
      if (out.warning) warnings.push(`${out.name}: ${out.warning}`);
      return out;
    });
    const totalGrams = lines.reduce((s, l) => s + (Number.isFinite(l.grams) ? l.grams : 0), 0);
    lines.forEach(l => { l.pct = Number.isFinite(l.grams) && totalGrams > 0 ? l.grams / totalGrams * 100 : null; });

    // Process steps: equipment wear, energy and labour
    const laborRate = num(settings.labor_rate);
    const energyTotals = {};
    const steps = (recipe.steps || []).map((st, index) => {
      const eq = eqs[st.equipment_id];
      let runs = 1;
      let mult = 1;
      let share = 1; // part of a fridge or freezer this batch takes up
      let days = 0;
      let warning = null;
      if (st.scaling === 'linear') mult = factor;
      else if (st.scaling === 'storage') {
        days = num(st.days);
        const stored = num(st.store_qty) > 0 ? num(st.store_qty) * factor : outQty;
        const storeUnit = num(st.store_qty) > 0 ? (st.store_unit || output.unit) : output.unit;
        const cap = eq ? convert(eq.capacity_qty, eq.capacity_unit, storeUnit, recipe.density) : NaN;
        if (Number.isFinite(cap) && cap > 0) share = Math.min(1, stored / cap);
        else if (eq) warning = `Set how much ${eq.name} holds (on the Equipment page), or the whole unit is charged`;
      }
      else if (st.scaling === 'loads') {
        const cap = convert(st.load_capacity, st.load_unit || output.unit, output.unit, recipe.density);
        if (Number.isFinite(cap) && cap > 0) runs = Math.max(1, Math.ceil(outQty / cap - 1e-9));
        else warning = 'Set how much one load holds';
        mult = runs;
      }
      const hours = st.scaling === 'storage' ? days * 24 : num(st.hours) * mult;
      const energy = (st.energy || []).filter(e => e.energy_id).map(e => {
        const en = ens[e.energy_id];
        const qty = num(e.qty) * (e.per === 'run' ? mult : e.per === 'day' ? hours / 24 : hours) * share;
        const cost = qty * energyUnitCost(en);
        const key = e.energy_id;
        if (!energyTotals[key]) energyTotals[key] = { energy_id: key, name: en ? en.name : '(missing)', unit: en ? en.unit : '', qty: 0, cost: 0 };
        energyTotals[key].qty += qty;
        energyTotals[key].cost += cost;
        return { energy_id: e.energy_id, name: en ? en.name : '(missing energy source)', unit: en ? en.unit : '', qty, cost };
      });
      const energyCost = energy.reduce((s, e) => s + e.cost, 0);
      const equipmentCost = eq ? equipmentHourlyCost(eq) * hours * share : 0;
      const laborHours = num(st.labor_hours) * mult;
      const laborCost = laborHours * laborRate;
      if (st.equipment_id && !eq) warning = 'Equipment not found';
      if (warning) warnings.push(`${st.label || 'Step ' + (index + 1)}: ${warning}`);
      return {
        index, label: st.label || (eq ? eq.name : 'Step ' + (index + 1)), equipment_id: st.equipment_id || null,
        equipmentName: eq ? eq.name : '', scaling: st.scaling || 'fixed', runs, hours, days, share, energy, energyCost,
        equipmentCost, laborHours, laborCost, warning,
      };
    });

    const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
    const packagingLines = lines.filter(l => l.category === 'packaging');
    const t = {
      ingredients: sum(lines, 'cost') - sum(packagingLines, 'cost'),
      packaging: sum(packagingLines, 'cost'),
      energy: sum(steps, 'energyCost'),
      equipment: sum(steps, 'equipmentCost'),
      labor: sum(steps, 'laborCost'),
      laborHours: sum(steps, 'laborHours'),
    };
    t.total = t.ingredients + t.packaging + t.energy + t.equipment + t.labor;
    t.perYieldUnit = outQty > 0 ? t.total / outQty : 0;
    const perOf = u => {
      const q = convert(outQty, output.unit, u, recipe.density);
      return Number.isFinite(q) && q > 0 ? t.total / q : null;
    };
    t.perKg = perOf('kg');
    t.perLb = perOf('lb');
    t.perL = perOf('L');
    t.perPack = packs > 0 ? t.total / packs : null;

    // Selling price is per pack when there is a pack size, otherwise per yield unit.
    const unitCost = packs > 0 ? t.perPack : t.perYieldUnit;
    const units = packs > 0 ? packs : outQty;
    const margin = num(settings.target_margin_pct);
    t.suggestedPrice = unitCost && margin < 100 ? unitCost / (1 - margin / 100) : null;
    t.sellPrice = num(recipe.sell_price) > 0 ? num(recipe.sell_price) : null;
    if (t.sellPrice) {
      t.revenue = t.sellPrice * units;
      t.profit = t.revenue - t.total;
      t.margin = t.revenue > 0 ? t.profit / t.revenue * 100 : null;
    }

    return {
      factor, output, packs, leftover, lines, steps, totalGrams,
      energyBySource: Object.values(energyTotals),
      totals: t, warnings,
    };
  }

  const api = {
    UNITS, UNIT_GROUPS, INGREDIENT_CATEGORIES, PRODUCTS, ENERGY_KINDS, ENERGY_UNITS, EQUIPMENT_KINDS, STEP_SCALING,
    num, round2, dim, convert, tidy, alt, ingredientCost, energyUnitCost, hoursPerYear, equipmentHourlyCost, depreciation,
    resolveFactor, computeRecipe,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
