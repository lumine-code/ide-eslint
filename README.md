# ide-eslint

ESLint language-server adapter for JavaScript and TypeScript.

Registers the ESLint server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) with the bundled `ide-client` package. It provides pull diagnostics, quick fixes, disable comments, rule-documentation links, fix-all commands, and ESLint-powered formatting.

## Features

- **Bundled language server**: ships an exact server version, with an optional custom executable path.
- **Managed upgrade**: installs a newer server from npm when you want one, and removing it returns to the bundled copy.
- **Project ESLint**: resolves the ESLint version and plugins installed by each project, with optional global package-manager and node-module paths.
- **Modern and legacy configuration**: supports flat config and lets older projects opt back into eslintrc loading.
- **Complete fix workflow**: supplies single-rule, same-rule, fix-all, disable-line, disable-file, and documentation actions.
- **Formatting**: dynamically enables ESLint auto-fixes as the formatter for validated documents.
- **Live settings**: changing validation, formatting, working-directory, and rule settings refreshes the running server.
- **Protocol extensions**: handles the server's non-standard missing-config, missing-library, status, exit, output, and documentation messages.

## Requirements

Install ESLint in each project so its own version, configuration, parsers, and plugins are used:

```sh
npm install --save-dev eslint
```

If ESLint is installed elsewhere, set **Node Module Path** or select the global package manager used to install it.

`ide-eslint` and `linter-eslint` are designed to remain installed together. When this adapter's diagnostics are enabled, `linter-eslint` yields its open-file messages to the server while retaining project-wide and tree-view scans. Turning adapter diagnostics off immediately hands open editors back to `linter-eslint`.

## Installation

To install `ide-eslint`, search for _ide-eslint_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-eslint`.

## Services

- **ide-client** (`^1.0.0`): consumed to register the ESLint adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
