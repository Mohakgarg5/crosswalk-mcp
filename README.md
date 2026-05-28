<div align="center">

# Crosswalk 🧭

**A job-search robot that runs on *your* computer. It finds jobs that match you, writes a tailored résumé + cover letter for each, fills in the application, and can even submit it — hands-off.**

Everything stays on your machine. Nothing is uploaded to anyone.

</div>

---

## 🧒 What is this? (in plain words)

You tell it *"I'm looking for **Product Manager** jobs."* Then it:

1. 🔎 Finds Product Manager jobs from thousands of companies.
2. ✍️ Rewrites your résumé to fit each job (using only true facts from your real résumé).
3. 📝 Writes a cover letter and answers the application questions.
4. ✅ Fills in the form — dropdowns, checkboxes and all — and (if you let it) clicks **Submit**.
5. 👀 Keeps watching, so the moment a new matching job appears, it grabs it.

It runs on **your own laptop**. Your résumé and data live in one folder on your computer.

---

# 🚀 Set it up in 3 easy steps

> You only do these once. Total time: about 5 minutes.

## Step 1 — Install Node.js (the thing that runs the app)

1. Go to **[nodejs.org](https://nodejs.org)**
2. Click the **big green button that says "LTS"** (it downloads a file).
3. Open that file and click **Next → Next → Install** like any normal app.

✅ Done. (You only ever do this once, on your computer.)

## Step 2 — Download Crosswalk

1. Go to **[the Crosswalk page on GitHub](https://github.com/Mohakgarg5/crosswalk-mcp)**
2. Click the green **`<> Code`** button → **Download ZIP**.
3. Find the downloaded ZIP (usually in your **Downloads** folder) and **double-click it to unzip**.
4. You now have a folder called **`crosswalk-mcp-main`**. Move it somewhere easy, like your **Desktop**.

## Step 3 — Start it (just double-click!)

Open the `crosswalk-mcp-main` folder and:

- **On a Mac:** right-click **`start.command`** → click **Open** → click **Open** again.
  *(You only have to right-click the very first time. After that you can just double-click it.)*
- **On Windows:** double-click **`start.cmd`**.
  *(If a blue box says "Windows protected your PC", click **More info → Run anyway**.)*

A window will pop up. The first time it spends a minute getting ready, then your web browser **opens to the app automatically**. 🎉

> 👉 If the browser shows an error at first, wait a few seconds and **refresh the page** — it's just warming up.
>
> To **stop** the app, close that window. To start again, double-click `start.command` / `start.cmd` again.

---

## 🔑 One more thing: add your AI key (so it can write résumés)

The app needs an "AI brain" to write your résumés. Here's how to get a key:

1. Make a free account at **[console.anthropic.com](https://console.anthropic.com)**.
2. Click **API Keys → Create Key**, and **copy** the long code (it starts with `sk-ant-`).
3. In the Crosswalk app, click **Settings** (left menu), paste the key in the **API key** box, and click **Save**.

> 💡 It costs a few cents per résumé (you pay Anthropic directly). Finding and tracking jobs works **without** a key — you only need it for writing résumés and answering questions.

---

## 📖 How to use it

Use the menu on the left, in this order:

1. **Profile** — write a few sentences about yourself ("PM with 3 years at Acme, want NYC or remote, need visa sponsorship"). Click Save.
2. **Résumés** — paste your résumé text, give it a name, click Add.
3. **Settings → Answer bank** — click **"Load common defaults"** (this fills in safe answers for the standard questions like work authorization and the EEO/diversity questions). Add any of your own, e.g. `salary → $130,000`.
4. **Jobs** — type a role (like `product manager`), click **Search jobs**. You'll get real jobs from lots of companies.
5. **Apply** — click **draft →** on a job to review it first, or **Auto-apply** at the top to do them all.
6. **Pipeline / Alerts / Inbox** — track everything, see new-match alerts, and route recruiter emails.

---

## 🤖 Make it apply automatically (hands-off)

1. In **Settings**: set **Submit policy = auto** and **Weekly cap = 0** (0 means unlimited).
2. On **Jobs**: search a role → click **"Save as watch"** and tick **auto-apply new matches**.
3. Keep it running even with the app closed — in the app's folder, in a terminal:
   ```
   npm run watch
   ```
   It checks for new matching jobs every 15 minutes and applies to them.

**For sites that make you log in (like Workday):** see the note inside **Settings → Autonomous apply**.

---

## 🧪 Try it safely first (recommended)

Before letting it submit for real:
1. **Settings → Submit policy = review** (it will fill the form but NOT click Submit).
2. Find one job → **draft →** → check the tailored résumé and answers look right.

Once you trust it, switch to **auto**.

> ⚠️ **A friendly warning:** submitting *thousands* of auto-written applications can hurt your chances and may break some sites' rules. Start with a few, check the quality, and turn up the volume only when you're happy.

---

## 🆘 Something not working?

| Problem | Fix |
|---|---|
| Double-clicking does nothing / "can't be opened" (Mac) | Right-click `start.command` → **Open** → **Open**. |
| "Windows protected your PC" | Click **More info → Run anyway**. |
| It says **Node.js is not installed** | Do **Step 1** above, then start again. |
| Browser page shows an error | Wait a few seconds and **refresh**. It's still warming up. |
| "No Anthropic API key set" | Add your key in **Settings** (see above). |

---

## 🔒 Your privacy

Everything lives in one folder on your computer (`~/.crosswalk`). Nothing is uploaded to us — there is no "us." The only things it talks to are the job websites (to find/apply) and Anthropic (to write résumés, using your key). To erase everything, delete the `~/.crosswalk` folder.

---

## 👩‍💻 For developers

npm-workspaces monorepo: `packages/core` (engine + MCP server, published as `crosswalk-mcp`), `apps/web` (the Next.js GUI), `scripts/watch.mjs` (always-on watcher).

```bash
npm install          # install everything
npm test             # run the test suite (260 tests)
npm run lint         # type-check core + web
npm run gui          # build the engine + start the GUI (what start.command runs)
npm run watch        # run the always-on watcher daemon
```

It's also an **MCP server** — use it inside Claude Desktop with `npx crosswalk-mcp install`. Deep docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 🤝 Contributing

Contributions are very welcome — the easiest is adding a company to the registry (a one-line change). See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, conventions, and step-by-step recipes (add a company, add an ATS adapter, add a tool, add a migration).

## License

[MIT](LICENSE) © Mohak Garg.
