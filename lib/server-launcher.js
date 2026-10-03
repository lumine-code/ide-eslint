const path = require("path");
const { languageServerFiles, resolveInstalled, resolveWithFallback } = require("./engine");

const serverModule = path.resolve(process.argv[2]);
const files = languageServerFiles(serverModule);
const originalResolve = files.resolve;
const options = JSON.parse(process.env.LUMINE_ESLINT_ENGINE_OPTIONS || "{}");

// The extracted server only asks for `eslint`. Resolve bundled aliases at that
// one boundary after its own resolver reports no local or global installation.
files.resolve = (moduleName, nodePath, cwd, tracer) =>
  moduleName !== "eslint"
    ? originalResolve(moduleName, nodePath, cwd, tracer)
    : cwd === nodePath
      ? resolveInstalled(moduleName, nodePath, cwd)
      : resolveWithFallback(resolveInstalled, moduleName, nodePath, cwd, tracer, {
          ...options,
          filePath: path.join(cwd, "__lsp__.js"),
        });

process.argv.splice(1, 2, serverModule);
require(serverModule);
