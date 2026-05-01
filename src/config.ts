import * as os from 'node:os';
import * as path from 'node:path';

export const paths = {
  stateDir(): string {
    return process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
  },
  dbFile(): string {
    return path.join(paths.stateDir(), 'state.db');
  },
  registryDir(): string {
    return path.resolve(import.meta.dirname, '..', 'registry');
  }
};
