function cloneWorkspace(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createWorkspaceSaveQueue(writeWorkspace) {
  if (typeof writeWorkspace !== "function") throw new TypeError("writeWorkspace must be a function");

  let revision = 0;
  let tail = Promise.resolve();

  return {
    markChanged() {
      revision += 1;
      return revision;
    },

    async save(value) {
      const saveRevision = revision;
      const snapshot = cloneWorkspace(value);
      const request = tail.then(
        () => writeWorkspace(snapshot),
        () => writeWorkspace(snapshot)
      );
      tail = request.then(() => undefined, () => undefined);
      const result = await request;
      return {
        result,
        revision: saveRevision,
        current: saveRevision === revision
      };
    },

    idle() {
      return tail;
    },

    get revision() {
      return revision;
    }
  };
}
