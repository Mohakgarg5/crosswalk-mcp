import path from 'node:path';

/** launchd label for the Crosswalk watcher login agent. */
export const LAUNCH_AGENT_LABEL = 'com.crosswalk.watch';

export type LaunchAgentSpec = {
  /** Absolute path to the node binary. */
  nodePath: string;
  /** Absolute path to scripts/watch.mjs. */
  scriptPath: string;
  /** Working directory (the repo root) so relative requires resolve. */
  workingDir: string;
  /** Crosswalk data dir (~/.crosswalk) — passed as CROSSWALK_HOME. */
  home: string;
  /** Minutes between watch passes. */
  intervalMin: number;
  /** Show the browser while applying (for logged-in ATSes). */
  headed?: boolean;
  /** Persistent Chrome profile dir (keeps you logged into Workday etc.). */
  browserProfile?: string;
  /** Where launchd writes the daemon's stdout/stderr. Defaults under `home`. */
  logPath?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Absolute path of the installed LaunchAgent plist for a given OS home dir. */
export function launchAgentPlistPath(osHome: string): string {
  return path.join(osHome, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

/**
 * Build the launchd plist that runs the watcher on login and every
 * `intervalMin`. The daemon survives reboots and runs whether or not the GUI
 * is open — the "always-on" runner. Env mirrors the manual `npm run watch`
 * incantation so logged-in ATS profiles work.
 */
export function buildLaunchAgentPlist(spec: LaunchAgentSpec): string {
  const interval = Math.max(60, Math.round(spec.intervalMin * 60));
  const logPath = spec.logPath ?? path.join(spec.home, 'watch.log');

  const env: Array<[string, string]> = [['CROSSWALK_HOME', spec.home]];
  if (spec.browserProfile) env.push(['CROSSWALK_BROWSER_PROFILE', spec.browserProfile]);
  if (spec.headed) env.push(['CROSSWALK_BROWSER_HEADED', '1']);

  const envXml = env
    .map(([k, v]) => `      <key>${esc(k)}</key>\n      <string>${esc(v)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(spec.nodePath)}</string>
    <string>${esc(spec.scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${esc(spec.workingDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>StandardOutPath</key>
  <string>${esc(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(logPath)}</string>
</dict>
</plist>
`;
}
