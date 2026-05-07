import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getApplication } from '../store/application.ts';
import { getProfile } from '../store/profile.ts';
import type { Browser, FillField } from '../services/browser/types.ts';
import { writeResumeDocxToTemp, writeCoverLetterDocxToTemp } from '../services/browser/resumeFile.ts';

export const applyApplicationInput = z.object({
  applicationId: z.string()
});

export type ApplyApplicationResult = {
  applicationId: string;
  deepLink: string;
  resolvedUrl: string;
  title: string;
  /** PNG screenshot of the filled (but not submitted) form, base64-encoded. */
  screenshotPngBase64: string;
  /** Field kinds the browser successfully filled. */
  filled: string[];
  /** Field kinds the browser couldn't find a selector for. */
  skipped: string[];
  /** Always false for v1.0 — the user clicks Submit themselves. */
  submitted: false;
  /** Path to the tailored resume DOCX written to /tmp. */
  resumeDocxPath: string;
  /** Path to the cover-letter DOCX. Undefined when the application has no cover letter. */
  coverLetterDocxPath?: string;
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function applyApplication(
  input: z.infer<typeof applyApplicationInput>,
  ctx: { db: Db; browser: Browser }
): Promise<ApplyApplicationResult> {
  const app = getApplication(ctx.db, input.applicationId);
  if (!app) throw new Error(`unknown application: ${input.applicationId}`);

  const profile = getProfile(ctx.db) ?? {};
  const fields: FillField[] = [];

  const email = asString(profile.email);
  if (email) fields.push({ kind: 'email', value: email });

  const firstName = asString(profile.first_name);
  if (firstName) fields.push({ kind: 'first_name', value: firstName });

  const lastName = asString(profile.last_name);
  if (lastName) fields.push({ kind: 'last_name', value: lastName });

  const fullName = asString(profile.name) ?? asString(profile.full_name);
  if (fullName && !firstName && !lastName) {
    fields.push({ kind: 'full_name', value: fullName });
  }

  const phone = asString(profile.phone);
  if (phone) fields.push({ kind: 'phone', value: phone });

  const linkedin = asString(profile.linkedin);
  if (linkedin) fields.push({ kind: 'linkedin', value: linkedin });

  const website = asString(profile.website);
  if (website) fields.push({ kind: 'website', value: website });

  const resumeDocxPath = await writeResumeDocxToTemp(app.tailoredResumeMd, app.id);
  fields.push({ kind: 'resume_file', path: resumeDocxPath });

  let coverLetterDocxPath: string | undefined;
  if (app.coverLetterMd && app.coverLetterMd.length > 0) {
    coverLetterDocxPath = await writeCoverLetterDocxToTemp(app.coverLetterMd, app.id);
    fields.push({ kind: 'cover_letter_file', path: coverLetterDocxPath });
    fields.push({ kind: 'cover_letter_text', value: app.coverLetterMd });
  }

  const result = await ctx.browser.fillForm(app.deepLink, fields);

  return {
    applicationId: app.id,
    deepLink: app.deepLink,
    resolvedUrl: result.resolvedUrl,
    title: result.title,
    screenshotPngBase64: result.screenshotPng.toString('base64'),
    filled: result.filled,
    skipped: result.skipped,
    submitted: false,
    resumeDocxPath,
    coverLetterDocxPath
  };
}
