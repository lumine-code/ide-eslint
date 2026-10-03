# ide-eslint

ESLint language-server adapter for JavaScript and TypeScript.

Registers the ESLint server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) with the `ide-client` package. It provides pull diagnostics, quick fixes, disable comments, rule-documentation links, fix-all commands, ESLint-powered formatting, and explicit project scans.

## Features

- **Bundled language server**: ships an exact server version, with an optional custom executable path.
- **Managed upgrade**: installs a newer server from npm when you want one, and removing it returns to the bundled copy.
- **Project ESLint**: resolves the ESLint version and plugins installed by each project, with optional global package-manager and node-module paths; the bundled and managed servers fall back to bundled ESLint v8 or v10 when no installation is available.
- **Modern and legacy configuration**: detects flat config and eslintrc automatically, with optional explicit format selection.
- **Complete fix workflow**: supplies single-rule, same-rule, fix-all, disable-line, disable-file, and documentation actions.
- **Formatting**: dynamically enables ESLint auto-fixes as the formatter for validated documents.
- **Live settings**: changing validation, formatting, working-directory, and rule settings refreshes the running server.
- **Protocol extensions**: handles the server's non-standard missing-config, missing-library, status, exit, output, and documentation messages.
- **Project scans**: checks saved files across all project folders or selected tree-view files and folders in a background task, retaining results as files are opened and coordinating them with live server diagnostics.

## Requirements

The bundled ESLint engines support basic configurations without a separate installation. Install ESLint in each project when its configuration needs parsers or plugins:

```sh
npm install --save-dev eslint
```

If ESLint is installed elsewhere, set **Node Module Path** or select the global package manager used to install it. The explicit module path takes priority, followed by the project's installation, a global installation, and finally the bundled engine. Bundled ESLint v8 handles legacy eslintrc configuration; bundled v10 handles flat configuration.

Choose **Configuration Format** to keep automatic detection or force flat or legacy configuration. Projects without ESLint configuration are skipped by scans. A custom server executable is responsible for its own library resolution.

## Installation

To install `ide-eslint` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-eslint`.

Install `ide-client` first.

## Usage

Use **Packages > IDE ESLint > Lint Projects** (`ide-eslint:lint-projects`) to scan saved files in every project folder, or **Lint Selected** (`ide-eslint:lint-selected`) to scan files and folders selected in the tree view. Results appear in the linter project view. Scans require the `linter` package, use the same engine selection and options as the language server, and do not change files. The adapter restarts automatically after changing its configuration format or bundled fallback policy; IDE Client also offers a manual server restart.

## Services

- `ide-client`: consumed to register the ESLint adapter with the editor's language-server client.
- `linter.registry`: consumed to publish project scan results alongside live diagnostics.
- `busy-signal`: consumed to show progress while project scans run.
- `tree-view.selection`: consumed to obtain selected files and folders.
- `background-tips.provider`: provided to explain project and selection scans in the empty workspace.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
