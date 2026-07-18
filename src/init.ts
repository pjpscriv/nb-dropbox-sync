import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ProjectConfig, EnvConfig } from './shared/types';
import { DEFAULT_CONFIG_FILENAME, DEFAULT_MAPPINGS_FILENAME, DEFAULT_SRC_DIRNAME } from './shared/config';
import { Color as c } from './shared/colors';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

async function askYesNo(rl: readline.Interface, question: string, defaultNo: boolean = true): Promise<boolean> {
  const suffix = defaultNo ? '[y/N]' : '[Y/n]';
  const answer = (await ask(rl, `${question} ${suffix} `)).toLowerCase();
  if (!answer) return !defaultNo;
  return answer === 'y' || answer === 'yes';
}

async function askEnv(rl: readline.Interface, qualifier: string = ''): Promise<EnvConfig> {
  const label = qualifier ? `${qualifier} ` : '';
  const dropbox = await ask(rl, `Where is the ${label}Dropbox folder? `);
  let publishLink: string;
  while (true) {
    publishLink = await ask(rl,
      `What is the ${label}publish link? ` +
      `(e.g. https://<NATION_SLUG>.nationbuilder.com/admin/sites/<SITE_ID>/themes/<THEME_ID>/attachments) `
    );
    if (!publishLink || publishLink.replace(/\/+$/, '').endsWith('/attachments')) break;
    console.log(`${c.YELLOW}The publish link should end in /attachments — please try again.${c.RESET}`);
  }

  const env: EnvConfig = { dropbox };
  if (publishLink) env.publish_link = publishLink;
  return env;
}

function initMappings(mappingsPath: string): void {
  if (fs.existsSync(mappingsPath)) {
    console.log(`${c.YELLOW}${path.basename(mappingsPath)} already exists — leaving it as-is.${c.RESET}`);
    return;
  }

  // Ships alongside dist/ at the package root — see package.json's "files"
  const examplePath = path.join(__dirname, '..', 'nb-sync.mappings.example.json');
  fs.copyFileSync(examplePath, mappingsPath);
  console.log(`${c.GREEN}Created ${path.basename(mappingsPath)} from the example template.${c.RESET}`);
  console.log(`  Review and adjust its rules to match this theme's file naming conventions.`);
}

async function initConfig(configPath: string, rl: readline.Interface): Promise<void> {
  if (fs.existsSync(configPath)) {
    console.log(`${c.YELLOW}${path.basename(configPath)} already exists — leaving it as-is.${c.RESET}`);
    return;
  }

  console.log(`\n${c.CYAN}Setting up ${path.basename(configPath)}...${c.RESET}\n`);

  const prod = await askEnv(rl);

  let src: string | undefined;
  if (await askYesNo(rl, `Do you want to override the src dir? (current default: ./${DEFAULT_SRC_DIRNAME})`)) {
    src = await ask(rl, 'New src dir: ');
  }

  const defaultDist = path.join(path.dirname(process.cwd()), `${path.basename(process.cwd())}-dist`);
  let dist = defaultDist;
  if (await askYesNo(rl, `Do you want to override the dist dir? (default: ${defaultDist})`)) {
    dist = await ask(rl, 'New dist dir: ');
  }

  let test: EnvConfig | undefined;
  if (await askYesNo(rl, 'Do you have a test environment?')) {
    test = await askEnv(rl, 'test');
  }

  const config: ProjectConfig = {
    dist,
    prod,
    ...(src ? { src } : {}),
    ...(test ? { test } : {}),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`\n${c.GREEN}Created ${path.basename(configPath)}.${c.RESET}`);
}

async function main(): Promise<void> {
  const configPath = path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);
  const mappingsPath = path.resolve(process.cwd(), DEFAULT_MAPPINGS_FILENAME);

  initMappings(mappingsPath);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await initConfig(configPath, rl);
  } finally {
    rl.close();
  }

  console.log('\nDone.\n');
}

main();
