#!/usr/bin/env node
/**
 * Hand a half-finished application back to YOU. Opens the job's form in a
 * VISIBLE browser, re-fills everything the AI fills (résumé, contact details,
 * answer bank, EEO, …), then LEAVES THE WINDOW OPEN so you do the last human
 * step the automation couldn't — the one required field, a captcha, an account
 * login — and click Submit yourself.
 *
 * Usage:
 *   node scripts/finish.mjs <applicationId>
 *   npm run finish -- <applicationId>
 *
 * Find the applicationId in the app (Pipeline → click the application) or in
 * the Needs-You list. The browser stays open until you close it (or Ctrl-C).
 *
 * Uses the persistent Chrome profile (CROSSWALK_BROWSER_PROFILE, default
 * ~/.crosswalk/chrome) so any logins you complete are remembered next time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openDb, seedRegistryIfEmpty, SamplingClient, ApiSamplingBackend,
  LazyPlaywrightBrowser, getConfig, getApplication, applyApplication,
  updateApplicationStatus, addEventForApplication
} from 'crosswalk-mcp/runtime';

const applicationId = process.argv[2];
if (!applicationId) {
  console.error('Usage: npm run finish -- <applicationId>\n(Find it in the app: Pipeline → open the application.)');
  process.exit(1);
}

const HOME = process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
const profileDir = process.env.CROSSWALK_BROWSER_PROFILE ?? path.join(HOME, 'chrome');

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try { return JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')).apiKey || undefined; }
  catch { return undefined; }
}

const db = openDb();
seedRegistryIfEmpty(db);

const app = getApplication(db, applicationId);
if (!app) {
  console.error(`No application with id ${applicationId}. Check the id in Pipeline.`);
  process.exit(1);
}

const key = apiKey();
const sampling = key
  ? new SamplingClient(new ApiSamplingBackend({ apiKey: key, model: getConfig(db).model }))
  : new SamplingClient({ createMessage: async () => { throw new Error('No Anthropic API key — set one in the GUI or ANTHROPIC_API_KEY.'); } });

// Headed + persistent profile: a real window you can see and finish in.
const browser = new LazyPlaywrightBrowser({ headed: true, profileDir });

console.log('Opening the application in a visible browser and filling it…');
try {
  const res = await applyApplication({ applicationId, submit: false }, { db, browser, sampling });
  console.log(`\nForm is filled and open on your screen: ${res.resolvedUrl}`);
  console.log(`  filled: ${res.filled.join(', ') || 'none'}`);
  if (res.skipped.length) console.log(`  skipped: ${res.skipped.join(', ')}`);
  if (res.validationErrors?.length) {
    console.log(`\n⚠️  These required field(s) still need YOUR answer: ${res.validationErrors.join(', ')}`);
  }
  console.log('\n👉 Review it, fill anything left, and click Submit yourself.');
  console.log('   I\'ll watch the window — when you submit, I mark it Submitted automatically.\n');
} catch (e) {
  console.error(`\nCouldn't fill the form: ${e.message}`);
  console.error('The window may still be open — finish it by hand, or re-run this command.');
}

// Watch the open window for YOUR submit and mark the application Submitted when
// it lands — so a hand-finished application shows up as Submitted, not Draft.
const CONFIRM_URL = /thank|confirm|success|submitted|application[-_]?complete|post[-_]?apply/i;
const CONFIRM_TEXT = /your application has been submitted|application (?:was )?submitted|thank you for applying|application received|we(?:'ve| have) received your application|successfully (?:submitted|applied)/i;
let marked = false;
const deadline = Date.now() + 45 * 60 * 1000; // watch for up to 45 min
while (!marked && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 3000));
  let pages;
  try { pages = browser.openPages(); } catch { pages = []; }
  for (const page of pages) {
    try {
      const url = typeof page.url === 'function' ? page.url() : '';
      let title = '';
      try { title = await page.title(); } catch { /* navigating */ }
      let bodyHit = false;
      try {
        bodyHit = await page.evaluate((re) => {
          const t = String((globalThis).document?.body?.innerText ?? '').slice(0, 5000);
          return new RegExp(re, 'i').test(t);
        }, CONFIRM_TEXT.source);
      } catch { /* context busy */ }
      if (CONFIRM_URL.test(url) || CONFIRM_URL.test(title) || bodyHit) {
        updateApplicationStatus(db, applicationId, 'submitted');
        addEventForApplication(db, applicationId, 'browser_submitted', { via: 'finish_handoff', url });
        console.log(`\n✅ Detected your submission — marked "${app.id}" as Submitted. You can close the window.`);
        marked = true;
        break;
      }
    } catch { /* page gone — keep watching the others */ }
  }
}
if (!marked) {
  console.log('\n(Stopped watching. If you submitted, set the status to Submitted in the app — Pipeline → the application.)');
}
// Keep the window open a moment, then leave it to the user.
await new Promise(r => setTimeout(r, 2000));
