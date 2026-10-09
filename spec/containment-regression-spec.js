const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("ESLint real project containment", () => {
  let directory, root, file, previousPaths, main, engine;
  beforeEach(async () => {
    jasmine.useRealClock();
    directory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "eslint-containment-")),
    );
    root = path.join(directory, "project");
    fs.mkdirSync(path.join(root, "..config"), { recursive: true });
    file = path.join(root, "..config", "source.js");
    fs.writeFileSync(file, "const unused = 1;\n");
    fs.writeFileSync(
      path.join(root, "..config", ".eslintrc.json"),
      JSON.stringify({
        root: true,
        parserOptions: { ecmaVersion: 2021 },
        rules: { "no-unused-vars": "error" },
      }),
    );
    previousPaths = lumine.project.getPaths();
    lumine.project.setPaths([root]);
    main = (await lumine.packages.activatePackage("ide-eslint")).mainModule;
    engine = require("../lib/engine");
    lumine.config.set("ide-eslint.configurationMode", "auto");
    lumine.config.set("ide-eslint.useBuiltin", true);
    lumine.config.set("ide-eslint.workingDirectory", "auto");
    // Scanning a dot directory is explicit here; retain ESLint's default
    // ignore policy everywhere else while testing containment and discovery.
    lumine.config.set("ide-eslint.options", { ignore: false });
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("ide-eslint");
    lumine.project.setPaths(previousPaths);
    for (const key of ["configurationMode", "useBuiltin", "workingDirectory", "options"])
      lumine.config.unset(`ide-eslint.${key}`);
    for (const name of ["source.js", ".eslintrc.json"])
      fs.unlinkSync(path.join(root, "..config", name));
    fs.rmdirSync(path.join(root, "..config"));
    fs.rmdirSync(root);
    fs.rmdirSync(directory);
  });
  it("accepts valid double-dot-prefixed segments while excluding actual parents and siblings", () => {
    expect(engine.containsPath(root, file)).toBe(true);
    expect(engine.containsPath(root, root)).toBe(true);
    expect(engine.containsPath(root, directory)).toBe(false);
    expect(engine.containsPath(root, path.join(directory, "project-sibling", "file.js"))).toBe(
      false,
    );
    expect(engine.configurationFor(root, file, "auto", "auto")).toEqual({
      useFlatConfig: false,
      directory: path.dirname(file),
    });
  });
  it("runs the actual selected-file worker with that directory's legacy configuration", async () => {
    const publications = [];
    const delegate = main.consumeLinterRegistry(() => ({
      setAllMessages(messages) {
        publications.push(...messages);
      },
      dispose() {},
    }));
    const selection = main.consumeTreeViewSelection({ selectedPaths: () => [file] });
    const scanner = main.ensureScanner();
    const warning = spyOn(lumine.notifications, "addWarning").and.callThrough();
    lumine.commands.dispatch(lumine.workspace.getElement(), "ide-eslint:lint-selected");
    if (scanner.scanning)
      await conditionPromise(() => !scanner.scanning, "selected double-dot project scan");
    expect(warning).not.toHaveBeenCalledWith("ESLint selected scan skipped", jasmine.anything());
    expect(
      publications.some(
        (message) => message.location.file === file && message.excerpt.includes("no-unused-vars"),
      ),
    ).toBe(true);
    selection.dispose();
    delegate.dispose();
  });
});
