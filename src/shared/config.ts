import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, MappingRule, EnvConfig, Env, GitUser } from './types';

export const DEFAULT_CONFIG_FILENAME = 'nb-sync.config.json';
export const DEFAULT_MAPPINGS_FILENAME = 'nb-sync.mappings.json';
export const DEFAULT_SRC_DIRNAME = 'src';
export const DEFAULT_SITE_DIRNAME = 'site';
export const DEFAULT_GIT_USER: GitUser = { name: 'NationBuilder Dropbox Sync' };


// True if child is the same as, or nested inside, parent
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}


export class Config {
  public readonly configPath: string;
  public readonly mappingPath: string;

  private readonly data: ProjectConfig;
  private readonly mappings: MappingRule[];

  constructor(configPathOverride?: string, mappingsPathOverride?: string) {
    this.configPath = path.resolve(process.cwd(), configPathOverride ?? DEFAULT_CONFIG_FILENAME);
    this.mappingPath = path.resolve(process.cwd(), mappingsPathOverride ?? DEFAULT_MAPPINGS_FILENAME);

    // Read config file
    if (!fs.existsSync(this.configPath)) {
      console.error(`Error: config file not found. Expected it at ${this.configPath}`);
      console.error(`Copy nb-sync.config.example.json to ${DEFAULT_CONFIG_FILENAME} and fill in your paths.`);
      process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      console.error(`Error: ${this.configPath} must be a JSON object.`);
      process.exit(1);
    }

    for (const key of ['dist', 'prod'] as const) {
      if (!data[key]) {
        console.error(`Error: ${this.configPath} is missing required field "${key}".`);
        process.exit(1);
      }
    }

    if (!data.prod.dropbox) {
      console.error(`Error: ${this.configPath}'s "prod" entry is missing "dropbox".`);
      process.exit(1);
    }

    // Read mappings file
    if (!fs.existsSync(this.mappingPath)) {
      console.error(`Error: mappings file not found. Expected it at ${this.mappingPath}`);
      process.exit(1);
    }

    const mappings = JSON.parse(fs.readFileSync(this.mappingPath, 'utf8'));

    this.data = data as ProjectConfig;
    this.mappings = mappings;
  }

  public getProject(): ProjectConfig {
    return this.data;
  }

  public getEnv(env: Env): EnvConfig {
    const envConfig = this.data[env];

    if (!envConfig) {
      console.error(`Error: no "${env}" entry found in ${this.configPath}.`);
      if (env === 'test') {
        console.error('Add a "test": { "dropbox": "...", "publish_link": "..." } entry, or omit --env=test.');
      }
      process.exit(1);
    }

    if (!fs.existsSync(envConfig.dropbox)) {
      console.error(`Error: dropbox path does not exist: ${envConfig.dropbox}`);
      process.exit(1);
    }

    this.assertDropboxFoldersSeparate(env, envConfig);

    return envConfig;
  }

  private assertDropboxFoldersSeparate(env: Env, envConfig: EnvConfig): void {
    if (!envConfig.site_dropbox) return;
    const theme = path.resolve(envConfig.dropbox);
    const site = path.resolve(envConfig.site_dropbox);
    if (isInside(site, theme) || isInside(theme, site)) {
      console.error(`Error: in the "${env}" entry of ${this.configPath}, "dropbox" and "site_dropbox" must be separate folders (neither may contain, or equal, the other).`);
      process.exit(1);
    }
  }

  public getSrcDir(): string {
    const src = path.resolve(process.cwd(), this.data.src ?? DEFAULT_SRC_DIRNAME);
    this.assertDestDirsSeparate(src, this.resolveSiteDir());
    return src;
  }

  public getSiteDir(): string {
    const site = this.resolveSiteDir();
    this.assertDestDirsSeparate(path.resolve(process.cwd(), this.data.src ?? DEFAULT_SRC_DIRNAME), site);
    return site;
  }

  private resolveSiteDir(): string {
    return path.resolve(process.cwd(), this.data.site ?? DEFAULT_SITE_DIRNAME);
  }

  // pull cleans src, and compile flattens everything under it into dist, so a nested
  // site dir would be wiped / pushed as theme files (and vice versa for pull-site).
  private assertDestDirsSeparate(src: string, site: string): void {
    if (isInside(site, src) || isInside(src, site)) {
      console.error(`Error: in ${this.configPath}, "src" (${src}) and "site" (${site}) must be separate folders (neither may contain, or equal, the other).`);
      process.exit(1);
    }
  }

  // Dropbox folder holding page-specific templates (separate from the theme folder)
  public getSiteEnv(env: Env): { dropbox: string; domain: string | undefined } {
    const envConfig = this.data[env];
    if (!envConfig) {
      console.error(`Error: no "${env}" entry found in ${this.configPath}.`);
      process.exit(1);
    }
    if (!envConfig.site_dropbox) {
      console.error(`Error: ${this.configPath}'s "${env}" entry is missing "site_dropbox".`);
      process.exit(1);
    }
    if (!fs.existsSync(envConfig.site_dropbox)) {
      console.error(`Error: site_dropbox path does not exist: ${envConfig.site_dropbox}`);
      process.exit(1);
    }
    this.assertDropboxFoldersSeparate(env, envConfig);
    return { dropbox: envConfig.site_dropbox, domain: envConfig.site_domain };
  }

  public getMappings(): MappingRule[] {
    return this.mappings;
  }

  public getGitUser(): GitUser {
    return this.data.gitUser ?? DEFAULT_GIT_USER;
  }
}
