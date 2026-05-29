export type FormField = {
  name: string;
  type: string;
  label?: string;
  required: boolean;
  value?: string;
  /** For <select>: the option labels. For radio/checkbox: this element's value. */
  options?: string[];
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
   * Open the URL in a headless browser, attempt to fill each field by its kind using common ATS selectors, optionally click the submit button, and return a screenshot. Unmatched fields go to `skipped`. With `maxSteps > 1` it navigates a multi-page wizard (fill → click Next → repeat → Submit). Throws if the browser runtime is not installed.
   */
  fillForm(url: string, fields: FillField[], opts?: { ats?: string; clickSubmit?: boolean; maxSteps?: number }): Promise<BrowserFillResult>;

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
  | { kind: 'cover_letter_text'; value: string }
  | { kind: 'cover_letter_file'; path: string }
  | { kind: 'resume_file'; path: string }
  // `label` is the visible field label text (when known) — used as a fallback
  // identifier for widgets whose name/id is missing or doesn't match the
  // expected selector. Particularly helpful for react-select dropdowns where
  // the input has no name and the only stable identifier is its <label>.
  | { kind: 'text_by_name'; name: string; value: string; label?: string }
  | { kind: 'select_by_name'; name: string; value: string; label?: string }   // choose the option matching value
  | { kind: 'radio_by_name'; name: string; value: string; label?: string }    // select the radio in group `name` with this value
  | { kind: 'checkbox_by_name'; name: string; checked: boolean; label?: string };

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
  /** Whether a submit button was clicked. False when clickSubmit was not requested or no submit button matched. */
  submitClicked?: boolean;
  /** URL after submit click (post-navigation). Only set when submitClicked is true. */
  postSubmitUrl?: string;
  /** Page title after submit click (post-navigation). Only set when submitClicked is true. */
  postSubmitTitle?: string;
  /** How many wizard pages were advanced past (Next/Continue clicks) before submit. */
  stepsAdvanced?: number;
};
