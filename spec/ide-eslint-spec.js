const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const main = require("../lib/main");
const { resolveServer, managedServer } = require("../lib/server");

const registerAdapter = (overrides = {}) => {
  let adapter;
  const service = {
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
    ...overrides,
  };
  const disposable = main.consumeIdeClient(service);
  return { adapter, disposable, service };
};

describe("ide-eslint server resolution", () => {
  it("prefers the configured path", async () => {
    const launch = await resolveServer(process.execPath);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["--stdio"]);
  });

  it("falls back to the bundled server module", async () => {
    const launch = await resolveServer("");
    expect(launch.command).toBe(process.execPath);
    expect(fs.existsSync(launch.args[0])).toBe(true);
    expect(launch.args[1]).toBe("--stdio");
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("prefers a managed install over the bundled server", async () => {
    const managed = { modulePath: "/managed/server.js", version: "9.9.9" };
    const launch = await resolveServer("", managed);
    expect(launch.args[0]).toBe(managed.modulePath);
    // Reported in the session details, so which copy is running is visible.
    expect(launch.version).toBe("9.9.9");
    expect((await resolveServer(process.execPath, managed)).command).toBe(process.execPath);
  });

  it("declares the bundled floor so uninstall falls back", () => {
    // The dependency is always present, so removing the managed copy returns to
    // a working server rather than to none.
    expect(managedServer.source).toBe("npm");
    expect(managedServer.bundled).toBe(true);
    expect(managedServer.module).toContain("node_modules/");
  });
});

describe("ide-eslint adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-eslint");
    ({ adapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-eslint");
  });

  it("registers every JavaScript and TypeScript grammar with its protocol language ID", () => {
    expect(adapter.id).toBe("ide-eslint");
    expect(adapter.grammarScopes).toEqual([
      "source.js",
      "source.jsx",
      "source.es6",
      "source.js.jsx",
      "source.babel",
      "source.js-semantic",
      "source.ts",
      "source.tsx",
    ]);
    expect(adapter.languageIdForScope("source.js")).toBe("javascript");
    expect(adapter.languageIdForScope("source.es6")).toBe("javascript");
    expect(adapter.languageIdForScope("source.jsx")).toBe("javascriptreact");
    expect(adapter.languageIdForScope("source.babel")).toBe("javascriptreact");
    expect(adapter.languageIdForScope("source.ts")).toBe("typescript");
    expect(adapter.languageIdForScope("source.tsx")).toBe("typescriptreact");
    expect(adapter.sessionScope).toBe("project-root");
    expect(adapter.settingsKeyPaths).toEqual(["ide-eslint"]);
  });

  it("returns the complete compatibility settings requested under an empty section", () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-eslint-settings-"));
    const uri = pathToFileURL(path.join(rootPath, "fixture.js")).href;
    lumine.config.set("ide-eslint.nodePath", "vendor/modules");
    lumine.config.set("ide-eslint.run", "onSave");
    lumine.config.set("ide-eslint.quiet", true);
    lumine.config.set("ide-eslint.problems.shortenToSingleLine", true);
    lumine.config.set("ide-eslint.rulesCustomizations", [
      { rule: "no-*", severity: "warn", fixability: "fixable" },
    ]);

    const settings = adapter.getWorkspaceConfiguration("", uri);
    expect(settings.validate).toBe("on");
    expect(settings.packageManager).toBe("npm");
    expect(settings.useESLintClass).toBe(true);
    expect(settings.useFlatConfig).toBe(true);
    expect(settings.experimental).toEqual({ useFlatConfig: false });
    expect(settings.nodePath).toBe("vendor/modules");
    expect(settings.run).toBe("onSave");
    expect(settings.quiet).toBe(true);
    expect(settings.problems.shortenToSingleLine).toBe(true);
    expect(settings.rulesCustomizations[0].rule).toBe("no-*");
    expect(settings.rulesCustomizations[0].fixable).toBe(true);
    expect(settings.rulesCustomizations[0].fixability).toBeUndefined();
    expect(settings.workingDirectory).toEqual({ mode: "location" });
    expect(settings.workspaceFolder.uri).toBe(pathToFileURL(rootPath).href);
    expect(settings.codeAction.disableRuleComment).toEqual({
      enable: true,
      location: "separateLine",
      commentStyle: "line",
    });
    expect(settings.codeAction.showDocumentation.enable).toBe(true);
    expect(adapter.getWorkspaceConfiguration("eslint", uri)).toEqual(settings);
    expect(adapter.getWorkspaceConfiguration("unknown", uri)).toBeUndefined();
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  it("uses explicit null and complete nested objects for server-sensitive defaults", () => {
    const settings = adapter.getSettings();
    expect(settings.nodePath).toBeNull();
    expect(settings.options).toEqual({});
    expect(settings.rulesCustomizations).toEqual([]);
    expect(settings.codeActionOnSave).toEqual({ mode: "all" });
    expect(settings.problems).toEqual({ shortenToSingleLine: false });
  });

  it("turns protocol work off through the three advertised feature switches", () => {
    lumine.config.set("ide-eslint.features.diagnostics", false);
    lumine.config.set("ide-eslint.features.format", false);
    lumine.config.set("ide-eslint.features.codeActions", false);
    const settings = adapter.getSettings();
    expect(settings.validate).toBe("off");
    expect(settings.format).toBe(false);
    expect(settings.codeAction.disableRuleComment.enable).toBe(false);
    expect(settings.codeAction.showDocumentation.enable).toBe(false);
    expect(Object.keys(require("../package.json").configSchema.features.properties)).toEqual([
      "diagnostics",
      "format",
      "codeActions",
    ]);
  });

  it("declares only the executable setting as restart-required", () => {
    expect(adapter.restartKeyPaths).toEqual(["ide-eslint.serverPath"]);
  });
});

