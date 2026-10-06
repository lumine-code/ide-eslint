const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const { resolveServer, managedServer } = require("./server");
const { handleServerRequest, handleServerNotification } = require("./messages");
const { configurationFor, containsPath } = require("./engine");
const { CompositeDisposable, Disposable } = require("lumine");

const GRAMMAR_SCOPES = [
  "source.js",
  "source.jsx",
  "source.es6",
  "source.js.jsx",
  "source.babel",
  "source.js-semantic",
  "source.ts",
  "source.tsx",
];

const setting = (key, scope) =>
  scope
    ? lumine.config.get(`ide-eslint.${key}`, { scope: [scope] })
    : lumine.config.get(`ide-eslint.${key}`);

const grammarScopeFor = (scopeUri) => {
  let extension = "";
  try {
    if (scopeUri?.startsWith("file:"))
      extension = path.extname(fileURLToPath(scopeUri)).toLowerCase();
  } catch {
    return "source.js";
  }
  if ([".tsx", ".ctsx", ".mtsx"].includes(extension)) return "source.tsx";
  if ([".ts", ".cts", ".mts"].includes(extension)) return "source.ts";
  return "source.js";
};

const featureSetting = (name, scopeUri) =>
  scopeUri ? setting(`features.${name}`, grammarScopeFor(scopeUri)) : true;

const workspaceFolderFor = (scopeUri) => {
  let filePath;
  try {
    if (scopeUri?.startsWith("file:")) filePath = fileURLToPath(scopeUri);
  } catch {
    return undefined;
  }
  const projectRoots = lumine.project.getPaths();
  const root = filePath
    ? projectRoots
        .filter((candidate) => containsPath(candidate, filePath))
        .sort((left, right) => right.length - left.length)[0] || path.dirname(filePath)
    : projectRoots[0];
  if (!root) return undefined;
  return { uri: pathToFileURL(root).href, name: path.basename(root) || root };
};

const settingsFor = (scopeUri) => {
  const codeActions = featureSetting("codeActions", scopeUri);
  const workspaceFolder = workspaceFolderFor(scopeUri);
  const rootPath = workspaceFolder ? fileURLToPath(workspaceFolder.uri) : null;
  let filePath;
  if (scopeUri?.startsWith("file:")) {
    try {
      filePath = fileURLToPath(scopeUri);
    } catch {
      /* Invalid URIs use project defaults. */
    }
  }
  const configuration = rootPath
    ? configurationFor(
        rootPath,
        filePath,
        setting("configurationMode"),
        setting("workingDirectory"),
      )
    : { useFlatConfig: setting("configurationMode") !== "legacy" };
  const codeActionOnSaveRules = setting("codeActionOnSave.rules") || [];
  const rulesCustomizations = (setting("rulesCustomizations") || []).map(
    ({ fixability, ...customization }) => ({
      ...customization,
      ...(fixability === "fixable"
        ? { fixable: true }
        : fixability === "unfixable"
          ? { fixable: false }
          : {}),
    }),
  );
  return {
    validate: featureSetting("diagnostics", scopeUri) ? "on" : "off",
    packageManager: setting("packageManager"),
    useESLintClass: true,
    useFlatConfig: configuration.useFlatConfig,
    // vscode-langservers-extracted 4.10's experimental loader expects a
    // FlatESLint export removed by ESLint 10. The normal ESLint loader supports
    // both flat and legacy configuration through `useFlatConfig`.
    experimental: { useFlatConfig: false },
    options: setting("options") || {},
    run: setting("run"),
    onIgnoredFiles: setting("onIgnoredFiles"),
    quiet: setting("quiet"),
    rulesCustomizations,
    problems: { shortenToSingleLine: setting("problems.shortenToSingleLine") },
    // The server treats undefined as a path and calls path.isAbsolute on it.
    nodePath: setting("nodePath") || null,
    workingDirectory: { mode: setting("workingDirectory") },
    ...(workspaceFolder ? { workspaceFolder } : {}),
    format: featureSetting("format", scopeUri),
    codeActionOnSave: {
      mode: setting("codeActionOnSave.mode"),
      // The extracted server interprets an empty array as "disable every
      // rule", while absence means its normal fix-all behavior.
      ...(codeActionOnSaveRules.length ? { rules: codeActionOnSaveRules } : {}),
    },
    codeAction: {
      disableRuleComment: {
        enable: codeActions && setting("codeAction.disableRuleComment"),
        location: setting("codeAction.disableRuleCommentLocation"),
        commentStyle: "line",
      },
      showDocumentation: {
        enable: codeActions && setting("codeAction.showDocumentation"),
      },
    },
  };
};

