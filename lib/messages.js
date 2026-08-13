const warnings = new WeakMap();

// The server asks once per document, but every one of these conditions is a
// property of the session's project root and has a single remedy, so warn once
// per session and per condition. A restart gets a fresh session, and with it a
// fresh warning.
const warnOnce = (session, method, title, detail) => {
  if (session && typeof session === "object") {
    let seen = warnings.get(session);
    if (!seen) warnings.set(session, (seen = new Set()));
    if (seen.has(method)) return;
    seen.add(method);
  }
  lumine.notifications.addWarning(title, { detail, dismissable: true });
};

exports.handleServerRequest = async (method, params, { session } = {}) => {
  if (method === "eslint/openDoc") {
    if (params?.url) await lumine.shell.openExternal(params.url);
    return null;
  }
  if (method === "eslint/noConfig") {
    warnOnce(
      session,
      method,
      "ESLint configuration not found",
      params?.message || "Add an ESLint configuration file to this project.",
    );
    return null;
  }
  if (method === "eslint/noLibrary") {
    warnOnce(
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
    warnOnce(
      session,
      method,
      "ESLint has server output",
      "Open the IDE Client server list to inspect the ESLint Language Server log.",
    );
  } else if (method === "eslint/exitCalled") {
    const [code, stack] = Array.isArray(params) ? params : [];
    lumine.notifications.addError("An ESLint plugin tried to stop the language server", {
      detail: [`Exit code: ${code ?? "unknown"}`, stack].filter(Boolean).join("\n\n"),
      dismissable: true,
    });
  }
};
