import * as path from 'path';
import * as fs from 'fs';

// Top-level items that are never deleted when cleaning a destination directory
export const CLEAN_EXCLUDED = new Set([
  '.git',
  '.gitattributes',
  '.gitignore',
  'README.md',
  'bot-deploy.ps1',

  'node_modules',
  'package.json',
  'package-lock.json',
  'nb-sync.config.json',
  'nb-sync.mappings.json',
  'sync.log',
]);

export function getAllFiles(dir: string): string[] {
  let results: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      results = results.concat(getAllFiles(filePath));
    } else {
      results.push(filePath);
    }
  }
  return results;
}
