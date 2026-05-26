import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs, listJobs, getJob } from '../src/store/job.ts';

describe('store/job', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    // Pin the clock so recency assertions don't drift as wall-clock advances
    // past the hardcoded fixture dates (see ARCHITECTURE.md known limitations).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('upserts jobs and filters by recency', () => {
    upsertJobs(db, [{
      id: 'g-1', companyId: 'stripe', title: 'PM, Payments', dept: 'Product',
      location: 'SF', locationType: 'hybrid', url: 'https://x', descriptionMd: 'desc',
      postedAt: '2026-04-25T00:00:00Z', raw: {}
    }]);
    expect(listJobs(db, { sinceDays: 30 })).toHaveLength(1);
    expect(listJobs(db, { sinceDays: 1 })).toHaveLength(0);
  });

  it('looks up a job by id', () => {
    upsertJobs(db, [{
      id: 'g-1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://x', raw: {}
    }]);
    expect(getJob(db, 'g-1')?.title).toBe('PM, Payments');
    expect(getJob(db, 'missing')).toBeNull();
  });
});
