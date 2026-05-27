import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const paths = {
  stateDir(): string {
    return process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
  },
  dbFile(): string {
    return path.join(paths.stateDir(), 'state.db');
  },
  registryDir(): string {
    // Env override first (useful when bundled/packaged). Otherwise resolve
    // relative to this module via import.meta.url, which bundlers preserve
    // reliably — unlike import.meta.dirname, which some loaders leave undefined.
    if (process.env.CROSSWALK_REGISTRY_DIR) return process.env.CROSSWALK_REGISTRY_DIR;
    return fileURLToPath(new URL('../registry', import.meta.url));
  }
};
