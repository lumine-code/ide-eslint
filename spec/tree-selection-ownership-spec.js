const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("ESLint tree selection connection ownership", () => {
  let main, scanner, root, previousPaths, hub, consumption, providers;
  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage("ide-eslint")).mainModule;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ide-eslint-tree-"));
    fs.writeFileSync(path.join(root, "one.js"), "const unused = 1;\n");
    fs.writeFileSync(path.join(root, "two.js"), "const other = 2;\n");
    previousPaths = lumine.project.getPaths();
    lumine.project.setPaths([root]);
    scanner = main.ensureScanner();
    const ServiceHub = lumine.packages.serviceHub.constructor;
    hub = new ServiceHub();
    providers = [];
    consumption = hub.consume("tree-view.selection", "^1.0.0", (service) =>
      main.consumeTreeViewSelection(service),
    );
  });
  afterEach(async () => {
    consumption.dispose();
    for (const provider of providers) provider.dispose();
    await lumine.packages.deactivatePackage("ide-eslint");
    lumine.project.setPaths(previousPaths);
    for (const file of ["one.js", "two.js", ".eslintrc.json"]) {
      const target = path.join(root, file);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    fs.rmdirSync(root);
    for (const name of ["configurationMode", "useBuiltin"])
      lumine.config.unset(`ide-eslint.${name}`);
  });
  function service(name) {
    return {
      selectedPaths: () => [path.join(root, name)],
      dispose: jasmine.createSpy("borrowed dispose"),
    };
  }
  function provide(payload) {
    const registration = hub.provide("tree-view.selection", "1.0.0", payload);
    providers.push(registration);
    return registration;
  }
  const selected = () => scanner.getSelectedScanItems().flatMap((item) => item.targetPaths);

  it("keeps a shared live payload after an older ServiceHub edge is removed", () => {
    const a = service("one.js"),
      first = provide(a);
    provide(a);
    first.dispose();
    expect(selected()).toEqual([path.join(root, "one.js")]);
    expect(a.dispose).not.toHaveBeenCalled();
  });
  it("returns to the most recent earlier live provider", () => {
    const a = service("one.js"),
      b = service("two.js");
    provide(a);
    const second = provide(b);
    expect(selected()).toEqual([path.join(root, "two.js")]);
    second.dispose();
    expect(selected()).toEqual([path.join(root, "one.js")]);
  });
  it("orders exact live leases even when a payload is supplied again", () => {
    const a = service("one.js"),
      b = service("two.js");
    const first = provide(a),
      second = provide(b),
      third = provide(a);
    third.dispose();
    expect(selected()).toEqual([path.join(root, "two.js")]);
    second.dispose();
    expect(selected()).toEqual([path.join(root, "one.js")]);
    first.dispose();
    expect(selected()).toEqual([]);
  });
  it("does not let old cleanup clear the current activation", async () => {
    const a = service("one.js");
    const old = main.consumeTreeViewSelection(a);
    await lumine.packages.deactivatePackage("ide-eslint");
    main = (await lumine.packages.activatePackage("ide-eslint")).mainModule;
    scanner = main.ensureScanner();
    const current = main.consumeTreeViewSelection(a);
    old.dispose();
    expect(selected()).toEqual([path.join(root, "one.js")]);
    current.dispose();
    expect(selected()).toEqual([]);
    expect(a.dispose).not.toHaveBeenCalled();
  });
  it("runs the actual selected-file worker after a duplicate provider edge is retired", async () => {
    fs.writeFileSync(
      path.join(root, ".eslintrc.json"),
      JSON.stringify({
        root: true,
        parserOptions: { ecmaVersion: 2021 },
        rules: { "no-unused-vars": "error" },
      }),
    );
    lumine.config.set("ide-eslint.configurationMode", "legacy");
    lumine.config.set("ide-eslint.useBuiltin", true);
    const messages = [];
    const delegate = main.consumeLinterRegistry(() => ({
      setAllMessages(values) {
        messages.push(...values);
      },
      dispose() {},
    }));
    const a = service("one.js"),
      first = provide(a);
    provide(a);
    first.dispose();
    const warning = spyOn(lumine.notifications, "addWarning").and.callThrough();
    lumine.commands.dispatch(lumine.workspace.getElement(), "ide-eslint:lint-selected");
    if (scanner.scanning) await conditionPromise(() => !scanner.scanning, { timeout: 10000 });
    expect(warning).not.toHaveBeenCalledWith("ESLint selected scan skipped", jasmine.anything());
    expect(
      messages.some(
        (message) =>
          message.location.file === path.join(root, "one.js") &&
          message.excerpt.includes("no-unused-vars"),
      ),
    ).toBe(true);
    delegate.dispose();
  });
});
