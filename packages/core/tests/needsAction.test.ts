import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { enqueueNeedsAction, listNeedsActions, listNotifications, createNotification } from '../src/store/notification.ts';

describe('needs-action queue', () => {
  it('enqueues a needs_action notification with reason + link and lists it', () => {
    const db = openDb(':memory:');
    enqueueNeedsAction(db, {
      applicationId: 'app-1', reason: 'account_wall',
      title: 'Form needs you', body: 'Workday wall', link: 'https://x/apply'
    });
    const queue = listNeedsActions(db);
    expect(queue.length).toBe(1);
    expect(queue[0].kind).toBe('needs_action');
    expect(queue[0].reason).toBe('account_wall');
    expect(queue[0].link).toBe('https://x/apply');
    expect(queue[0].refId).toBe('app-1');
  });

  it('listNeedsActions returns only needs_action items', () => {
    const db = openDb(':memory:');
    createNotification(db, { kind: 'new_match', title: 'a PM job' });
    enqueueNeedsAction(db, { applicationId: 'app-2', reason: 'submit_unconfirmed', title: 'Not confirmed', link: 'https://y' });
    expect(listNeedsActions(db).length).toBe(1);
    expect(listNotifications(db).length).toBe(2); // both still in the general feed
  });
});
