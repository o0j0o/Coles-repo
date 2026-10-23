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

**Equipment and depreciation**: smokers, grills and kitchen equipment (grinder, slicer, stuffer, blender, dehydrator, vacuum sealer and so on) are depreciated by the hours you use them. Enter the purchase price, date bought, resale value at the end, working life, hours used per year and yearly maintenance. Each machine shows its depreciation per year, its book value today, the years left, and its cost per hour of use. A recipe step that runs the smoker for 10 hours carries 10 hours of depreciation. Each machine also lists the fuel or power it uses per hour, per run or per day; these fill in automatically when you pick it in a recipe step and can be changed per recipe.

**Fridges and freezers**: tick **Runs all the time** and enter how much it holds. It is then costed per day (depreciation, maintenance and power) instead of per hour of use. In a recipe, a **days in fridge / freezer** step (marinating overnight, a 7-day pastrami cure, holding stock) charges the batch for the days it sits there and the share of the space it takes. For example, 6 kg in a fridge that holds 120 kg pays 5% of that fridge's daily cost for each day.

**Energy**: electricity, propane, charcoal, wood pellets, wood chips and anything else, priced the way you buy them (a 25 lb cylinder, a 20 lb bag, your all-in rate per kWh).

**Settings**: business name, currency symbol, labour rate per hour, target margin, metric or imperial defaults, and a full backup and restore.

The app starts with sample ingredients, equipment, energy prices and three sample recipes (pepper sauce, jerky and pepper rum). **All sample prices and recipes are placeholders.** Edit or delete them and enter your real numbers. Something used in a recipe can't be deleted until it's removed from the recipe; untick **Active** to hide it instead.

## How the costs are worked out

- **Ingredient** = amount ÷ purchase amount × purchase price ÷ usable %.
- **Equipment depreciation per hour of use** = (purchase price − resale value) ÷ (working life in years × hours used per year), plus maintenance per year ÷ hours used per year. This is straight-line depreciation spread over hours of use.
- **Fridges and freezers** use the same formula with 8,760 hours a year (24 × 365), charged for the days a batch is stored × the share of the space it uses (amount stored ÷ how much the unit holds, at most 100%). Their power use is shared the same way.
- **Book value today** = purchase price − depreciation per year × years since bought, never below the resale value. It's shown for reference and doesn't change recipe costs.
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

## Running it on your lab with Docker

On the lab machine, with Docker and the Compose plugin installed:

```bash
git clone <this repository>
cd Coles-repo/recipe-costing
cp .env.example .env        # then edit .env and set APP_PASSWORD
docker compose up -d --build
```

The app is then on port 3000 of that machine. The database is kept in the Docker volume `recipe-costing_recipes-data`, so it survives restarts, rebuilds and upgrades. The container restarts on its own after a reboot.

**Updating**: `git pull` then `docker compose up -d --build`. Your data stays in the volume, and the database is upgraded automatically when new fields are added.

**Logs**: `docker compose logs -f`

**Backups**: use Settings, then Download backup, regularly. To copy the raw database file as well:

```bash
docker compose cp recipes:/data/recipes.db ./recipes-$(date +%F).db
```

## Reaching it from anywhere with Tailscale

[Tailscale](https://tailscale.com) gives your phone and laptop a private, encrypted link to the lab, so you can open the app at the market or a supplier without opening any ports on your router.

1. Install Tailscale on the lab machine (`curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up`) and sign in.
2. Install the Tailscale app on your iPhone and sign in with the same account.
3. Open `http://<lab-machine-name>:3000` on your phone. The name is shown in the Tailscale app, for example `http://lab:3000`.
4. Optional, for an `https://` address: on the lab machine run `sudo tailscale serve --bg 3000`, then use the `https://<lab-machine-name>.<your-tailnet>.ts.net` address it prints. Add that page to your Home Screen from Safari.

Keep `APP_PASSWORD` set even on the VPN. Anyone on your home network can also reach port 3000. To allow only Tailscale and the lab itself, change the port line in `docker-compose.yml` to `"127.0.0.1:3000:3000"` and use `tailscale serve` (step 4).

## Other hosting

The app is a single Node process with a SQLite file. It also runs on any host that supports Node and gives you a **persistent disk**, for example Render (with a Disk), Railway (with a Volume), Fly.io (with a Volume), or a small VPS. Set the root directory to `recipe-costing`, the start command to `npm start`, mount a persistent disk and point `DATA_DIR` at it, set `APP_PASSWORD`, and use HTTPS.

**On iPhone**: open the site in Safari, tap Share, then **Add to Home Screen**.

**Backups**: use Settings, then Download backup, regularly.

## Project layout

```
Dockerfile            Container image (Node 22, data on a volume at /data)
docker-compose.yml    Lab deployment; copy .env.example to .env first
server.js             HTTP server, JSON API, login
lib/db.js             SQLite schema, upgrades and settings
lib/seed.js           Starter data (placeholder prices)
public/index.html     App shell
public/js/costing.js  Units, scaling and cost engine (shared by browser and tests)
public/js/app.js      Screens: recipes, make a batch, ingredients, equipment, energy, settings
public/css/app.css    Mobile-first styles, print styles for batch sheets
test/                 Costing and API tests
```
