# NationBuilder Dropbox Sync <!-- omit from toc -->

Sync a NationBuilder theme's Dropbox folder with a git-based source
directory: pull, compile, compare, and push.

- [Overview](#overview)
- [Getting started](#getting-started)
  - [1. Install](#1-install)
  - [2. Initialise your configs](#2-initialise-your-configs)
- [Commands](#commands)
  - [Pull](#pull)
  - ["Compile"](#compile)
  - [Compare](#compare)
  - [Push](#push)
  - [Syncing + Task Scheduling](#syncing--task-scheduling)
- [Flags common to every command](#flags-common-to-every-command)
- [Mapping rules](#mapping-rules)

## Overview

`nb-dropbox-sync` is a package for maintaining a git-based mirror of a [custom NationBuilder theme](https://support.nationbuilder.com/en/articles/2331534-create-a-website-theme-with-nationbuilder) alongside the [Dropbox integration](https://support.nationbuilder.com/en/articles/2331873-sync-your-nation-s-themes-with-dropbox) that NationBuilder uses by default. It is installed inside an individual theme's repo, configured with a config and a mappings file, and exposes a `nb-sync` CLI with subcommands.

An typical workflow, would use the following commands like this:

```
Dropbox folder  →  [pull]  →  src dir  →  [compile]  →  dist dir  →  [push]  →  Dropbox folder
                                                                    [compare]  →  Dropbox folder (read-only diff)
```

1. **`pull`** - copies raw files from Dropbox into the `src` directory, organising them into a nice subfolder structure using mapping rules
2. **`compile`** - re-flattens the `src` directory into the `dist` directory, ready to be "deployed"
3. **`compare`** - read-only diff of the `dist` directory against the Dropbox folder *(useful for auditing without committing changes)*
4. **`push`** - copies changed files from `dist` back to Dropbox, with an interactive per-file diff and confirmation step

The `dist` path and the Dropbox path(s) are configured in `nb-sync.config.json`.
The `src` directory defaults to `src` inside the theme repo, and can be
overridden.

## Getting started

### 1. Install

```bash
npm install nb-dropbox-sync
```

This makes the `nb-sync` command available (via `node_modules/.bin/`) for
each of the commands below.

### 2. Initialise your configs

```bash
npx nb-sync init
```

This creates both config files in the current directory (leaving either alone if it already exists):

- **`nb-sync.mappings.json`** - copied as-is from the example template. Adjust its rules to match this theme's file naming conventions - see [Mapping rules](#mapping-rules) below. Unlike `nb-sync.config.json`, this file should be **committed** — it's theme-specific but not machine-specific.
- **`nb-sync.config.json`** - built interactively: you'll be prompted for the prod Dropbox folder path and publish link, whether to override the default `src`/`dist` directories, and whether to set up a `test` environment too. The result looks like:

```json
{
  "dist": "/absolute/path/to/dist-dir",
  "prod": {
    "dropbox": "/absolute/path/to/dropbox/folder",
    "publish_link": "https://<NATION_SLUG>.nationbuilder.com/admin/sites/<SITE_ID>/themes/<THEME_ID>/attachments"
  },
  "test": {
    "dropbox": "/absolute/path/to/test-dropbox/folder",
    "publish_link": "https://<NATION_SLUG>.nationbuilder.com/admin/sites/<TEST_SITE_ID>/themes/<TEST_THEME_ID>/attachments"
  }
}
```

**Fields:**

- `dist` and `src` (not shown - see below) are environment-independent: there's one dist build and one src checkout regardless of which Dropbox you're pointed at.
- `prod` is required. `test` is optional - only answer yes to the "test environment" prompt if this theme has a separate test Dropbox/site, then pass `--env=test` to any command to target it instead of `prod`.
- `publish_link` is optional on both - if set, it's printed at the end of the `push` command as a reminder of where to publish the theme.
- `src` is optional and defaults to `src/` inside the theme repo (where the actual theme files - `layout.html`, `scss/`, `imgs/`, etc. - live). Only override it if prompted and you need something else.

`nb-sync.config.json` should be gitignored (it holds machine-local absolute paths).

## Commands

Every command accepts `--config=<path>` / `--mappings=<path>` to override
the default `nb-sync.config.json` / `nb-sync.mappings.json` file locations,
and (except `compile`) `--env=prod|test` to pick which Dropbox/publish_link
entry to use (see [Flags common to every command](#flags-common-to-every-command)).

### Pull

```bash
npx nb-sync pull
npx nb-sync pull --env=test
```

Copies files from the configured Dropbox path into the `src/` directory.

- **Pulls latest from git first** - runs `git pull` in the `src/` directory before copying anything (skipped if `src/` isn't a git repo yet).
- **Cleans the destination** - everything in `src/` is removed before copying (except a keep list: `.git`, `.gitattributes`, `.gitignore`, `README.md`, `bot-deploy.ps1`, `node_modules`, `package.json`, `package-lock.json`, `nb-sync.config.json`, `nb-sync.mappings.json`, `sync.log`)
- **Copies files using mapping rules** - each file's path (relative to the Dropbox source folder) is matched against the rules in `nb-sync.mappings.json` (in order) to determine which subfolder it lands in. Unmatched files are copied flat to the root.
- **Resolves SCSS `@import` paths** - for `.scss` files that contain `@import` statements, each import is rewritten from a flat name (e.g. `@import 'mixins_colors'`) to the correct relative path based on where both files will land (e.g. `@import '../scss/mixins/mixins_colors'`). _(This is done so Ctrl + clicking still works in VS Code)_.

**Flags:** `--quiet` / `-q`, `--no-color` / `--plain`, `--env=`, `--config=`, `--mappings=`

### "Compile"

```bash
npx nb-sync compile
```

Processes the `src/` directory into a flat `dist` directory ready for copying back to Dropbox.

- **Whitelists file extensions** - only a whitelist of extensions are copied (`.html`, `.scss`, `.js`, `.css`, `.map`, `.json`, image formats, font formats)
- **Flattens the folder structure** - all files are written directly into the dist directory, regardless of their subfolder in `src/`. (Single exception: `.vscode/settings.json` is preserved at `.vscode/settings.json`)
- **Flattens SCSS `@import` paths** - any path in an `@import` statement is reduced to just the filename (e.g. `@import '../scss/mixins/mixins_colors'` becomes `@import 'mixins_colors'`), reversing the path resolution applied during the pull.

`compile` doesn't touch Dropbox at all, so it doesn't take `--env=`.

**Flags:** `--quiet` / `-q`, `--no-color` / `--plain`, `--config=`, `--mappings=`

### Compare

```bash
npx nb-sync compare
npx nb-sync compare --showDiffs
npx nb-sync compare --env=test
```

Compares the compiled `dist` directory against the live Dropbox folder.

- **Compiles first** - automatically runs the compile step before comparing, so `dist` is always up to date
- **✅** - file is identical in both locations
- **⚠️** - file exists in both but content differs
- **❌** - file exists in one location only

With `--showDiffs`, line-by-line diffs are printed for any differing text files (binary/font/image files are skipped).

### Push

```bash
npx nb-sync push
npx nb-sync push --force
```

Copies changed files from the `dist` directory back to the Dropbox folder, with an interactive per-file review.

- **Compiles first** - automatically runs the compile step before comparing, so `dist` is always up to date
- **Detects changes** - walks the `dist` directory and compares each file against the corresponding file in Dropbox (matched by relative path). Unchanged files are silently skipped.
- **Shows diffs** - for each changed or new text file, a unified diff is printed (Dropbox version → dist version). Binary files (images, fonts) are flagged but the diff is skipped.
- **Prompts per file** - for each change, prompts `Push this change? [y/N]` - default is **no**, so pressing Enter skips the file
- **Reports Dropbox-only files** - files present in Dropbox but absent from dist are listed at the end, but are never deleted automatically
- **Prints a summary** - pushed/skipped counts at the end
- **Shows publish link** - if `publish_link` is set for the active environment in `nb-sync.config.json`, prints the URL after the summary as a reminder of where to publish the theme

**Flags:** `--force`, `--quiet` / `-q`, `--no-color` / `--plain`, `--env=`, `--config=`, `--mappings=`

### Syncing + Task Scheduling

```bash
npx nb-sync sync
npx nb-sync task register
npx nb-sync task check
npx nb-sync task remove
```

`sync` runs an unattended pull + commit + push cycle against the theme's
own git repo (checks it's on `main` and up to date first, then pulls from
Dropbox into `src/`, and commits + pushes if anything changed).

`task` registers/checks/removes a Windows Task Scheduler entry that runs
`sync` on an hourly schedule. The task name and working directory are
both derived automatically from the folder `task register` is run in — no
arguments needed.

## Flags common to every command

| Flag | Applies to | Description |
|---|---|---|
| `--config=<path>` | all | Override the default `nb-sync.config.json` location |
| `--mappings=<path>` | all | Override the default `nb-sync.mappings.json` location |
| `--env=prod\|test` | `pull`, `push`, `compare`, `sync`, `task register` | Which `nb-sync.config.json` environment's `dropbox`/`publish_link` to use (default: `prod`) |
| `--quiet` / `-q` | `pull`, `compile`, `push` | Suppress per-file output |
| `--no-color` / `--plain` | `pull`, `compile`, `push` | Disable ANSI colour output |

## Mapping rules

Mapping rules from Dropbox → `src/` directory are defined in `nb-sync.mappings.json`.
Rules are applied in order - the first match wins. Each rule has two fields:

| Field   | Description |
|---------|-------------|
| `match` | A regular expression tested against the file's path relative to the Dropbox source folder |
| `dest`  | The subfolder within `src/` to copy the file into (empty string = root) |

Example:
```json
{ "match": "^_.*\\.scss$", "dest": "scss/partials" }
```

Files that match no rule are copied flat to the root of the destination.
