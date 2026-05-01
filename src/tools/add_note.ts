import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getApplication, addEventForApplication } from '../store/application.ts';

export const addNoteInput = z.object({
  applicationId: z.string(),
  text: z.string().min(1)
});

export async function addNote(
  input: z.infer<typeof addNoteInput>,
  ctx: { db: Db }
): Promise<{ eventId: string }> {
  const parsed = addNoteInput.parse(input);
  const app = getApplication(ctx.db, parsed.applicationId);
  if (!app) throw new Error(`unknown application: ${parsed.applicationId}`);

  const event = addEventForApplication(
    ctx.db, parsed.applicationId, 'note', { text: parsed.text }
  );
  return { eventId: event.id };
}
