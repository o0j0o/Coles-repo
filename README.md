# Fence Estimator

A web app for estimating fence jobs. You enter measurements or trace the fence on a photo or drawing of the site, choose a fence type, and get a full material list, cost, price and printable customer quote. It works on a desktop and on an iPhone, and you can add it to your Home Screen like an app.

## What it does

**Estimates**
- Enter fence runs by typing lengths (`42.5`, `42' 6"`, or `42 6`), and mark which runs meet at a corner or close a shape.
- Or switch to **Drawing**: upload a photo, sketch, survey or screenshot, tap two points a known distance apart to set the scale, then tap along the fence line. Each straight line becomes a run with its measured length, and you can type over any length. Gates can be tapped onto the drawing. A blank grid works too if you have no picture.
- **Read a sketch (optional, AI)**: take a photo of a hand-drawn sketch with the measurements written on it, and Claude reads the runs, corners and gates into the estimate for you. It lists anything it had to estimate or couldn't read, so you can check it against the drawing. This only appears when `ANTHROPIC_API_KEY` is set on the server (see below).
- Gates: single or double, any width, and you choose the gate product.
- The app counts sections and line, corner, end and gate posts. It then builds the material list from the fence type's recipe, adding waste allowance and rounding up to full packs (boxes of screws, rolls of fabric, and so on).
- On each job you can swap any material for another one in the same category, override a quantity, remove a line, or add extra items and charges.
- Labour price and cost per foot and per gate, discount, VAT, and deposit.
- The internal view shows your cost, gross profit, margin, and price per foot. Untick **Show my costs** to hide these when the customer is looking at your screen.
- **Quote** page: a clean customer quote (lump-sum or itemised) with the drawing, terms and a signature line. Use Print / Save as PDF, or Share.
- **Order list**: materials grouped by supplier, with supplier SKUs and costs. You can copy it as text or share it (for example to WhatsApp or email) to place orders.

**Materials database** (Materials tab)
- For each material: name, category (post, rail, picket, panel, gate, hardware, fastener, concrete, cap, mesh/wire, finish, other), material type (wood, vinyl, aluminium, chain link and so on), your SKU, size label and dimensions, colour, grade, unit sold by, pieces per unit, waste %, taxable, active, stock on hand, reorder level, and notes.
- **Supplier costs**: a material can have any number of suppliers, each with their own SKU, cost, lead time, minimum order and price date. You mark one as preferred. With none marked, the cheapest is used.
- **Your quoted price**: set a fixed price per material, or leave it blank to use a markup % (per material, or the default from Settings).
- CSV import and export, so you can do bulk price updates in Excel. Rows match existing materials by `id` or `sku`. Supplier names in the file are created if they don't exist.

**Fence types** (Fence Types tab)
- A fence type is a recipe: default height, post spacing, labour rates, default gate, and a list of components such as "3 rails per section", "2 bags of concrete per post", or "2.18 pickets per ft".
- Quantity rules: per ft, per section, per post, per line, corner, end, gate or terminal post, per gate, per gate leaf, per sq ft of fence face, or per job.
- A **Test it** panel shows the material list and price for a sample length, so you can check a recipe while you build it.

**Suppliers**: contact person, phone, email, address, website, account number, payment terms, delivery info and notes, plus a list of everything you buy from that supplier.

**Settings**: company details for quotes, currency symbol, ft or m, tax name and rate (default VAT 17.5%), default markup, deposit %, quote numbering, quote validity, terms, and a full backup and restore.

The app starts with sample suppliers, materials and four fence types (wood privacy, chain link, vinyl and aluminium). **All sample prices are placeholders.** Edit or delete them and enter your real costs.

## Running it

You need [Node.js](https://nodejs.org) 22.5 or newer.

```bash
npm install
npm start
```

Then open http://localhost:3000. To use it from your iPhone on the same Wi-Fi, open `http://<your-computer's-IP>:3000`.

| Environment variable | Default  | Purpose |
|----------------------|----------|---------|
| `PORT`               | `3000`   | Port to listen on |
| `DATA_DIR`           | `./data` | Where the SQLite database (`fence.db`) and uploaded drawings are stored |
| `APP_PASSWORD`       | (none)   | If set, the app asks for this password. **Always set this when the app is reachable from the internet.** |
| `SESSION_SECRET`     | derived  | Optional extra secret for signing login cookies |
| `ANTHROPIC_API_KEY`  | (none)   | Turns on **Read a sketch**. Get a key at https://console.anthropic.com. Each sketch read is one Claude request (typically a few cents). |
| `SKETCH_MODEL`       | `claude-opus-5-5` | Claude model used to read sketches |

```bash
APP_PASSWORD='choose-a-strong-one' npm start
```

Run the tests with `npm test`.

## Putting it online

The app is a single Node process with a SQLite file. It runs on any host that supports Node and gives you a **persistent disk**, for example Render (with a Disk), Railway (with a Volume), Fly.io (with a Volume), or a small VPS. On the host:

1. Point it at this repository. The build command is `npm install` and the start command is `npm start`.
2. Mount a persistent disk and set `DATA_DIR` to its path (for example `/data`). Without one, your data is lost on every redeploy.
3. Set `APP_PASSWORD`.
4. Use HTTPS (most hosts provide it automatically).

**On iPhone**: open the site in Safari, tap Share, then **Add to Home Screen**. It then opens full-screen like an app.

**Backups**: use Settings, then Download backup, regularly. You can also copy `DATA_DIR`, which includes the uploaded drawings.

## How the post count works

For each run, the fence length minus any gate widths is divided by the post spacing and rounded up to give the number of sections. Each gate splits a run, which adds one section and two gate posts. Each run has two ends. Where runs meet at a corner they share one corner post, and a closed shape has no end posts. Every other post is a line post. When gates are in the middle of a run, the count can be one section high, which errs on the side of having enough material.

## Project layout

```
server.js            HTTP server, JSON API, login, uploads
lib/sketch-reader.js Reads fence sketches with Claude (optional)
lib/db.js            SQLite schema and settings
lib/seed.js          Starter data (sample prices)
public/index.html    App shell
public/js/calc.js    Estimating engine (shared by browser and tests)
public/js/layout.js  Drawing/measuring tool
public/js/app.js     Screens: estimates, quote, order list, materials, suppliers, fence types, settings
public/css/app.css   Mobile-first styles, print styles for quotes
test/                Calculation, API and sketch-reader tests
```
