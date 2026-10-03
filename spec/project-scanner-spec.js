const fs = require("fs");
const os = require("os");
const path = require("path");
const { Task } = require("lumine");
const { execFile } = require("child_process");

describe("ide-eslint project scans", () => {
  let main, rootPath, scanner, delegate, registration, callback, task;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("ide-eslint")).mainModule;
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-eslint-scan-"));
    fs.mkdirSync(path.join(rootPath, "nested"));
    fs.writeFileSync(path.join(rootPath, "one.js"), "const value = 1\n");
    fs.writeFileSync(path.join(rootPath, "nested", "two.js"), "const value = 2\n");
    lumine.project.setPaths([rootPath]);
    delegate = {
      setAllMessages: jasmine.createSpy("setAllMessages"),
      dispose: jasmine.createSpy("dispose"),
    };
    registration = main.consumeLinterRegistry(() => delegate);
    delegate.setAllMessages.calls.reset();
    scanner = main.ensureScanner();
    task = {
      on: jasmine.createSpy("on").and.callFake((name, handler) => {
        callback = handler;
      }),
      terminate: jasmine.createSpy("terminate"),
    };
    spyOn(Task, "once").and.returnValue(task);
  });

  afterEach(async () => {
    registration.dispose();
    await lumine.packages.deactivatePackage("ide-eslint");
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  it("dispatches scans once from both application-menu and tree-view targets", () => {
    const workspace = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspace);
    const tree = document.createElement("div");
    tree.className = "tree-view";
    workspace.appendChild(tree);
    spyOn(scanner, "run");
    spyOn(scanner, "runSelected");
    lumine.commands.dispatch(workspace, "ide-eslint:lint-projects");
    lumine.commands.dispatch(tree, "ide-eslint:lint-selected");
    expect(scanner.run.calls.count()).toBe(1);
    expect(scanner.runSelected.calls.count()).toBe(1);
    tree.remove();
  });

  it("keeps selected files once and uses the deepest project root", () => {
    const nested = path.join(rootPath, "nested");
    const outer = path.join(rootPath, "one.js");
    const inner = path.join(nested, "two.js");
    lumine.project.setPaths([rootPath, nested]);
    main.consumeTreeViewSelection({
      selectedPaths: () => [outer, inner, inner, "missing", os.tmpdir()],
    });
    expect(scanner.getSelectedScanItems()).toEqual([
      { projectPath: rootPath, targetPaths: [outer] },
      { projectPath: nested, targetPaths: [inner] },
    ]);
  });

  it("publishes scan results even when the file is already open", async () => {
    const filePath = path.join(rootPath, "one.js");
    await lumine.workspace.open(filePath);
    scanner.run();
    await callback({
      results: [
        {
          filePath,
          messages: [
            {
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 6,
              ruleId: "semi",
              severity: 2,
              message: "Missing semicolon.",
            },
          ],
        },
      ],
    });
    expect(main.scanMessages.length).toBe(1);
    expect(delegate.setAllMessages.calls.mostRecent().args[0][0].location.file).toBe(filePath);
    expect(scanner.scanning).toBe(false);
  });

  it("prevents duplicate concurrent scans and clears old messages after a clean scan", async () => {
    main.publishScanMessages([{ excerpt: "previous" }]);
    scanner.run();
    scanner.run();
    expect(Task.once.calls.count()).toBe(1);
    await callback({ results: [] });
    expect(main.scanMessages).toEqual([]);
  });

  it("warns about an empty tree selection", () => {
    spyOn(lumine.notifications, "addWarning");
    scanner.runSelected();
    expect(Task.once).not.toHaveBeenCalled();
    expect(lumine.notifications.addWarning).toHaveBeenCalled();
  });

  it("filters VCS and linter ignore patterns after ESLint has scanned", async () => {
    const filePath = path.join(rootPath, "one.js");
    lumine.config.set("linter.ignoreGlob", "**/one.js");
    expect(await scanner.isIgnored(filePath)).toBe(true);
    lumine.config.unset("linter.ignoreGlob");
    lumine.config.set("core.excludeVcsIgnoredPaths", true);
    spyOn(lumine.project, "repositoryForPath").and.resolveTo({ isPathIgnored: () => true });
    expect(await scanner.isIgnored(filePath)).toBe(true);
  });

  it("ignores late callbacks after cancellation and disposes busy progress", async () => {
    const provider = { add: jasmine.createSpy("add"), dispose: jasmine.createSpy("dispose") };
    main.consumeBusySignal({ create: () => provider });
    scanner.run();
    registration.dispose();
    await callback({
      results: [
        { filePath: path.join(rootPath, "one.js"), messages: [{ message: "stale", severity: 2 }] },
      ],
    });
    expect(task.terminate).toHaveBeenCalled();
    expect(provider.dispose).toHaveBeenCalled();
    expect(main.scanMessages).toEqual([]);
  });

  it("retains raw scan cache when the IDE service attaches and disappears", () => {
    const messages = [{ excerpt: "kept" }];
    main.publishScanMessages(messages);
    const coordinator = {
      setAllMessages: jasmine.createSpy("setAllMessages"),
      dispose: jasmine.createSpy("dispose"),
    };
    const service = {
      registerAdapter: () => ({ dispose() {} }),
      createProjectDiagnostics: jasmine
        .createSpy("createProjectDiagnostics")
        .and.returnValue(coordinator),
    };
    const edge = main.consumeIdeClient(service);
    expect(service.createProjectDiagnostics).toHaveBeenCalledWith("ide-eslint", delegate);
    expect(coordinator.setAllMessages).toHaveBeenCalledWith(messages, undefined);
    edge.dispose();
    expect(coordinator.dispose).toHaveBeenCalled();
    expect(delegate.setAllMessages.calls.mostRecent().args[0]).toBe(messages);
    expect(main.scanMessages).toBe(messages);
  });

  it("retains results when a file opens rather than deleting its scan bucket", () => {
    const register = jasmine
      .createSpy("register")
      .and.returnValue({ dispose() {}, setAllMessages() {} });
    main.consumeLinterRegistry(register).dispose();
    expect(register).toHaveBeenCalledWith({ name: "ESLint/Project", deleteOnOpen: false });
  });
});

