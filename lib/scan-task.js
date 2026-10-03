/* global emit -- provided by the Task handler runtime */
const { createEngine } = require("./engine");
const fs = require("fs");

function isNoConfigError(error) {
  const message = String(error.message || error);
  return (
    message.includes("No ESLint configuration found") ||
    message.includes("no-config-found") ||
    message.includes("Could not find config file")
  );
}

function customizeMessage(message, settings) {
  let severity = message.severity;
  let override;
  for (const customization of settings.rulesCustomizations || []) {
    if (!message.ruleId) continue;
    const pattern = customization.rule || "*";
    const negated = pattern.startsWith("!");
    const matches = new RegExp(
      `^${(negated ? pattern.slice(1) : pattern).replace(/\*/g, ".*")}$`,
    ).test(message.ruleId);
    if (negated ? matches : !matches) continue;
    if (customization.fixability === "fixable" && !message.fix) continue;
    if (customization.fixability === "unfixable" && message.fix) continue;
    override = customization.severity;
  }
  switch (override) {
    case "off":
      return null;
    case "info":
      severity = 0;
      break;
    case "warn":
      severity = 1;
      break;
    case "error":
      severity = 2;
      break;
    case "downgrade":
      severity = Math.max(0, severity - 1);
      break;
    case "upgrade":
      severity = Math.min(2, severity + 1);
      break;
  }
  if (settings.quiet && severity === 1) return null;
  return { ...message, severity };
}

async function scan(scanItems) {
  const results = new Map();
  const errors = [];
  for (const { projectPath, targetPaths, settings } of scanItems) {
    for (const targetPath of targetPaths) {
      try {
        const engine = await createEngine(projectPath, targetPath, settings);
        const reports = await engine.lintFiles([targetPath]);
        for (const report of reports) {
          const key =
            process.platform === "win32" ? report.filePath.toLowerCase() : report.filePath;
          let lines;
          if (
            settings.shortenToSingleLine &&
            report.messages.some((message) => message.endLine > message.line)
          ) {
            lines = fs.readFileSync(report.filePath, "utf8").split(/\r?\n/);
          }
          results.set(key, {
            filePath: report.filePath,
            messages: report.messages
              .map((message) => {
                if (lines && message.endLine > message.line)
                  message = {
                    ...message,
                    endLine: message.line,
                    endColumn: (lines[message.line - 1]?.length || 0) + 1,
                  };
                return customizeMessage(message, settings);
              })
              .filter(Boolean),
            shortenToSingleLine: settings.shortenToSingleLine,
          });
        }
      } catch (error) {
        if (isNoConfigError(error)) continue;
        errors.push({ projectPath, message: String(error.message || error) });
      }
    }
  }
  return { results: [...results.values()], errors };
}

module.exports = function (scanItems) {
  const done = this.async();
  scan(scanItems)
    .then((report) => emit("ide-eslint:project-scan", report))
    .catch((error) =>
      emit("ide-eslint:project-scan", {
        results: [],
        errors: [{ message: String(error.message || error) }],
      }),
    )
    .then(done);
};
module.exports.scan = scan;
module.exports.customizeMessage = customizeMessage;
