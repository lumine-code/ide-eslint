const fs = require("fs");

exports.resolveServer = async (configuredPath) => {
  if (configuredPath) {
    await fs.promises.access(configuredPath, fs.constants.X_OK);
    return { command: configuredPath, args: ["--stdio"] };
  }

  const serverModule =
    require.resolve("vscode-langservers-extracted/bin/vscode-eslint-language-server");
  return {
    command: process.execPath,
    args: [serverModule, "--stdio"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
};
