const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const { resolveServer, managedServer } = require("./server");
const { handleServerRequest, handleServerNotification } = require("./messages");

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

const setting = (key) => lumine.config.get(`ide-eslint.${key}`);

const containsPath = (root, filePath) => {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

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
  const codeActions = setting("features.codeActions");
  const workspaceFolder = workspaceFolderFor(scopeUri);
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
    validate: setting("features.diagnostics") ? "on" : "off",
    packageManager: setting("packageManager"),
    useESLintClass: true,
    useFlatConfig: setting("useFlatConfig"),
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
    format: setting("features.format"),
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
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-eslint",
      displayName: "ESLint Language Server",
      grammarScopes: GRAMMAR_SCOPES,
      languageIdForScope(scope) {
        if (scope === "source.tsx") return "typescriptreact";
        if (scope === "source.ts") return "typescript";
        if (["source.jsx", "source.js.jsx", "source.babel"].includes(scope))
          return "javascriptreact";
        return "javascript";
      },
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-eslint"],
      restartKeyPaths: ["ide-eslint.serverPath"],
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
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

    return service.registerAdapter(adapter);
  },
};
