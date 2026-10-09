const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { execFileSync } = require("child_process");

const FLAT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];
const LEGACY_CONFIGS = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];

function containsPath(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function findConfiguration(rootPath, filePath = path.join(rootPath, "__scan__.js")) {
  let directory = path.dirname(filePath);
  try {
    if (fs.statSync(filePath).isDirectory()) directory = filePath;
  } catch {
    // An open buffer or the representative scan path need not exist on disk.
  }
  let workingDirectory = rootPath;
  while (containsPath(rootPath, directory)) {
    if (FLAT_CONFIGS.some((name) => fs.existsSync(path.join(directory, name)))) {
      return { directory, useFlatConfig: true };
    }
    if (LEGACY_CONFIGS.some((name) => fs.existsSync(path.join(directory, name)))) {
      return { directory, useFlatConfig: false };
    }
    const manifestPath = path.join(directory, "package.json");
    if (fs.existsSync(manifestPath)) {
      workingDirectory = directory;
      try {
        if (JSON.parse(fs.readFileSync(manifestPath, "utf8")).eslintConfig) {
          return { directory, useFlatConfig: false };
        }
      } catch {
        // ESLint reports a malformed manifest when it actually loads it.
      }
    }
    if (path.resolve(directory) === path.resolve(rootPath)) break;
    directory = path.dirname(directory);
  }
  return { directory: workingDirectory, useFlatConfig: true };
}

function configurationFor(rootPath, filePath, mode = "auto", workingDirectory = "location") {
  const configuration = findConfiguration(rootPath, filePath);
  const useFlatConfig = mode === "auto" ? configuration.useFlatConfig : mode === "flat";
  return {
    useFlatConfig,
    directory:
      workingDirectory === "auto" || (useFlatConfig && configuration.useFlatConfig)
        ? configuration.directory
        : rootPath,
  };
}

function bundledLibrary(useFlatConfig) {
  return require.resolve(useFlatConfig ? "eslint10" : "eslint8");
}

// Both the scanner and the package-owned server launcher call this boundary.
// A project, explicit module path or global installation always gets the first
// chance to resolve; fallback never hides an error loading an existing library.
async function resolveWithFallback(resolve, moduleName, nodePath, cwd, tracer, options = {}) {
  try {
    return await resolve(moduleName, nodePath, cwd, tracer);
  } catch (error) {
    if (
      moduleName !== "eslint" ||
      options.useBuiltin === false ||
      error.eslintLibraryPresent ||
      error.code !== "MODULE_NOT_FOUND"
    )
      throw error;
    const { useFlatConfig } = configurationFor(
      options.rootPath || cwd,
      options.filePath,
      options.configurationMode,
    );
    return bundledLibrary(useFlatConfig);
  }
}

function languageServerFiles(serverModule) {
  const serverRequire = createRequire(
    serverModule ||
      require.resolve("vscode-langservers-extracted/bin/vscode-eslint-language-server"),
  );
  return serverRequire("vscode-languageserver/node").Files;
}

// Resolve absolute installed-package candidates so the editor's own require
// paths never become a project's ESLint. Explicit paths and global package
// directories retain the server's normal lookup order.
async function resolveInstalled(moduleName, nodePath, cwd) {
  const candidates = [];
  if (nodePath && cwd === nodePath) candidates.push(path.join(nodePath, moduleName));
  let directory = path.resolve(cwd);
  while (true) {
    candidates.push(path.join(directory, "node_modules", moduleName));
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (nodePath && cwd !== nodePath) candidates.push(path.join(nodePath, moduleName));
  let missing;
  for (const candidate of candidates) {
    try {
      return require.resolve(candidate);
    } catch (error) {
      if (fs.existsSync(candidate)) {
        error.eslintLibraryPresent = true;
        throw error;
      }
      if (error.code !== "MODULE_NOT_FOUND") throw error;
      missing = error;
    }
  }
  throw missing;
}

function globalNodePath(files, packageManager) {
  if (packageManager === "yarn") return files.resolveGlobalYarnPath();
  if (packageManager === "pnpm") {
    try {
      return execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["root", "-g"], {
        encoding: "utf8",
        windowsHide: true,
        shell: process.platform === "win32",
      }).trim();
    } catch {
      return undefined;
    }
  }
  return files.resolveGlobalNodePath();
}

async function createEngine(rootPath, targetPath, settings) {
  const configuration = configurationFor(
    rootPath,
    targetPath,
    settings.configurationMode,
    settings.workingDirectory,
  );
  const files = languageServerFiles();
  let libraryPath;
  if (settings.nodePath) {
    const nodePath = path.resolve(rootPath, settings.nodePath);
    try {
      libraryPath = await resolveInstalled("eslint", nodePath, nodePath);
    } catch (error) {
      if (error.eslintLibraryPresent || error.code !== "MODULE_NOT_FOUND") throw error;
      // Match the server's explicit-path, project and global lookup order.
    }
  }
  if (!libraryPath) {
    libraryPath = await resolveWithFallback(
      resolveInstalled,
      "eslint",
      globalNodePath(files, settings.packageManager),
      configuration.directory,
      undefined,
      {
        ...settings,
        rootPath,
        filePath: targetPath,
      },
    );
  }
  const library = require(libraryPath);
  const ESLint = library.loadESLint
    ? await library.loadESLint({ useFlatConfig: configuration.useFlatConfig })
    : library.ESLint;
  return new ESLint({
    ...settings.options,
    cwd: configuration.directory,
    errorOnUnmatchedPattern: false,
    fix: false,
  });
}

module.exports = {
  containsPath,
  configurationFor,
  bundledLibrary,
  resolveWithFallback,
  languageServerFiles,
  resolveInstalled,
  createEngine,
};
