const path = require("path");

// Where the editor can fetch a newer server than the one this package pins.
//
// An upgrade tier, not the only way in: the dependency below is always present,
// so uninstalling drops back to it and can never leave the user with nothing.
exports.managedServer = {
  source: "npm",
  displayName: "ESLint Language Server",
  packages: ["vscode-langservers-extracted"],
  module: "node_modules/vscode-langservers-extracted/bin/vscode-eslint-language-server",
  bundled: true,
};

exports.resolveServer = async (context, configuredPath, engineOptions = {}) => {
  const selection = await context.resolver.select({
    configuredPath,
    configuredKind: "auto",
    managed: () => {
      const install = context.getManagedServer();
      return install ? { path: install.modulePath, version: install.version } : null;
    },
    bundledPath: () =>
      require.resolve("vscode-langservers-extracted/bin/vscode-eslint-language-server"),
    kind: "node",
    allowShellWrapper: true,
  });
  if (!selection) return null;
  if (selection.source === "configured")
    return context.resolver.launch(selection, {
      args: ["--stdio"],
      cwd: context.rootPath,
      transport: "stdio",
    });
  return context.resolver.nodeEntry(
    path.join(__dirname, "server-launcher.js"),
    [selection.path, "--stdio"],
    {
      cwd: context.rootPath,
      transport: "stdio",
      env: { LUMINE_ESLINT_ENGINE_OPTIONS: JSON.stringify(engineOptions) },
      ...(selection.version && { version: selection.version }),
    },
  );
};
