if (!("navigator" in globalThis)) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Node.js" },
  });
}
