const fs = require("node:fs");
const path = require("node:path");

function installProjectESLint(rootPath) {
  const libraryPath = require.resolve(
    path.join(__dirname, "..", "fixtures", "legacy-project", "node_modules", "eslint"),
  );
  const modulePath = path.join(rootPath, "node_modules", "eslint");
  fs.mkdirSync(modulePath, { recursive: true });
  fs.writeFileSync(
    path.join(modulePath, "index.js"),
    `module.exports = require(${JSON.stringify(libraryPath)});\n`,
  );
  return modulePath;
}

module.exports = { installProjectESLint };
