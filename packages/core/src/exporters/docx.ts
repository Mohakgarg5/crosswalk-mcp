import { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } from 'docx';

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let buf: string[] = [];

  const flushParagraph = () => {
    const text = buf.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    buf = [];
  };

  for (const line of lines) {
    const trim = line.trim();
    if (trim === '') {
      flushParagraph();
      continue;
    }
    if (/^# /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 1, text: trim.replace(/^# /, '') });
      continue;
    }
    if (/^## /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 2, text: trim.replace(/^## /, '') });
      continue;
    }
    if (/^### /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 3, text: trim.replace(/^### /, '') });
      continue;
    }
    if (/^[-*•] /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: trim.replace(/^[-*•] /, '') });
      continue;
    }
    buf.push(trim);
  }
  flushParagraph();
  return blocks;
}

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3
} as const;

// Parse inline markdown (**bold**, *italic*, __bold__, _italic_, [text](url))
// into TextRuns so the rendered DOCX has real formatting instead of literal
// asterisks/underscores — ATS systems read the raw text and choke on the markers.
export function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, m.index) }));
    }
    if (m[1] !== undefined) {
      runs.push(new TextRun({ text: m[1], bold: true }));
    } else if (m[2] !== undefined) {
      runs.push(new TextRun({ text: m[2], bold: true }));
    } else if (m[3] !== undefined) {
      runs.push(new TextRun({ text: m[3], italics: true }));
    } else if (m[4] !== undefined) {
      runs.push(new TextRun({ text: m[4], italics: true }));
    } else if (m[5] !== undefined) {
      const linkText = m[5];
      const linkUrl = m[6] ?? '';
      // ATS scrapers pull URLs out of plain text. Render link text plus the URL
      // in parens so the URL survives (unless they're identical).
      runs.push(new TextRun({ text: linkText === linkUrl ? linkUrl : `${linkText} (${linkUrl})` }));
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }));
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text }));
  }
  return runs;
}

function blockToParagraph(b: Block): Paragraph {
  if (b.kind === 'heading') {
    return new Paragraph({
      heading: HEADING_MAP[b.level],
      children: parseInline(b.text)
    });
  }
  if (b.kind === 'bullet') {
    return new Paragraph({
      bullet: { level: 0 },
      alignment: AlignmentType.JUSTIFIED,
      children: parseInline(b.text)
    });
  }
  // Justify body text so each full line spans the page width — left-ragged
  // resume lines were the complaint. Headings stay left-aligned.
  return new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: parseInline(b.text) });
}

/** Markdown → docx Paragraphs. Exported so tests can inspect alignment/styling. */
export function mdToParagraphs(md: string): Paragraph[] {
  const blocks = parseBlocks(md);
  return blocks.length > 0 ? blocks.map(blockToParagraph) : [new Paragraph({})];
}

export async function mdToDocxBuffer(md: string): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: mdToParagraphs(md) }] });
  return Packer.toBuffer(doc);
}
