import type { Db } from '../store/db.ts';
import { listAllCompanies } from '../store/company.ts';
import { getProfile } from '../store/profile.ts';

export type ResourceDef = { uri: string; name: string; mimeType: string; description: string };

export function listResources(): ResourceDef[] {
  return [
    {
      uri: 'crosswalk://registry/companies',
      name: 'Open Job Graph',
      mimeType: 'application/json',
      description: 'Registry of companies and their ATS slugs.'
    },
    {
      uri: 'crosswalk://profile/me',
      name: 'Current profile',
      mimeType: 'application/json',
      description: 'The profile stored via setup_profile. Null if unset.'
    }
  ];
}

export async function readResource(uri: string, ctx: { db: Db }): Promise<{ text: string }> {
  if (uri === 'crosswalk://registry/companies') {
    return { text: JSON.stringify(listAllCompanies(ctx.db), null, 2) };
  }
  if (uri === 'crosswalk://profile/me') {
    return { text: JSON.stringify(getProfile(ctx.db)) };
  }
  throw new Error(`unknown resource: ${uri}`);
}
