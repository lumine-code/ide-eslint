const { createEngine } = require("../../lib/engine");

(async () => {
  const rootPath = process.argv[2];
  const settings = JSON.parse(process.argv[3]);
  const engine = await createEngine(rootPath, rootPath, settings);
  const results = await engine.lintFiles([rootPath]);
  process.stdout.write(JSON.stringify({ version: engine.constructor.version, results }));
})().catch((error) => {
  process.stderr.write(error.stack);
  process.exitCode = 1;
});
