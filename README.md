<div align="center">

# Crosswalk 🧭

**A job-search assistant that runs on _your_ computer.** It finds jobs that fit you, writes a tailored résumé + cover letter for each, fills in the application form, and — if you let it — submits it for you. Hands-off.

Local-first · your data never leaves your machine · bring your own AI.

</div>

---

## Contents

- [What is this?](#what-is-this)
- [Two ways to use it](#two-ways-to-use-it)
- [Quick setup (3 steps)](#quick-setup-3-steps)
- [Add your AI key](#add-your-ai-key)
- [How to use the app](#how-to-use-the-app)
- [Use it inside Claude or other AI tools](#use-it-inside-claude-or-other-ai-tools)
- [Run it automatically (hands-off)](#run-it-automatically-hands-off)
- [Try it safely first](#try-it-safely-first)
- [Troubleshooting](#troubleshooting)
- [Updating to a newer version](#updating-to-a-newer-version)
- [Your privacy](#your-privacy)
- [For developers](#for-developers)
- [Contributing](#contributing)
- [License](#license)

---

## What is this?

You tell it _"I'm looking for **Product Manager** jobs"_ and it:

1. 🔎 **Finds** matching jobs across thousands of companies.
2. ✍️ **Rewrites your résumé** to fit each job — using only true facts from your real résumé.
3. 📝 **Writes a cover letter** and **answers the application questions** (text, dropdowns, checkboxes, and all).
4. ✅ **Fills in the form** and, if you allow it, clicks **Submit**.
5. 👀 **Keeps watching**, so the moment a new matching job is posted, it grabs it.

Everything runs on **your own laptop**. Your résumé, jobs, and history live in one folder on your computer (`~/.crosswalk`). Nothing is uploaded to anyone.

---

## Two ways to use it

| | What it is | Best for |
|---|---|---|
| **🖥️ The App** | A website that runs on your own computer (`localhost:3000`) | Everyone — this guide is mostly about this. |
| **💬 Inside your AI** | Plugs into Claude Desktop / Cursor / Codex and you just chat | People who already use an AI assistant. |

You can use either, or both — they share the same data.

---

## Quick setup (3 steps)

> You only do this once. It takes about 5 minutes. No coding needed.

### Step 1 — Install Node.js (the engine that runs the app)

1. Go to **[nodejs.org](https://nodejs.org)**.
2. Click the big green **"LTS"** button (this needs to be **version 24 or newer** — the LTS button is the right one). It downloads a file.
3. Open the file and click **Next → Next → Install**, like installing any app.

### Step 2 — Download Crosswalk

1. Open **[the Crosswalk page on GitHub](https://github.com/Mohakgarg5/crosswalk-mcp)**.
2. Click the green **`<> Code`** button → **Download ZIP**.
3. Find the ZIP (usually in **Downloads**) and **double-click it to unzip**.
4. You'll get a folder named **`crosswalk-mcp-main`**. Move it somewhere easy, like your **Desktop**.

### Step 3 — Start it (just double-click)

Open the `crosswalk-mcp-main` folder, then:

- **Mac:** right-click **`start.command`** → **Open** → **Open**.
  _(Right-click only the first time. After that, a normal double-click works.)_
- **Windows:** double-click **`start.cmd`**.
  _(If you see "Windows protected your PC", click **More info → Run anyway**.)_

A window opens. The first time, it spends about a minute getting ready, then your **browser opens to the app automatically**. 🎉

> If the page shows an error at first, wait a few seconds and **refresh** — it's just warming up.
> To **stop** it, close that window. To start again, double-click the same file.

---

## Add your AI key

The app uses an AI ("the brain") to write your résumés and answers. Here's how to get a key:

1. Make a free account at **[console.anthropic.com](https://console.anthropic.com)**.
2. Go to **API Keys → Create Key** and **copy** the code (it starts with `sk-ant-`).
3. In the app, click **Settings**, paste it in the **API key** box, and click **Save**.

> 💡 You pay Anthropic directly — usually a few cents per résumé. **Finding and tracking jobs works without a key**; you only need it for writing résumés and answers.

---

## How to use the app

Use the left-hand menu, roughly in this order:

1. **Profile** — write a few sentences about yourself (e.g. _"PM, 3 years at Acme, want NYC or remote, need visa sponsorship"_). Save.
2. **Résumés** — paste your résumé, name it, click **Add**.
3. **Settings → Answer bank** — click **"Load common defaults"** (safe answers for standard questions like work authorization and the optional EEO/diversity ones), then add your own, e.g. `salary → $130,000`.
4. **Jobs** — type a role (like `product manager`) and click **Search jobs**. You get real jobs from many companies.
5. **Apply** — click **draft →** on a job to review it first, or **Auto-apply** at the top of the results to handle them all.
6. **Pipeline / Alerts / Inbox** — track every application, see new-match alerts, and route recruiter emails to the right application.

---

## Use it inside Claude or other AI tools

Crosswalk is also an **MCP server**, so it can plug straight into your AI assistant. Then you just **chat** with it, and it uses the AI you already pay for — **no separate API key needed**. It shares the **same data** as the app, so your profile, résumés, and answer bank carry over.

### Recommended: connect your downloaded copy (newest features)

1. In the `crosswalk-mcp-main` folder, build it once (in a terminal):
   ```bash
   npm install
   npm run build:core
   ```
2. Connect it to your AI tool, using the **full path** to the folder:

   **Claude Code (command line):**
   ```bash
   claude mcp add crosswalk-mcp -- node /FULL/PATH/TO/crosswalk-mcp-main/packages/core/dist/cli.js
   ```

   **Claude Desktop / Cursor / Windsurf** — add this to the app's MCP config file
   (Claude Desktop is at `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):
   ```json
   {
     "mcpServers": {
       "crosswalk-mcp": {
         "command": "node",
         "args": ["/FULL/PATH/TO/crosswalk-mcp-main/packages/core/dist/cli.js"]
       }
     }
   }
   ```
3. Restart the AI app.

### Quicker, but older: one-command install

```bash
npx crosswalk-mcp install     # auto-detects Claude Desktop / Cursor / Windsurf
```
> ⚠️ This installs the version published to npm, which can be **behind** the newest features in this repo. For everything in this guide, use the recommended option above.

### Then just talk to it

> _"Set up my profile: PM, 3 years at Acme, want NYC or remote, need visa sponsorship."_
> _"Add my résumé from ~/Documents/cv.pdf."_
> _"Find PM roles at H‑1B sponsors. Why am I a fit for the Stripe one?"_
> _"Tailor my résumé for it and draft an application."_ · _"Apply to it."_ · _"Show my pipeline."_

### What's available where

- **In chat (MCP):** the core loop — find jobs (your watched companies), score/explain fit, tailor résumés, draft + **apply** (with the smart form-filling: multi-page wizards, dropdowns, checkboxes, answer bank), track your pipeline, schedule refreshes.
- **App + the watcher only (for now):** open-web role search across thousands of companies, batch auto-apply, the continuous watcher, and editing the answer bank.

---

## Run it automatically (hands-off)

Set this up **in the app first** (it stores your key, watches, and settings):

1. **Settings** → set **Submit policy = auto** and **Weekly cap = 0** (0 means unlimited).
2. **Jobs** → search a role → **Save as watch** → tick **auto-apply new matches**.

Then it applies automatically while the app (or the chat session) is open. To keep it going **even with the app closed**, run the watcher daemon from the folder (in a terminal):

```bash
npm run watch       # checks for new matching jobs every 15 minutes and applies to them
```

**Login-walled sites (Workday, etc.):** see the note inside **Settings → Autonomous apply** — it explains how to run with a browser that stays logged into your accounts.

---

## Try it safely first

Before letting it submit for real:

1. **Settings → Submit policy = review** (it fills the form but does **not** click Submit).
2. Find one job → **draft →** → check the tailored résumé and answers look right.

Once you trust it, switch to **auto**.

> ⚠️ **A friendly heads-up:** blasting out *thousands* of auto-written applications can hurt your chances and may break some sites' rules. Start with a few, check the quality, and turn up the volume only when you're happy. The more you fill in your **answer bank**, the better the answers.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Double-click does nothing / "can't be opened" (Mac) | Right-click `start.command` → **Open** → **Open**. |
| "Windows protected your PC" | Click **More info → Run anyway**. |
| It says **Node.js is not installed** | Do [Step 1](#quick-setup-3-steps), then start again. |
| The page shows an error at first | Wait a few seconds and **refresh** — it's still warming up. |
| Port `3000` is busy | Close other apps using it, or in a terminal run `PORT=3001 npm run gui` and open `localhost:3001`. |
| "No Anthropic API key set" | Add your key in **Settings** (see [Add your AI key](#add-your-ai-key)). |
| Auto-apply says "browser not installed" | In a terminal: `npx crosswalk-mcp install-browser`. |

---

## Updating to a newer version

Re-download the ZIP from GitHub (or, if you used `git`, run `git pull`), then start it again. Your data is safe — it lives in `~/.crosswalk`, separate from the app folder. If a new version changes the engine, rebuild once with `npm run build:core`.

---

## Your privacy

- Everything lives in **one folder on your computer**: `~/.crosswalk` (data in `state.db`, your API key in `config.json`).
- **No telemetry, no phone-home, no accounts.** There is no "us."
- The only network it uses: the job sites (to find/apply) and Anthropic (to write résumés, with your key).
- To erase everything: delete the `~/.crosswalk` folder.

---

## For developers

An **npm-workspaces monorepo**:

- `packages/core` — the engine, published as the `crosswalk-mcp` MCP server (store, services, 10 ATS adapters, role aggregator, auto-apply, watcher).
- `apps/web` — the Next.js GUI (`@crosswalk/web`).
- `scripts/watch.mjs` — the always-on watcher daemon.

```bash
npm install          # install everything
npm test             # run the test suite (260 tests)
npm run lint         # type-check core + web (strict TypeScript)
npm run build:core   # build the engine (what start.command runs as part of `gui`)
npm run gui          # build core + start the GUI at localhost:3000
npm run watch        # run the always-on watcher daemon
```

Connecting it to an AI client (MCP) is covered in [Use it inside Claude or other AI tools](#use-it-inside-claude-or-other-ai-tools). Architecture deep-dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Contributing

Contributions are very welcome — the easiest is adding a company to the registry (a one-line change). See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, conventions, and step-by-step recipes (add a company, add an ATS adapter, add a tool, add a migration).

---

## License

[MIT](LICENSE) © Mohak Garg.
