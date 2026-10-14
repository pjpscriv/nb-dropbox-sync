import * as path from 'path';
import * as fs from 'fs';

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
