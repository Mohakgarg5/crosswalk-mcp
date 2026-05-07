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

  /** Release any resources held by this browser instance. */
  close(): Promise<void>;
}

export class BrowserNotInstalledError extends Error {
  constructor(message?: string) {
    super(message ?? 'browser runtime (playwright + chromium) is not installed; run `crosswalk-mcp install-browser` to enable preview_application');
    this.name = 'BrowserNotInstalledError';
  }
}
