const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { LiveLspClient, fileUri, position } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return { adapter, disposable };
};

const eslintNodePath = path.dirname(path.dirname(require.resolve("eslint/package.json")));

const offsetAt = (text, point) => {
  const lines = text.split("\n");
  return (
    lines.slice(0, point.line).reduce((total, line) => total + line.length + 1, 0) + point.character
  );
};

const applyTextEdits = (text, edits) =>
  [...edits]
    .sort((left, right) => offsetAt(text, right.range.start) - offsetAt(text, left.range.start))
    .reduce((result, edit) => {
      const start = offsetAt(result, edit.range.start);
      const end = offsetAt(result, edit.range.end);
      return `${result.slice(0, start)}${edit.newText}${result.slice(end)}`;
    }, text);

describe("ide-eslint bundled server", () => {
  let adapter, client, disposable, rootPath;
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-eslint");
    lumine.config.set("ide-eslint.nodePath", eslintNodePath);
    ({ adapter, disposable } = registerAdapter());
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-eslint-live-"));
    fs.writeFileSync(
      path.join(rootPath, "eslint.config.mjs"),
      [
        "export default [{",
        '  files: ["**/*.{js,jsx,ts,tsx}"],',
        "  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },",
        '  rules: { semi: ["error", "always"], quotes: ["error", "double"], "no-console": "warn" },',
        "}];",
        "",
      ].join("\n"),
    );
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    try {
      await fs.promises.rm(rootPath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (error) {
      if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    }
    await lumine.packages.deactivatePackage("ide-eslint");
  });

  it("exercises diagnostics, every command family, code actions, formatting and lifecycle", async () => {
    const filePath = path.join(rootPath, "fixture.js");
    const source = ["const message = 'hello'", "console.log(message)", ""].join("\n");
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    const { capabilities } = await client.start();

    expect(capabilities.diagnosticProvider.identifier).toBe("eslint");
    expect(capabilities.codeActionProvider.codeActionKinds).toEqual([
      "quickfix",
      "source.fixAll.eslint",
    ]);
    expect(capabilities.executeCommandProvider.commands).toEqual([
      "eslint.applySingleFix",
      "eslint.applySuggestion",
      "eslint.applySameFixes",
      "eslint.applyAllFixes",
      "eslint.applyDisableLine",
      "eslint.applyDisableFile",
      "eslint.openRuleDoc",
    ]);

    client.open(uri, "javascript", source);
    const diagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(diagnostics.kind).toBe("full");
    expect(diagnostics.items.map(({ code }) => code)).toEqual([
      "quotes",
      "semi",
      "no-console",
      "semi",
    ]);
    expect(diagnostics.items.every(({ codeDescription }) => codeDescription.href)).toBe(true);
    await client.waitFor(
      () => client.registrations.some(({ method }) => method === "textDocument/formatting"),
      "formatter registration",
    );
    expect(client.messages("eslint/status").at(-1).params.state).toBe(1);

    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: position(0, 0), end: position(1, 30) },
      context: { diagnostics: diagnostics.items },
    });
    const commands = actions.map(({ command }) => command?.command).filter(Boolean);
    for (const command of [
      "eslint.applySingleFix",
      "eslint.applySuggestion",
      "eslint.applySameFixes",
      "eslint.applyDisableLine",
      "eslint.applyDisableFile",
      "eslint.openRuleDoc",
    ]) {
      expect(commands).toContain(command);
    }
    expect(commands).toContain("eslint.applyAllFixes");

    spyOn(lumine.shell, "openExternal").and.returnValue(Promise.resolve());
    for (const command of [
      "eslint.applySingleFix",
      "eslint.applySuggestion",
      "eslint.applySameFixes",
      "eslint.applyAllFixes",
      "eslint.applyDisableLine",
      "eslint.applyDisableFile",
      "eslint.openRuleDoc",
    ]) {
      const action = actions.find((candidate) => candidate.command?.command === command);
      await client.request("workspace/executeCommand", {
        command,
        arguments: action.command.arguments,
      });
    }
    expect(client.appliedEdits.length).toBe(6);
    expect(client.appliedEdits.every(({ edit }) => edit.documentChanges.length > 0)).toBe(true);
    await client.waitFor(() => lumine.shell.openExternal.calls.any(), "rule documentation request");
    expect(lumine.shell.openExternal.calls.mostRecent().args[0]).toMatch(
      /^https:\/\/eslint\.org\/docs\/latest\/rules\//,
    );

    const fixAll = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: position(0, 0), end: position(0, 0) },
      context: { diagnostics: [], only: ["source.fixAll.eslint"] },
    });
    expect(fixAll[0].kind).toBe("source.fixAll.eslint");
    expect(fixAll[0].edit.documentChanges[0].edits.length).toBeGreaterThan(0);

    const formatting = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(formatting.length).toBeGreaterThan(0);
    expect(applyTextEdits(source, formatting)).toBe(
      ['const message = "hello";', "console.log(message);", ""].join("\n"),
    );

    const fixed = ['const message = "hello";', "void message;", ""].join("\n");
    client.change(uri, fixed);
    const cleared = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(cleared.items).toEqual([]);

    client.closeDocument(uri);
    const closed = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(closed.items).toEqual([]);
  });

  it("validates every advertised language mode and applies live configuration changes", async () => {
    const fixtures = [
      ["fixture.js", "javascript"],
      ["fixture.jsx", "javascriptreact"],
      ["fixture.ts", "typescript"],
      ["fixture.tsx", "typescriptreact"],
    ];
    await client.start();
    for (const [name, languageId] of fixtures) {
      const filePath = path.join(rootPath, name);
      const source = "const value = 1\n";
      fs.writeFileSync(filePath, source);
      const uri = fileUri(filePath);
      client.open(uri, languageId, source);
      const report = await client.request("textDocument/diagnostic", {
        textDocument: { uri },
      });
      expect(report.items.map(({ code }) => code)).toContain("semi");
    }

    await client.waitFor(
      () => client.registrations.some(({ method }) => method === "textDocument/formatting"),
      "formatter registration",
    );
    lumine.config.set("ide-eslint.features.format", false);
    client.notify("workspace/didChangeConfiguration", { settings: adapter.getSettings() });
    await client.waitFor(
      () => !client.registrations.some(({ method }) => method === "textDocument/formatting"),
      "formatter unregistration",
    );
    await client.waitFor(() => client.diagnosticRefreshes > 0, "diagnostic refresh");

    lumine.config.set("ide-eslint.features.diagnostics", false);
    client.notify("workspace/didChangeConfiguration", { settings: adapter.getSettings() });
    const uri = fileUri(path.join(rootPath, "fixture.js"));
    const disabled = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(disabled.items).toEqual([]);
  });
});
