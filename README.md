<div align="center">

# Crosswalk

**A job-search helper that runs on *your* computer, finds jobs that match you, writes a tailored résumé + cover letter for each one, and can even apply for you — hands-off.**

Local-first · your data stays on your machine · bring your own AI key.

[What is this?](#-what-is-this-explain-like-im-10) ·
[Setup](#-setup-step-by-step) ·
[How to use](#-how-to-use-the-app) ·
[Apply for me automatically](#-make-it-apply-for-you-automatically) ·
[Troubleshooting](#-troubleshooting) ·
[For developers](#-for-developers)

</div>

---

## 🧒 What is this? (explain like I'm 10)

Imagine a robot assistant that lives on your laptop. You tell it:

> "I'm looking for **Product Manager** jobs."

The robot then:
1. **Looks** all over the internet for Product Manager jobs (from thousands of companies).
2. **Rewrites your résumé** so it fits each job (using only true facts from your real résumé).
3. **Writes a cover letter** for each one.
4. **Fills in the application form** for you — and, if you let it, **clicks Submit**.
5. **Keeps watching** so that the moment a new matching job appears, it grabs it.
6. **Keeps a list** of everything it applied to, and sorts recruiter emails for you.

Everything happens **on your own computer**. Your résumé, your jobs, your history — they live in one file on your machine (`~/.crosswalk/state.db`). Nothing is uploaded to us. There is no "us." 🙂

There are **two ways** to use Crosswalk:
- **🖥️ The App** — a website that runs *on your own computer* (at `http://localhost:3000`). This guide is mostly about this.
- **💬 Inside your AI** — if you use **Claude Desktop**, Crosswalk can plug in so you just *chat* with it ("find me PM jobs and apply"). See [For developers](#-for-developers).

---

## 🧰 What you need first

You need **3 things** (the first two are required, the third is for auto-applying):

| # | Thing | Why | How to get it |
|---|-------|-----|---------------|
| 1 | **Node.js** (version 24+) | It runs the app | Go to [nodejs.org](https://nodejs.org), download the "LTS" version, install it like any app. To check it worked, open **Terminal** and type `node -v` — you should see a number like `v24.x`. |
| 2 | **An Anthropic API key** | This is the "brain" that writes your résumés | Make a free account at [console.anthropic.com](https://console.anthropic.com), go to **API Keys**, click **Create Key**, copy the long string that starts with `sk-ant-...`. (You pay Anthropic a tiny amount per résumé — usually pennies.) |
| 3 | *(optional)* **The browser tool** | Lets it fill + submit forms for you | One command, shown later. Skip it if you only want it to write résumés and you'll apply yourself. |

> **"What's a Terminal?"** It's an app where you type commands. On a Mac, press `Cmd+Space`, type "Terminal", press Enter. On Windows, use "PowerShell".

---

## 🚀 Setup (step by step)

Open your **Terminal** and copy-paste these one at a time:

**1. Get the code**
```bash
git clone https://github.com/Mohakgarg5/crosswalk-mcp.git
cd crosswalk-mcp
```

**2. Install it** (this downloads the parts it needs — takes a minute)
```bash
npm install
```

**3. Start the app**
```bash
npm run gui
```

You'll see a message that it's running. Now open your web browser and go to:

### 👉 http://localhost:3000

That's it — the app is running on your computer. 🎉

> To **stop** the app, go back to the Terminal and press `Ctrl + C`.

---

## 📖 How to use the app

When the app opens, use the menu on the left. Here's the order to do things:

### Step 1 — Add your API key (one time)
Click **Settings** → paste your `sk-ant-...` key into the **API key** box → click **Save settings**.
*(Without a key, it can still find and track jobs, but it can't write résumés.)*

### Step 2 — Set up your profile
Click **Profile** → write a few sentences about yourself, like:
> "Product manager with 3 years at Acme building AI tools. Want senior PM roles in New York or remote. Need visa sponsorship."

Click **Save profile**. The app turns this into a neat structured profile.

### Step 3 — Add your résumé
Click **Résumés** → give it a name (like "My PM résumé") → paste your résumé text → click **Add résumé**.

### Step 4 — Find jobs (by role, from everywhere)
Click **Jobs**. Make sure the toggle says **"Across the web (role-based)"** (this searches *everywhere*, not a fixed company list). Type your role (e.g. `product manager`) and click **Search jobs**. You'll get a list of real jobs from lots of companies.

### Step 5 — Apply
For any job you can:
- Click **draft →** to make a tailored application you can review (résumé + cover letter), then download or apply, **or**
- Click **Auto-fill / Auto-apply (N)** at the top of the results to do it for *all* the jobs at once.

### Step 6 — Track everything
- **Pipeline** shows every application and its status (draft, submitted, interviewing, offer…).
- **Alerts** shows new job matches and recruiter emails.
- **Inbox** — paste a recruiter email and it links it to the right application.

---

## 🤖 Make it apply for you automatically

This is the "hands-off" part. Three pieces:

### 1. Save a "watch"
On the **Jobs** page, search a role, then click **"Save as watch"**. Tick **"auto-apply new matches"** if you want it to apply on its own. A *watch* keeps looking for that role.

### 2. Choose how bold it is (Settings)
- **Submit policy = review** → it fills applications but leaves the final "Submit" click to you (safe — recommended at first).
- **Submit policy = auto** → it submits for you.
- **Weekly cap** → the most applications per week (a safety limit; raise it if you want more).

### 3. Keep it running, even with the app closed
Run this in a Terminal and leave it open — it checks for new matching jobs every 15 minutes and applies to them:
```bash
npm run watch
```
Want it to run once (for a scheduled task / cron)?
```bash
CROSSWALK_WATCH_ONCE=1 npm run watch
```

---

## 🔐 Applying to sites that make you log in (Workday, etc.)

Some company sites (especially **Workday**) make you sign in and have **multi-page** application forms. To handle those:

**1. Install the browser tool (one time):**
```bash
npx crosswalk-mcp install-browser
```

**2. In Settings**, set **"Multi-step wizard depth"** to about `8` (so it can click through multi-page forms).

**3. Start the app with a browser that remembers your logins:**
```bash
CROSSWALK_BROWSER_PROFILE=~/.crosswalk/chrome CROSSWALK_BROWSER_HEADED=1 npm run gui
```
A real browser window opens. **Log into your job-site accounts once** in that window. From then on, Crosswalk reuses those logins to apply for you.

---

## 🧪 A safe first test (do this before trusting it)

Before letting it submit real applications, watch it work once:

1. Settings → **Submit policy = review** (so it will NOT click Submit).
2. Start with the visible browser: `CROSSWALK_BROWSER_PROFILE=~/.crosswalk/chrome CROSSWALK_BROWSER_HEADED=1 npm run gui`
3. Find one job → open the application → click **"Auto-fill (no submit)"**.
4. **Watch the browser window** fill the form. Check it looks right. *You* click Submit (or not).

Once you trust it on a few forms, flip **Submit policy = auto** for hands-off applying.

> ⚠️ **Be thoughtful.** Auto-submitting many applications with auto-written answers can hurt your chances and may break a site's rules. Start small, review the results, and raise the volume only when you're happy with the quality.

---

## 💾 Where is my data? (privacy)

- Everything lives in **one folder on your computer**: `~/.crosswalk/`
- Your résumé, jobs, applications, and settings are in `~/.crosswalk/state.db`. Your API key is in `~/.crosswalk/config.json`.
- Nothing is sent anywhere except: the job sites (to read/apply), and Anthropic (to write résumés, using *your* key).
- To wipe everything: delete the `~/.crosswalk` folder.

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: node` | Node.js isn't installed — see [What you need first](#-what-you-need-first). |
| `command not found: npm` | Same — npm comes with Node.js. Reinstall Node.js. |
| The page won't open at localhost:3000 | Make sure the Terminal still shows the app running. If port 3000 is busy, run `PORT=3001 npm run gui` and open `localhost:3001`. |
| "No Anthropic API key set" | Go to **Settings** and paste your `sk-ant-...` key. |
| Auto-apply says "browser not installed" | Run `npx crosswalk-mcp install-browser`. |
| It can't apply to a Workday job | See [Applying to sites that make you log in](#-applying-to-sites-that-make-you-log-in-workday-etc). |

---

## ☁️ Can I put it on a website (deploy it)?

**Short answer: no, and that's on purpose.** Crosswalk is **local-first** — it needs *your* computer's files, *your* logged-in browser, and *your* AI key to work. A normal cloud host can't drive your browser or use your logins, so deploying the app to the cloud would break the very thing that makes it useful. Run it on your own machine with `npm run gui`. (The code is on GitHub so you — or anyone — can run it locally.)

---

## 👩‍💻 For developers

This is an **npm workspaces** monorepo:
- `packages/core` — the engine (published as the `crosswalk-mcp` MCP server). All business logic, 10 ATS adapters, the role-aggregator, auto-apply, watcher.
- `apps/web` — the Next.js GUI (this guide's "App").
- `scripts/watch.mjs` — the always-on watcher daemon.

```bash
npm test                 # run the test suite (248 tests)
npm run lint             # type-check core + web
npm run build:core       # build the engine (emits dist/ + crosswalk-mcp/runtime)
npm run gui              # build core + start the GUI
npm run watch            # run the always-on watcher
```

**Use it inside Claude Desktop (MCP):** Crosswalk is also a Model Context Protocol server — install it into your AI client and chat to it, using *your* AI's model (zero extra keys):
```bash
npx crosswalk-mcp install
```

Deep technical docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Design specs and implementation plans: [`docs/superpowers/`](docs/superpowers/).

---

## License

[MIT](LICENSE) © Mohak Garg. The company → ATS registry (the "Open Job Graph") is MIT-licensed too — PRs welcome.