describe("ide-eslint protocol extensions", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-eslint");
    ({ adapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-eslint");
  });

  it("opens rule documentation requested by the server", async () => {
    spyOn(lumine.shell, "openExternal").and.returnValue(Promise.resolve());
    const url = "https://eslint.org/docs/latest/rules/semi";
    expect(
      await adapter.handleServerRequest("eslint/openDoc", { url }, { session: {} }),
    ).toBeNull();
    expect(lumine.shell.openExternal).toHaveBeenCalledOnceWith(url);
  });

  it("handles missing setup and failed probes without rejecting the server", async () => {
    const session = {};
    spyOn(lumine.notifications, "addHint");
    const missingConfig = (uri) => ({ message: "No configuration found", document: { uri } });
    // The server asks once per document; the remedy is the same for all of
    // them, so each condition is hinted at once for the whole session.
    await adapter.handleServerRequest("eslint/noConfig", missingConfig("file:///a.js"), {
      session,
    });
    await adapter.handleServerRequest("eslint/noConfig", missingConfig("file:///b.js"), {
      session,
    });
    for (const uri of ["file:///a.js", "file:///b.js", "file:///c.js"]) {
      await adapter.handleServerRequest("eslint/noLibrary", { source: { uri } }, { session });
    }
    expect(
      await adapter.handleServerRequest(
        "eslint/probeFailed",
        { textDocument: { uri: "file:///fixture.js" } },
        { session },
      ),
    ).toBeNull();
    // Neither condition is a failure, so both arrive as autohiding hints
    // rather than as a dismissable box per file.
    expect(lumine.notifications.addHint.calls.count()).toBe(2);
    expect(lumine.notifications.addHint.calls.first().args[1].dismissable).toBeUndefined();
    // A restarted server is a new session, and hints again.
    await adapter.handleServerRequest(
      "eslint/noLibrary",
      { source: { uri: "file:///a.js" } },
      { session: {} },
    );
    expect(lumine.notifications.addHint.calls.count()).toBe(3);
  });

  it("surfaces output once while accepting status notifications", () => {
    spyOn(lumine.notifications, "addHint");
    const session = {};
    adapter.handleServerNotification("eslint/status", { state: 1 }, { session });
    adapter.handleServerNotification("eslint/showOutputChannel", undefined, { session });
    adapter.handleServerNotification("eslint/showOutputChannel", undefined, { session });
    expect(lumine.notifications.addHint.calls.count()).toBe(1);
  });

  it("reports an intercepted exit once per live session and unwraps both payload shapes", () => {
    spyOn(lumine.notifications, "addError");
    const running = { state: "running" };
    adapter.handleServerNotification("eslint/exitCalled", [[0, "Error: stack"]], {
      session: running,
    });
    adapter.handleServerNotification("eslint/exitCalled", [[0, "duplicate stack"]], {
      session: running,
    });

    expect(lumine.notifications.addError.calls.count()).toBe(1);
    const [title, options] = lumine.notifications.addError.calls.mostRecent().args;
    expect(title).toBe("ESLint Language Server is stopping unexpectedly");
    expect(options.detail).toBe("Exit code: 0\n\nError: stack");
    expect(options.dismissable).toBe(true);

    adapter.handleServerNotification("eslint/exitCalled", [2, "plugin stack"], {
      session: { state: "starting" },
    });
    expect(lumine.notifications.addError.calls.count()).toBe(2);
    expect(lumine.notifications.addError.calls.mostRecent().args[1].detail).toBe(
      "Exit code: 2\n\nplugin stack",
    );
  });

  it("ignores the server's own intercepted exits during orderly shutdown", () => {
    spyOn(lumine.notifications, "addError");
    for (const state of ["stopping", "stopped"]) {
      adapter.handleServerNotification("eslint/exitCalled", [[0, "framework stack"]], {
        session: { state },
      });
    }
    expect(lumine.notifications.addError).not.toHaveBeenCalled();
  });
});

describe("ide-eslint feature contracts", () => {
  const features = ["diagnostics", "format", "codeActions"];
  const definitions = require("../package.json").configSchema.features.properties;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-eslint");
  });

  afterEach(async () => {
    for (const feature of features) lumine.config.unset(`ide-eslint.features.${feature}`);
    await lumine.packages.deactivatePackage("ide-eslint");
  });

  for (const feature of features) {
    it(`exposes ${feature} as an independent enabled-by-default switch`, () => {
      expect(definitions[feature].type).toBe("boolean");
      expect(definitions[feature].default).toBe(true);
      const keyPath = `ide-eslint.features.${feature}`;
      expect(lumine.config.get(keyPath)).toBe(true);
      lumine.config.set(keyPath, false);
      expect(lumine.config.get(keyPath)).toBe(false);
    });
  }
});