module.exports = {
  activate() {
    this.disposables = new CompositeDisposable();
    this.scanMessages = [];
    this.disposables.add(
      lumine.commands.add("lumine-workspace", {
        "ide-eslint:lint-projects": {
          description: "Run ESLint over every supported file in the project folders.",
          didDispatch: () => this.ensureScanner().run(),
        },
        "ide-eslint:lint-selected": {
          description: "Run ESLint over selected tree-view files and folders.",
          didDispatch: () => this.ensureScanner().runSelected(),
        },
      }),
      lumine.project.onDidChangePaths(() => {
        this.scanner?.dispose();
        this.publishScanMessages([]);
      }),
    );
  },

  deactivate() {
    this.scanner?.dispose();
    this.scanner = null;
    this.projectDiagnostics?.dispose();
    this.projectDiagnostics = null;
    this.ideClient = null;
    this.indieDelegate = null;
    this.busySignal = null;
    this.treeView = null;
    this.scanMessages = [];
    this.disposables?.dispose();
  },

  ensureScanner() {
    if (!this.scanner) {
      const ProjectScanner = require("./project-scanner");
      this.scanner = new ProjectScanner({
        hasDelegate: () => Boolean(this.indieDelegate),
        getBusySignal: () => this.busySignal,
        getTreeView: () => this.treeView,
        getSettings: () => ({
          configurationMode: setting("configurationMode"),
          workingDirectory: setting("workingDirectory"),
          packageManager: setting("packageManager"),
          nodePath: setting("nodePath"),
          useBuiltin: setting("useBuiltin"),
          options: setting("options") || {},
          quiet: setting("quiet"),
          rulesCustomizations: setting("rulesCustomizations") || [],
          shortenToSingleLine: setting("problems.shortenToSingleLine"),
        }),
        publish: (messages) => this.publishScanMessages(messages, { showProjectView: true }),
      });
    }
    return this.scanner;
  },

  publishScanMessages(messages = this.scanMessages || [], options) {
    this.scanMessages = messages;
    const publisher = this.projectDiagnostics || this.indieDelegate;
    publisher?.setAllMessages(messages, options);
  },

  updateProjectDiagnostics() {
    this.projectDiagnostics?.dispose();
    this.projectDiagnostics =
      this.indieDelegate && this.ideClient?.createProjectDiagnostics
        ? this.ideClient.createProjectDiagnostics("ide-eslint", this.indieDelegate)
        : null;
    this.publishScanMessages();
  },

  consumeLinterRegistry(registerIndie) {
    const delegate = registerIndie({ name: "ESLint/Project", deleteOnOpen: false });
    this.indieDelegate = delegate;
    this.updateProjectDiagnostics();
    const registration = new Disposable(() => {
      if (this.indieDelegate === delegate) {
        this.scanner?.dispose();
        this.projectDiagnostics?.dispose();
        this.projectDiagnostics = null;
        this.indieDelegate = null;
      }
      delegate.dispose();
    });
    this.disposables?.add(registration);
    return registration;
  },

  consumeBusySignal(service) {
    this.busySignal = service;
    return new Disposable(() => {
      if (this.busySignal === service) {
        this.busySignal = null;
        this.scanner?.busyProvider?.dispose();
        if (this.scanner) this.scanner.busyProvider = null;
      }
    });
  },

  consumeTreeViewSelection(service) {
    this.treeView = service;
    return new Disposable(() => {
      if (this.treeView === service) this.treeView = null;
    });
  },

  provideBackgroundTips() {
    return {
      packageName: "ide-eslint",
      tips: [
        "{% if keys['ide-eslint:lint-projects'] %}You can check every JavaScript and TypeScript file in the project with {{ 'ide-eslint:lint-projects' | keystroke }}{% else %}Use Packages > IDE ESLint > Lint Projects to check files you have not opened, or Lint Selected to check selected tree-view files and folders.{% endif %}",
      ],
    };
  },

  consumeIdeClient(service) {
    this.ideClient = service;
    this.updateProjectDiagnostics();
    const adapter = {
      id: "ide-eslint",
      displayName: "ESLint Language Server",
      grammarScopes: GRAMMAR_SCOPES,
      languageIdForScope(scope, { filePath } = {}) {
        if (scope === "source.tsx") return "typescriptreact";
        if (scope === "source.ts") return "typescript";
        if (scope === "source.js" && path.extname(filePath || "").toLowerCase() === ".jsx")
          return "javascriptreact";
        if (["source.jsx", "source.js.jsx", "source.babel"].includes(scope))
          return "javascriptreact";
        return "javascript";
      },
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-eslint"],
      restartKeyPaths: [
        "ide-eslint.serverPath",
        "ide-eslint.useBuiltin",
        "ide-eslint.configurationMode",
      ],
      managedServer,
      async resolveServer(context) {
        return resolveServer(context, setting("serverPath"), {
          rootPath: context.rootPath,
          useBuiltin: setting("useBuiltin"),
          configurationMode: setting("configurationMode"),
        });
      },
      getSettings() {
        return settingsFor();
      },
      getWorkspaceConfiguration(section, scopeUri) {
        if (section === "" || section === "eslint" || section === undefined)
          return settingsFor(scopeUri);
        return undefined;
      },
      handleServerRequest,
      handleServerNotification,
    };

    const registration = service.registerAdapter(adapter);
    return new Disposable(() => {
      registration.dispose();
      if (this.ideClient === service) {
        this.ideClient = null;
        this.updateProjectDiagnostics();
      }
    });
  },
};
