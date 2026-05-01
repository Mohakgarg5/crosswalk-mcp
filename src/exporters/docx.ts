import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';

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

function blockToParagraph(b: Block): Paragraph {
  if (b.kind === 'heading') {
    return new Paragraph({
      heading: HEADING_MAP[b.level],
      children: [new TextRun({ text: b.text })]
    });
  }
  if (b.kind === 'bullet') {
    return new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: b.text })]
    });
  }
  return new Paragraph({ children: [new TextRun({ text: b.text })] });
}

export async function mdToDocxBuffer(md: string): Promise<Buffer> {
  const blocks = parseBlocks(md);
  const paragraphs = blocks.length > 0 ? blocks.map(blockToParagraph) : [new Paragraph({})];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}
