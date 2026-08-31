const hints = new WeakMap();
const exitWarnings = new WeakSet();

// None of these report a failure: a project may perfectly well have no ESLint
// setup, and nothing the user asked for was refused. So they are hints, which
// autohide rather than waiting to be dismissed one box at a time.
//
// The server asks once per document, but every one of these conditions is a
// property of the session's project root and has a single remedy, so hint once
// per session and per condition. A restart gets a fresh session, and with it a
// fresh hint.
const hintOnce = (session, method, title, detail) => {
  if (session && typeof session === "object") {
    let seen = hints.get(session);
    if (!seen) hints.set(session, (seen = new Set()));
    if (seen.has(method)) return;
    seen.add(method);
  }
  lumine.notifications.addHint(title, { detail });
};

exports.handleServerRequest = async (method, params, { session } = {}) => {
  if (method === "eslint/openDoc") {
    if (params?.url) await lumine.shell.openExternal(params.url);
    return null;
  }
  if (method === "eslint/noConfig") {
    hintOnce(
      session,
      method,
      "ESLint configuration not found",
      params?.message || "Add an ESLint configuration file to this project.",
    );
    return null;
  }
  if (method === "eslint/noLibrary") {
    hintOnce(
      session,
      method,
      "ESLint library not found",
      "Install ESLint in the project, install it globally with the selected package manager, or configure Node Module Path.",
    );
    return null;
  }
  // Probing is deliberately silent: failure means this language should not be
  // validated, not that the user's project is broken.
  if (method === "eslint/probeFailed") return null;
  return null;
};

exports.handleServerNotification = (method, params, { session } = {}) => {
  if (method === "eslint/showOutputChannel") {
    hintOnce(
      session,
      method,
      "ESLint has server output",
      "Open the IDE Client server list to inspect the ESLint Language Server log.",
    );
  } else if (method === "eslint/exitCalled") {
    // vscode-jsonrpc's automatic parameter structure wraps the tuple in one
    // more array on the wire. Keep accepting the flat shape used by older or
    // independently packaged servers as well.
    const payload =
      Array.isArray(params) && params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const [code, stack] = Array.isArray(payload) ? payload : [];

    // The ESLint server intercepts every process.exit(), including the three
    // calls made by its own orderly LSP shutdown. They are not plugin failures.
    if (["stopping", "stopped"].includes(session?.state)) return;

    // A real intercepted exit ends this server generation. One actionable
    // report is enough even if several exit paths run before the process dies.
    if (session && typeof session === "object") {
      if (exitWarnings.has(session)) return;
      exitWarnings.add(session);
    }
    lumine.notifications.addError("ESLint Language Server is stopping unexpectedly", {
      detail: [`Exit code: ${code ?? "unknown"}`, stack].filter(Boolean).join("\n\n"),
      dismissable: true,
    });
  }
};
