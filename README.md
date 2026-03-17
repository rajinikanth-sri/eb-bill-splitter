# ⚡ EB Bill Splitter

A **Progressive Web App (PWA)** to split electricity bills among tenants using sub-meter readings. Supports multiple main meters, proportional billing, WhatsApp notifications, and Excel export — works offline and installs on iPhone like a native app.

---

## Features

- **Multi-meter support** — configure any number of main meters, each linked to its own set of tenants
- **Sub-meter based billing** — each tenant's share is calculated from their individual sub-meter readings
- **Smart split rules** — energy and tax split proportionally by usage; fixed and common area charges split equally
- **WhatsApp notifications** — sends pre-filled bill messages to each tenant via WhatsApp with one tap
- **Month-to-month auto-fill** — previous readings are automatically carried forward from the last saved record
- **History** — stores every bill with full breakdown; resend WhatsApp messages from any past record
- **Excel export** — downloads a formatted `.xlsx` with Summary, Detailed Splits, and per-period-meter sheets
- **Offline support** — works without internet after first load via service worker
- **Dark mode** — automatic, follows device preference
- **iPhone home screen** — installable as a PWA from Safari

---

## Project Structure

```
eb-splitter-pwa/
├── index.html        # App shell and all UI panels
├── style.css         # Mobile-optimised styles with iOS safe area support
├── app.js            # All business logic — billing, storage, export
├── manifest.json     # PWA manifest for home screen install
├── sw.js             # Service worker for offline caching
├── icons/
│   ├── icon-192.png  # App icon (home screen, splash screen)
│   └── icon-512.png  # App icon (high-res)
└── README.md         # This file
```

---

## How to Deploy (Free, 2 minutes)

### Option A — Netlify Drop (recommended, no account needed)
1. Unzip the project folder
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
3. Drag and drop the `eb-splitter-pwa` folder onto the page
4. You get a live URL instantly, e.g. `https://your-app-name.netlify.app`

### Option B — GitHub Pages
1. Create a new GitHub repository
2. Upload all files to the repo root
3. Go to **Settings → Pages → Source: main branch**
4. Your app is live at `https://yourusername.github.io/repo-name`

### Option C — Any static host
Upload all files to any static hosting provider (Vercel, Firebase Hosting, Cloudflare Pages, etc.). No server-side code required.

> **Note:** The service worker requires HTTPS to work. All the options above provide HTTPS automatically.

---

## Install on iPhone

1. Open the hosted URL in **Safari** (must be Safari, not Chrome or Firefox)
2. Tap the **Share** button (box with arrow at the bottom of Safari)
3. Tap **"Add to Home Screen"**
4. Tap **Add**

The app now appears on your home screen with its own icon and opens full-screen without the Safari address bar. It works offline after the first load.

---

## How to Use

### 1. Settings (first time setup)

**Tenants**
- Add each tenant with their name and WhatsApp number
- WhatsApp numbers must be in international format without `+` or spaces
- Example: `919876543210` for an Indian number (+91 98765 43210)

**Main meters**
- Add one entry per physical main meter (e.g. EB board meter, generator meter)
- Tap tenant chips to link tenants to each meter
- A tenant can be linked to multiple meters independently

**Billing cycle**
- Choose Monthly or Bi-monthly

**Message template**
- Customise the WhatsApp message using placeholders (see below)
- A live preview updates as you type

Tap **Save settings** when done.

---

### 2. Calculate (each billing cycle)

1. Enter the **period label** (e.g. `FEB 2026`) and reading date
2. For each main meter:
   - Enter previous and current meter readings in kWh
   - Enter the rate per unit (₹/kWh) — the energy charge auto-calculates
   - Adjust energy, fixed, common area, and tax amounts from the actual bill
   - Enter the confirmed total bill amount to verify the breakdown matches
3. For each sub-meter (tenant):
   - Enter previous and current readings
   - Usage calculates automatically
4. Tap **Calculate split**
5. Review the breakdown per meter and per tenant
6. Tap individual **WhatsApp buttons** to send each tenant their bill, or send all at once
7. Tap **Save to history**

