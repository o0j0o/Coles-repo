# Recipe Costing (Black Belly Smokers)

A recipe book that scales your batches and works out what each batch really costs to make: ingredients, packaging, equipment wear, energy (electricity, propane, charcoal, wood pellets, wood chips) and labour. It works on a desktop and on an iPhone, and you can add it to your Home Screen like an app.

## What it does

**Recipes**
- Store each recipe with what one batch makes (the finished yield after cooking, smoking or drying), an optional pack size (150 ml bottle, 100 g pouch) and your selling price.
- Ingredient amounts in any unit: g, kg, oz, lb, ml, L, tsp, tbsp, fl oz, cups, pints, quarts, gallons, or each. Packaging lines (bottles, labels, pouches) can be **per pack**, so they follow the number of packs filled.
- Process steps (smoke, dry, cook, grind, bottle) with the equipment used, hours, labour and the fuel or power burned. Each step says how it behaves when you scale up:
  - **Same for any batch size**: e.g. one cook on the burner.
  - **Grows with batch size**: e.g. slicing or bottling time.
  - **Per load**: you say how much finished product one smoker or dehydrator load makes, and a bigger batch takes whole extra loads (6 kg of jerky at 2.5 kg a load = 3 loads).
- Live batch cost while you edit, with cost per pack, per kg, per lb or per L, your margin at your selling price, and the price you'd need for your target margin.

**Make a batch** (tap a recipe)
- Scale by the amount you want (e.g. 20 L or 6 kg), by number of packs, by a multiplier, or by **what I have** (e.g. "I have 12 lb of brisket, how much can I make?").
- Scaled ingredient list in friendly units with the metric/imperial equivalent, and each ingredient's percent of the mix (handy for checking cure levels).
- Loads, hours, fuel and electricity for the batch, and the full cost breakdown.
- **Print batch sheet** with lot number and date, with or without costs.

**Ingredients**: what you pay and for how much (e.g. $45 for a 25 lb box), supplier, price date, usable percent after trimming (a brisket that loses 20% to trim is costed on the usable weight), and density for switching between weight and volume.

**Equipment**: purchase price, resale value, working life, hours used per year and yearly maintenance give a wear-and-upkeep cost per hour. Each machine also lists the fuel or power it uses per hour or per run; these fill in automatically when you pick it in a recipe step and can be changed per recipe.

**Energy**: electricity, propane, charcoal, wood pellets, wood chips and anything else, priced the way you buy them (a 25 lb cylinder, a 20 lb bag, your all-in rate per kWh).

**Settings**: business name, currency symbol, labour rate per hour, target margin, metric or imperial defaults, and a full backup and restore.

The app starts with sample ingredients, equipment, energy prices and three sample recipes (pepper sauce, jerky and pepper rum). **All sample prices and recipes are placeholders.** Edit or delete them and enter your real numbers. Something used in a recipe can't be deleted until it's removed from the recipe; untick **Active** to hide it instead.

## How the costs are worked out

- **Ingredient** = amount ÷ purchase amount × purchase price ÷ usable %.
- **Equipment wear per hour** = (purchase price − resale value) ÷ (working life in years × hours used per year), plus maintenance per year ÷ hours used per year.
- **Energy** = amount used × (purchase price ÷ amount in that purchase).
- **Labour** = person-hours × labour rate.
- **Cost per pack** = total batch cost ÷ full packs filled. Product left over after the last full pack is shown separately.

## Running it

You need [Node.js](https://nodejs.org) 22.5 or newer. There are no other dependencies.

```bash
cd recipe-costing
npm start
```

Then open http://localhost:3000. To use it from your iPhone on the same Wi-Fi, open `http://<your-computer's-IP>:3000`.

| Environment variable | Default  | Purpose |
|----------------------|----------|---------|
| `PORT`               | `3000`   | Port to listen on |
| `DATA_DIR`           | `./data` | Where the SQLite database (`recipes.db`) is stored |
| `APP_PASSWORD`       | (none)   | If set, the app asks for this password. **Always set this when the app is reachable from the internet.** |
| `SESSION_SECRET`     | derived  | Optional extra secret for signing login cookies |

Run the tests with `npm test`.

## Putting it online

The app is a single Node process with a SQLite file. It runs on any host that supports Node and gives you a **persistent disk**, for example Render (with a Disk), Railway (with a Volume), Fly.io (with a Volume), or a small VPS. Set the root directory to `recipe-costing`, the start command to `npm start`, mount a persistent disk and point `DATA_DIR` at it, set `APP_PASSWORD`, and use HTTPS.

**On iPhone**: open the site in Safari, tap Share, then **Add to Home Screen**.

**Backups**: use Settings, then Download backup, regularly.

## Project layout

```
server.js             HTTP server, JSON API, login
lib/db.js             SQLite schema and settings
lib/seed.js           Starter data (placeholder prices)
public/index.html     App shell
public/js/costing.js  Units, scaling and cost engine (shared by browser and tests)
public/js/app.js      Screens: recipes, make a batch, ingredients, equipment, energy, settings
public/css/app.css    Mobile-first styles, print styles for batch sheets
test/                 Costing and API tests
```
