import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, MappingRule, EnvConfig, Env } from './types';

export const DEFAULT_CONFIG_FILENAME = 'nb-sync.config.json';
export const DEFAULT_MAPPINGS_FILENAME = 'nb-sync.mappings.json';
export const DEFAULT_SRC_DIRNAME = 'src';


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

    return envConfig;
  }

  public getSrcDir(): string {
    return path.resolve(process.cwd(), this.data.src ?? DEFAULT_SRC_DIRNAME);
  }

  public getMappings(): MappingRule[] {
    return this.mappings;
  }
}