Next month, previous readings are **auto-filled** from the last saved record — you only need to enter the current readings.

---

### 3. History

- View all saved billing records
- Tap **View** on any record to see the full breakdown
- Resend WhatsApp messages from any historical record
- Export all records to Excel at any time

---

## Split Rules

| Charge | How it's split |
|---|---|
| ⚡ Energy charges | Proportional to each tenant's sub-meter usage |
| 🧾 Tax | Proportional to each tenant's sub-meter usage |
| 🔧 Fixed charges | Split equally among all linked tenants |
| 🏢 Common area charges | Split equally among all linked tenants |

If sub-meter totals don't match the main meter, a warning is shown and the energy/tax proportions are still calculated from the sub-meter ratios.

---

## WhatsApp Message Template

The default template matches a standard EB bill format:

```
*EB Bill {period} — {meter}:*
===================
*{name}:*
READING {curr} - {prev} = {usage}
Total Energy Charge: {total_energy_amt} ({rate}*)
Energy Charges: {energy_amt} ({rate} * {usage} Units)
Fixed Charge: {fixed_total}/{num_splits} = {fixed_amt}
Common Area: {common_amt}
Tax: {tax_amt}
*Total: ₹{total}*
```

### Available placeholders

| Placeholder | Description |
|---|---|
| `{name}` | Tenant name |
| `{meter}` | Main meter name |
| `{period}` | Billing period label |
| `{prev}` | Sub-meter previous reading |
| `{curr}` | Sub-meter current reading |
| `{usage}` | Sub-meter units consumed (kWh) |
| `{rate}` | Rate per unit (₹/kWh) |
| `{total_energy_amt}` | Full main meter energy charge (same for all tenants in that meter) |
| `{energy_amt}` | This tenant's proportional energy charge |
| `{fixed_total}` | Total fixed charge before split |
| `{fixed_amt}` | This tenant's fixed charge share |
| `{common_amt}` | This tenant's common area charge share |
| `{tax_amt}` | This tenant's proportional tax |
| `{total}` | This tenant's total amount due |
| `{num_splits}` | Number of tenants linked to this meter |

---

## Excel Export

The exported `.xlsx` file contains:

- **Summary sheet** — one row per meter per billing period with all charge components
- **Detailed Splits sheet** — one row per tenant per meter per period, sortable and filterable
- **Per-period-meter sheets** — individual sheet for each meter per period (e.g. `JAN 2026 - EB Main`) with main meter info at the top and a tenant breakdown table with `SUM` formulas at the bottom

The Excel file opens natively in Microsoft Excel, Numbers (Mac/iPhone), and Google Sheets (upload to Drive).

---

## Data Storage

All data is stored in the browser's `localStorage` on the device. Nothing is sent to any server.

- Settings: saved automatically on "Save settings"
- History: saved on "Save to history" after each calculation
- Data persists across sessions and app restarts
- Use **Backup JSON** in Settings → Data management to export a full backup
- To move data to a new device, export JSON and manually import by replacing `localStorage` values in the browser console

---

## Technical Details

| Item | Detail |
|---|---|
| Type | Progressive Web App (PWA) |
| Framework | Vanilla HTML / CSS / JavaScript — no build step |
| Storage | `localStorage` (device only, no cloud) |
| Offline | Service worker caches app shell on first load |
| Excel | [SheetJS (xlsx)](https://sheetjs.com/) loaded from CDN |
| Icons | 192×192 and 512×512 PNG |
| iOS install | Safari → Share → Add to Home Screen |
| Android install | Chrome → three-dot menu → Add to Home Screen |

---

## Limitations

- **WhatsApp sending** uses click-to-chat links (`wa.me`). It opens WhatsApp with a pre-filled message — the user still taps Send. Fully automated sending requires the WhatsApp Business API (needs Meta approval and a backend server).
- **Data is device-local** — history does not sync across devices. Use the JSON backup/restore to move data.
- **No login or cloud** — by design, keeping it simple and private.

---

## License

Free to use for personal and commercial purposes.
