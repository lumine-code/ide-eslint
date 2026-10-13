const { pathToFileURL } = require("node:url");

const libraries = new Map();

function loadLibrary(libraryPath) {
  const url = pathToFileURL(libraryPath).href;
  if (!libraries.has(url)) {
    const pending = import(url)
      .then((namespace) => {
        const library = namespace.default ?? namespace;
        if (typeof library.loadESLint !== "function" && typeof library.ESLint !== "function")
          throw new TypeError("The selected ESLint library exposes no engine");
        return library;
      })
      .catch((error) => {
        libraries.delete(url);
        throw error;
      });
    libraries.set(url, pending);
  }
  return libraries.get(url);
}

module.exports = { loadLibrary };
