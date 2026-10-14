
export interface EnvConfig {
  dropbox: string;
  publish_link?: string;
  site_dropbox?: string;
  site_domain?: string;
}

export interface ProjectConfig {
  dist: string;
  src?: string;
  site?: string;
  prod: EnvConfig;
  test?: EnvConfig;
  gitUser?: GitUser;
}

export type Env = 'prod' | 'test';

export interface MappingRule {
  match: string;
  dest: string;
}

export interface LogOptions {
  color: boolean;
  quiet: boolean;
}

export type GitUser = {
  name: string;
  email?: string;
}

export type CommitDetails = {
  user: GitUser;
  msgPrefix: string;
  description?: string;
}

export type TaskQueryResult = {
  found: boolean;
  fields: Record<string, string>;
}

export type SchtasksResult = {
  status: number;
  stdout: string;
  stderr: string;
}