describe("ide-eslint scan engines", () => {
  let rootPath, engineModule;

  beforeEach(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-eslint-engine-"));
    engineModule = require("../lib/engine");
    fs.writeFileSync(path.join(rootPath, "one.js"), "const value = 1\n");
  });

  afterEach(() => fs.rmSync(rootPath, { recursive: true, force: true }));

  const settings = {
    configurationMode: "auto",
    workingDirectory: "location",
    packageManager: "npm",
    useBuiltin: true,
    options: {},
  };

  const scan = (scanItems) =>
    new Promise((resolve, reject) => {
      let received = false;
      const task = Task.once(path.join(__dirname, "..", "lib", "scan-task.js"), scanItems, () => {
        if (!received) reject(new Error("Scan task finished without a report"));
      });
      task.on("ide-eslint:project-scan", (report) => {
        received = true;
        resolve(report);
      });
    });

  const probe = (rootPath, settings) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(__dirname, "helpers", "engine-probe.js"), rootPath, JSON.stringify(settings)],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message));
          else resolve(JSON.parse(stdout));
        },
      );
    });

  const installProjectFixture = (rootPath, alias) => {
    const modulePath = path.join(rootPath, "node_modules", "eslint");
    fs.mkdirSync(modulePath, { recursive: true });
    fs.writeFileSync(
      path.join(modulePath, "index.js"),
      `module.exports = require(${JSON.stringify(require.resolve(alias))});`,
    );
  };

  it("scans flat config with v10 and legacy config with v8", async () => {
    fs.writeFileSync(
      path.join(rootPath, "eslint.config.cjs"),
      'module.exports = [{ rules: { semi: ["error", "always"] } }];',
    );
    let report = await scan([{ projectPath: rootPath, targetPaths: [rootPath], settings }]);
    expect(report.errors).toEqual([]);
    expect(
      report.results.find(({ filePath }) => filePath.endsWith("one.js")).messages[0].ruleId,
    ).toBe("semi");
    expect((await probe(rootPath, settings)).version).toMatch(/^10\./);
    fs.rmSync(path.join(rootPath, "eslint.config.cjs"));
    fs.writeFileSync(
      path.join(rootPath, ".eslintrc.json"),
      JSON.stringify({
        parserOptions: { ecmaVersion: 2021 },
        rules: { semi: ["error", "always"] },
      }),
    );
    report = await scan([{ projectPath: rootPath, targetPaths: [rootPath], settings }]);
    expect(report.errors).toEqual([]);
    expect(report.results[0].messages[0].ruleId).toBe("semi");
    expect((await probe(rootPath, settings)).version).toMatch(/^8\./);
  }, 60000);

  it("uses the project engine before bundled fallback and passes configured options", async () => {
    fs.writeFileSync(path.join(rootPath, "eslint.config.cjs"), "module.exports = [{}];");
    installProjectFixture(rootPath, "eslint8");
    const result = await probe(rootPath, {
      ...settings,
      options: { overrideConfig: { rules: { semi: ["error", "always"] } } },
    });
    expect(result.version).toMatch(/^8\./);
    expect(
      result.results.find(({ filePath }) => filePath.endsWith("one.js")).messages[0].ruleId,
    ).toBe("semi");
  }, 30000);

  it("uses an explicit module path before the project engine", async () => {
    fs.writeFileSync(path.join(rootPath, "eslint.config.cjs"), "module.exports = [{}];");
    installProjectFixture(rootPath, "eslint8");
    const nodePath = path.dirname(path.dirname(require.resolve("eslint/package.json")));
    const result = await probe(rootPath, { ...settings, nodePath });
    expect(result.version).toMatch(/^10\./);
  }, 30000);

  it("does not replace an available library or unrelated resolution failure", async () => {
    const resolve = jasmine.createSpy("resolve").and.resolveTo("/project/eslint.js");
    expect(await engineModule.resolveWithFallback(resolve, "eslint", null, rootPath)).toBe(
      "/project/eslint.js",
    );
    resolve.and.rejectWith(new Error("not installed"));
    await expectAsync(
      engineModule.resolveWithFallback(resolve, "eslint", null, rootPath, null, {
        useBuiltin: false,
      }),
    ).toBeRejected();
    await expectAsync(
      engineModule.resolveWithFallback(resolve, "other-library", null, rootPath),
    ).toBeRejected();
  });

  it("resolves a physical project library before a controlled global installation", async () => {
    installProjectFixture(rootPath, "eslint8");
    const globalPath = path.join(rootPath, "global");
    fs.mkdirSync(path.join(globalPath, "eslint"), { recursive: true });
    fs.writeFileSync(path.join(globalPath, "eslint", "index.js"), "module.exports = {};\n");
    expect(await engineModule.resolveInstalled("eslint", globalPath, rootPath)).toBe(
      path.join(rootPath, "node_modules", "eslint", "index.js"),
    );
    expect(await engineModule.resolveInstalled("eslint", globalPath, os.tmpdir())).toBe(
      path.join(globalPath, "eslint", "index.js"),
    );
  });

  it("surfaces a broken installed package instead of selecting a bundled replacement", async () => {
    fs.mkdirSync(path.join(rootPath, "node_modules", "eslint"), { recursive: true });
    fs.writeFileSync(
      path.join(rootPath, "node_modules", "eslint", "package.json"),
      '{"name":"eslint","main":"missing.js"}',
    );
    await expectAsync(
      engineModule.resolveWithFallback(engineModule.resolveInstalled, "eslint", null, rootPath),
    ).toBeRejected();
    await expectAsync(
      engineModule.createEngine(rootPath, rootPath, {
        ...settings,
        nodePath: path.join(rootPath, "node_modules"),
      }),
    ).toBeRejected();
  });

  it("uses the final matching rule customization and does not stack severity changes", () => {
    const customize = require("../lib/scan-task").customizeMessage;
    const message = { ruleId: "no-console", severity: 2, message: "Unexpected console." };
    expect(
      customize(message, {
        rulesCustomizations: [
          { rule: "*", severity: "warn" },
          { rule: "no-console", severity: "off" },
        ],
      }),
    ).toBeNull();
    expect(
      customize(message, {
        rulesCustomizations: [
          { rule: "*", severity: "downgrade" },
          { rule: "no-*", severity: "downgrade" },
        ],
      }).severity,
    ).toBe(1);
    expect(
      customize(
        { ...message, ruleId: "@typescript-eslint/no-console" },
        { rulesCustomizations: [{ rule: "*", severity: "info" }] },
      ).severity,
    ).toBe(0);
  });

  it("retains diagnostics and leaves saved files unchanged even with fix enabled in options", async () => {
    fs.writeFileSync(
      path.join(rootPath, "eslint.config.cjs"),
      'module.exports = [{ rules: { semi: ["error", "always"] } }];',
    );
    const report = await scan([
      {
        projectPath: rootPath,
        targetPaths: [path.join(rootPath, "one.js")],
        settings: { ...settings, options: { fix: true } },
      },
    ]);
    expect(report.errors).toEqual([]);
    expect(report.results[0].messages[0].ruleId).toBe("semi");
    expect(fs.readFileSync(path.join(rootPath, "one.js"), "utf8")).toBe("const value = 1\n");
  }, 30000);

  it("chooses each selected target's flat or legacy configuration independently", async () => {
    const flat = path.join(rootPath, "flat");
    const legacy = path.join(rootPath, "legacy");
    fs.mkdirSync(flat);
    fs.mkdirSync(legacy);
    fs.writeFileSync(
      path.join(flat, "eslint.config.cjs"),
      'module.exports = [{ rules: { semi: ["error", "always"] } }];',
    );
    fs.writeFileSync(
      path.join(legacy, ".eslintrc.json"),
      JSON.stringify({
        parserOptions: { ecmaVersion: 2021 },
        rules: { semi: ["error", "always"] },
      }),
    );
    fs.writeFileSync(path.join(flat, "a.js"), "const value = 1\n");
    fs.writeFileSync(path.join(legacy, "b.js"), "const value = 1\n");
    const report = await scan([{ projectPath: rootPath, targetPaths: [flat, legacy], settings }]);
    expect(report.errors).toEqual([]);
    expect(
      report.results
        .filter(({ filePath }) => /[ab]\.js$/.test(filePath))
        .map(({ messages }) => messages[0].ruleId),
    ).toEqual(["semi", "semi"]);
  }, 60000);

  it("silently skips missing configuration while preserving errors from other projects", async () => {
    const report = await scan([{ projectPath: rootPath, targetPaths: [rootPath], settings }]);
    expect(report.results).toEqual([]);
    expect(report.errors).toEqual([]);
  }, 30000);
});
