/**
 * Maximum characters of a job description to include in sampling prompts.
 * Different services use different windows — picker only needs the gist;
 * tailorer + cover letter benefit from the full description.
 */
export const JD_CHARS_PICKER = 4000;
export const JD_CHARS_TAILOR = 6000;
export const JD_CHARS_LETTER = 6000;

/** Maximum characters of a resume's raw text to include in sampling prompts. */
export const RESUME_RAW_CHARS = 8000;
