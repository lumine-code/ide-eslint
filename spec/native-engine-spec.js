const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Task } = require("lumine");

describe("ESLint native scan engines", () => {
  let root, engine, loader;
  const settings = {
    configurationMode: "flat",
    workingDirectory: "location",
    packageManager: "npm",
    useBuiltin: false,
    options: {},
  };

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-eslint");
    engine = require("../lib/engine");
    loader = require("../lib/engine-loader");
    root = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-native-"));
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("ide-eslint");
    fs.rmSync(root, { recursive: true, force: true });
  });

  function installEngine(source) {
    const directory = path.join(root, "node_modules", "eslint");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "eslint",
        type: "module",
        main: "./engine # percent %.mjs",
      }),
    );
    const entry = path.join(directory, "engine # percent %.mjs");
    fs.writeFileSync(entry, source);
    return entry;
  }

  it("loads a project ESM engine with top-level await once for concurrent scans", async () => {
    const entry = installEngine(`
      import path from "node:path";
      await new Promise((resolve) => setTimeout(resolve, 30));
      let constructed = 0;
      export class ESLint {
        static version = "native-esm";
        constructor(options) { this.options = options; this.id = ++constructed; }
        async lintFiles() {
          return [{ filePath: path.join(this.options.cwd, "one.js"), messages: [{
            line: 1, column: 1, severity: 2, ruleId: "native-rule", message: "ESM engine ran"
          }] }];
        }
      }
    `);
    const [first, second] = await Promise.all([
      engine.createEngine(root, root, settings),
      engine.createEngine(root, root, settings),
    ]);
    expect(first.constructor).toBe(second.constructor);
    expect([first.id, second.id]).toEqual([1, 2]);
    expect(first.options.cwd).toBe(root);
    expect(first.options.fix).toBe(false);
    expect((await loader.loadLibrary(entry)).ESLint).toBe(first.constructor);
    expect((await first.lintFiles())[0].messages[0].ruleId).toBe("native-rule");
  });

  it("runs the async project engine through the actual Task scan worker", async () => {
    installEngine(`
      import path from "node:path";
      await new Promise((resolve) => setTimeout(resolve, 30));
      export class ESLint {
        constructor(options) { this.options = options; }
        async lintFiles() {
          return [{ filePath: path.join(this.options.cwd, "one.js"), messages: [{
            line: 1, column: 1, severity: 2, ruleId: "native-rule", message: "ESM worker ran"
          }] }];
        }
      }
    `);
    const report = await new Promise((resolve, reject) => {
      let received = false;
      const task = Task.once(
        path.join(__dirname, "..", "lib", "scan-task.js"),
        [
          {
            projectPath: root,
            targetPaths: [root],
            settings,
          },
        ],
        () => {
          if (!received) reject(new Error("Scan worker exited without a report"));
        },
      );
      task.on("ide-eslint:project-scan", (result) => {
        received = true;
        resolve(result);
      });
    });
    expect(report.errors).toEqual([]);
    expect(report.results[0].filePath).toBe(path.join(root, "one.js"));
    expect(report.results[0].messages[0].ruleId).toBe("native-rule");
  }, 30000);

  it("keeps CommonJS engine identity and retries an entry installed after a load failure", async () => {
    const entry = path.join(root, "late.cjs");
    await expectAsync(loader.loadLibrary(entry)).toBeRejected();
    fs.writeFileSync(entry, "module.exports = { ESLint: class ESLint {} };\n");
    expect(await loader.loadLibrary(entry)).toBe(require(entry));
  });

  it("surfaces a broken project engine instead of replacing it with the bundled engine", async () => {
    installEngine('throw new Error("Project ESLint failed to initialize");\n');
    await expectAsync(
      engine.createEngine(root, root, { ...settings, useBuiltin: true }),
    ).toBeRejectedWithError("Project ESLint failed to initialize");
  });
});
