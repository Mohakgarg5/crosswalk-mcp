import { describe, it, expect } from 'vitest';
import { buildLaunchAgentPlist, launchAgentPlistPath, LAUNCH_AGENT_LABEL } from '../src/service/launchAgent.ts';

describe('launch agent plist', () => {
  const base = {
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/me/crosswalk/scripts/watch.mjs',
    workingDir: '/Users/me/crosswalk',
    home: '/Users/me/.crosswalk',
    intervalMin: 15
  };

  it('is well-formed plist XML with the right label, command, interval and run-at-load', () => {
    const plist = buildLaunchAgentPlist(base);
    expect(plist.startsWith('<?xml')).toBe(true);
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/Users/me/crosswalk/scripts/watch.mjs</string>');
    // 15 min → 900 seconds
    expect(plist).toContain('<key>StartInterval</key>');
    expect(plist).toContain('<integer>900</integer>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
    // CROSSWALK_HOME is passed through so the daemon uses the same data dir.
    expect(plist).toContain('<key>CROSSWALK_HOME</key>');
    expect(plist).toContain('<string>/Users/me/.crosswalk</string>');
  });

  it('passes headed + browser-profile env when requested (for logged-in ATSes)', () => {
    const plist = buildLaunchAgentPlist({ ...base, headed: true, browserProfile: '/Users/me/.crosswalk/chrome' });
    expect(plist).toContain('<key>CROSSWALK_BROWSER_HEADED</key>');
    expect(plist).toContain('<key>CROSSWALK_BROWSER_PROFILE</key>');
    expect(plist).toContain('<string>/Users/me/.crosswalk/chrome</string>');
  });

  it('omits headed/profile env when not requested', () => {
    const plist = buildLaunchAgentPlist(base);
    expect(plist).not.toContain('CROSSWALK_BROWSER_HEADED');
    expect(plist).not.toContain('CROSSWALK_BROWSER_PROFILE');
  });

  it('escapes XML-special characters in paths', () => {
    const plist = buildLaunchAgentPlist({ ...base, workingDir: '/Users/me & co/app' });
    expect(plist).toContain('/Users/me &amp; co/app');
    expect(plist).not.toContain('/Users/me & co/app');
  });

  it('derives the plist path under ~/Library/LaunchAgents from the OS home', () => {
    expect(launchAgentPlistPath('/Users/me')).toBe('/Users/me/Library/LaunchAgents/com.crosswalk.watch.plist');
  });
});
