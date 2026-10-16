describe("ide-eslint scan availability", () => {
  it("reads roots, service and passive tree selection without starting a scan", async () => {
    const main = (await lumine.packages.activatePackage("ide-eslint")).mainModule;

    jasmine.attachToDOM(lumine.workspace.getElement());
    const target = document.createElement("div");
    target.className = "tree-view";
    lumine.workspace.getElement().appendChild(target);
    const available = (action) => lumine.commands.canDispatch(target, "ide-eslint:" + action);
    const roots = spyOn(lumine.project, "getPaths").and.returnValue([]);
    main.indieDelegate = null;
    expect(available("lint-projects")).toBe(false);
    main.indieDelegate = {};
    roots.and.returnValue(["/project"]);
    expect(available("lint-projects")).toBe(true);
    main.treeView = {
      getSelectionSnapshot: () => ({ count: 0 }),
      selectedPaths: jasmine.createSpy("initialize tree"),
    };
    expect(available("lint-selected")).toBe(false);
    main.treeView.getSelectionSnapshot = () => ({ count: 1 });
    expect(available("lint-selected")).toBe(true);
    expect(main.treeView.selectedPaths).not.toHaveBeenCalled();
    main.scanner = { scanning: true, dispose() {} };
    expect(available("lint-projects")).toBe(false);
    main.scanner = null;
    main.indieDelegate = null;
    target.remove();
    await lumine.packages.deactivatePackage("ide-eslint");
  });
});
