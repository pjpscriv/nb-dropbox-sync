import * as path from 'path';
import * as fs from 'fs';
import { diffLines } from 'diff';
import { Color as c } from './colors';

export const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.fnt',
]);

export const isBinary = (f: string) => BINARY_EXTENSIONS.has(path.extname(f).toLowerCase());

export const readNormalized = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

export function filesAreTheSame(a: string, b: string): boolean {
  if (isBinary(a)) {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  }
  return readNormalized(a) === readNormalized(b);
}

// Prints a line-numbered diff, followed by a "^ relPath" footer so the file name is visible at the end too.
export function showDiff(oldFile: string, newFile: string, relPath: string, color: boolean): void {
  const oldContent = readNormalized(oldFile);
  const newContent = readNormalized(newFile);
  let oldLineNum = 1;
  let newLineNum = 1;
  for (const part of diffLines(oldContent, newContent)) {
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    if (!part.added && !part.removed) {
      oldLineNum += lines.length;
      newLineNum += lines.length;
      continue;
    }
    const sign = part.added ? '+' : '-';
    const lineColor = part.added ? c.GREEN : c.RED;
    for (const line of lines) {
      const lineNum = part.added ? newLineNum++ : oldLineNum++;
      const gutter = `${String(lineNum).padStart(5)} `;
      const text = `${sign}${line}`;
      process.stdout.write(color
        ? `\x1b[2m${lineColor}${gutter}${c.RESET}${lineColor}${text}${c.RESET}\n`
        : `${gutter}${text}\n`);
    }
  }
  console.log(color ? `${c.CYAN}^ ${relPath}${c.RESET}` : `^ ${relPath}`);
}
