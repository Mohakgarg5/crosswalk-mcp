export type NormalizedJob = {
  externalId: string;        // unique within (ats, orgSlug)
  title: string;
  dept?: string;
  location?: string;
  locationType?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  descriptionMd?: string;
  url: string;
  postedAt?: string;
  raw: Record<string, unknown>;
};

export type ATSAdapter = {
  name: string;
  listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]>;
};
