import * as os from 'node:os';
import * as path from 'node:path';

export type HostName = 'claude' | 'cursor' | 'windsurf';

export type HostInfo = {
  displayName: string;
  configPath(): string;
};

function claudePath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function cursorPath(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}

function windsurfPath(): string {
  return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

export const HOSTS: Record<HostName, HostInfo> = {
  claude: { displayName: 'Claude Desktop', configPath: claudePath },
  cursor: { displayName: 'Cursor', configPath: cursorPath },
  windsurf: { displayName: 'Windsurf', configPath: windsurfPath }
};

export function listHostNames(): HostName[] {
  return Object.keys(HOSTS) as HostName[];
}

export function hostConfigPath(host: HostName): string {
  return HOSTS[host].configPath();
}

export function isKnownHost(name: string): name is HostName {
  return name === 'claude' || name === 'cursor' || name === 'windsurf';
}
