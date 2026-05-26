import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getApplication } from '../store/application.ts';
import type { Browser, FormField } from '../services/browser/types.ts';

export const previewApplicationInput = z.object({
  applicationId: z.string()
});

export type PreviewApplicationResult = {
  applicationId: string;
  deepLink: string;
  resolvedUrl: string;
  title: string;
  /** PNG screenshot of the rendered page, base64-encoded. */
  screenshotPngBase64: string;
  /** Best-effort list of visible form fields. */
  formFields: FormField[];
};

export async function previewApplication(
  input: z.infer<typeof previewApplicationInput>,
  ctx: { db: Db; browser: Browser }
): Promise<PreviewApplicationResult> {
  const app = getApplication(ctx.db, input.applicationId);
  if (!app) throw new Error(`unknown application: ${input.applicationId}`);

  const preview = await ctx.browser.preview(app.deepLink);

  return {
    applicationId: app.id,
    deepLink: app.deepLink,
    resolvedUrl: preview.resolvedUrl,
    title: preview.title,
    screenshotPngBase64: preview.screenshotPng.toString('base64'),
    formFields: preview.formFields
  };
}
