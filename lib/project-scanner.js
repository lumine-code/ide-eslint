const { Task } = require("lumine");
const fs = require("fs");
const path = require("path");
const picomatch = require("picomatch");
const { containsPath } = require("./engine");

class ProjectScanner {
  constructor(context) {
    this.context = context;
    this.scanId = 0;
    this.task = null;
    this.busyProvider = null;
    this.scanning = false;
  }

  getSelectedScanItems() {
    const roots = lumine.project.getPaths().sort((left, right) => right.length - left.length);
    const items = new Map();
    for (const targetPath of new Set(this.context.getTreeView()?.selectedPaths?.() || [])) {
      if (!targetPath || !fs.existsSync(targetPath)) continue;
      const projectPath = roots.find((root) => containsPath(root, targetPath));
      if (!projectPath) continue;
      if (!items.has(projectPath)) items.set(projectPath, { projectPath, targetPaths: [] });
      items.get(projectPath).targetPaths.push(targetPath);
    }
    return [...items.values()];
  }

  runSelected() {
    const items = this.getSelectedScanItems();
    if (!items.length) {
      lumine.notifications.addWarning("ESLint selected scan skipped", {
        detail: "Select one or more files or folders in the tree view first.",
        dismissable: true,
      });
      return;
    }
    this.run(items);
  }

  run(
    scanItems = lumine.project
      .getPaths()
      .map((projectPath) => ({ projectPath, targetPaths: [projectPath] })),
  ) {
    if (this.scanning || !scanItems.length) return;
    if (!this.context.hasDelegate()) {
      lumine.notifications.addWarning("ESLint project scan unavailable", {
        detail: "Enable the linter package to display project scan results.",
        dismissable: true,
      });
      return;
    }
    this.scanning = true;
    const scanId = ++this.scanId;
    this.busyProvider = this.context.getBusySignal()?.create?.() || null;
    this.busyProvider?.add("Scanning project with ESLint");
    const items = scanItems.map((item) => ({
      ...item,
      settings: this.context.getSettings(item.projectPath, item.targetPaths[0]),
    }));
    let receivedResults = false;
    this.task = Task.once(path.join(__dirname, "scan-task.js"), items, () => {
      if (scanId !== this.scanId || receivedResults) return;
      this.context.publish([]);
      lumine.notifications.addWarning("ESLint project scan failed", {
        detail: "The scan task finished without returning results.",
        dismissable: true,
      });
      this.finish();
    });
    this.task.on("ide-eslint:project-scan", async ({ results = [], errors = [] } = {}) => {
      if (scanId !== this.scanId) return;
      receivedResults = true;
      try {
        const messages = [];
        for (const result of results) {
          if (await this.isIgnored(result.filePath)) continue;
          messages.push(
            ...result.messages.map((message) =>
              this.convertMessage(result.filePath, message, result.shortenToSingleLine),
            ),
          );
        }
        if (scanId !== this.scanId) return;
        this.context.publish(messages);
        for (const error of errors) {
          lumine.notifications.addWarning("ESLint project scan failed", {
            detail: [error.projectPath, error.message].filter(Boolean).join("\n\n"),
            dismissable: true,
          });
        }
      } catch (error) {
        if (scanId !== this.scanId) return;
        lumine.notifications.addWarning("ESLint project scan failed", {
          detail: String(error.message || error),
          dismissable: true,
        });
      } finally {
        if (scanId === this.scanId) this.finish();
      }
    });
  }

  async isIgnored(filePath) {
    if (lumine.config.get("core.excludeVcsIgnoredPaths")) {
      const repository = await lumine.project.repositoryForPath(filePath);
      if (repository) {
        await repository.ensureStatusSnapshot();
        if (repository.isPathIgnoredCached(filePath)) return true;
      }
    }
    const ignoreGlob = lumine.config.get("linter.ignoreGlob");
    return Boolean(ignoreGlob && picomatch.isMatch(filePath.replace(/\\/g, "/"), ignoreGlob));
  }

  convertMessage(filePath, message, shortenToSingleLine = false) {
    const startRow = Math.max(0, (message.line || 1) - 1);
    const startColumn = Math.max(0, (message.column || 1) - 1);
    const endRow =
      typeof message.endLine === "number" ? Math.max(0, message.endLine - 1) : startRow;
    const endColumn =
      typeof message.endColumn === "number" ? Math.max(0, message.endColumn - 1) : startColumn;
    return {
      severity: message.severity === 0 ? "info" : message.severity === 1 ? "warning" : "error",
      excerpt: `${message.ruleId || "fatal"}: ${message.message}`,
      location: {
        file: filePath,
        position: [
          [startRow, startColumn],
          shortenToSingleLine && endRow !== startRow
            ? [startRow, startColumn]
            : [endRow, endColumn],
        ],
      },
    };
  }

  finish() {
    this.task = null;
    this.scanning = false;
    this.busyProvider?.dispose();
    this.busyProvider = null;
  }

  dispose() {
    this.scanId++;
    this.task?.terminate?.();
    this.finish();
  }
}

module.exports = ProjectScanner;
