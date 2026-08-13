const fs = require("fs");

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

exports.resolveServer = async (configuredPath, managed = null) => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return { command: configuredPath, args: ["--stdio"] };
  }

  // A copy the user asked the editor to install wins over the pinned one; both
  // are launched the same way, and every one of these entry points resolves
  // everything it needs relative to its own location.
  const serverModule =
    managed?.modulePath ||
    require.resolve("vscode-langservers-extracted/bin/vscode-eslint-language-server");
  return {
    command: process.execPath,
    args: [serverModule, "--stdio"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    version: managed?.version,
  };
};
