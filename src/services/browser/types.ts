export type FormField = {
  name: string;
  type: string;
  label?: string;
  required: boolean;
  value?: string;
};

export type BrowserPreview = {
  /** PNG bytes of the rendered page (above the fold). */
  screenshotPng: Buffer;
  /** Final URL after redirects. */
  resolvedUrl: string;
  /** Document title. */
  title: string;
  /** Best-effort manifest of visible form fields. */
  formFields: FormField[];
};

export interface Browser {
  /**
   * Open the URL in a headless browser, return a screenshot + form fields.
   * Throws if the browser runtime (Playwright + Chromium) is not installed.
   */
  preview(url: string): Promise<BrowserPreview>;

  /**
   * Open the URL in a headless browser, attempt to fill each field by
   * its kind using common ATS selectors, and return a screenshot.
   * Does NOT submit the form. Unmatched fields go to `skipped`.
   * Throws if the browser runtime is not installed.
   */
  fillForm(url: string, fields: FillField[]): Promise<BrowserFillResult>;

  /** Release any resources held by this browser instance. */
  close(): Promise<void>;
}

export class BrowserNotInstalledError extends Error {
  constructor(message?: string) {
    super(message ?? 'browser runtime (playwright + chromium) is not installed; run `crosswalk-mcp install-browser` to enable preview_application');
    this.name = 'BrowserNotInstalledError';
  }
}

/** A single field the caller wants filled, identified by purpose. */
export type FillField =
  | { kind: 'email'; value: string }
  | { kind: 'first_name'; value: string }
  | { kind: 'last_name'; value: string }
  | { kind: 'full_name'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'linkedin'; value: string }
  | { kind: 'website'; value: string }
  | { kind: 'resume_file'; path: string };

export type BrowserFillResult = {
  /** Final URL after navigation/redirects. */
  resolvedUrl: string;
  /** Document title. */
  title: string;
  /** PNG bytes of the rendered page after fill (above the fold). */
  screenshotPng: Buffer;
  /** Field kinds successfully filled. */
  filled: string[];
  /** Field kinds we tried but couldn't find a selector for. */
  skipped: string[];
};
