import { deepCopy } from "../data/schema.js";

export class InMemoryRepository {
  constructor(items = [], { idKey = "id" } = {}) {
    this._idKey = idKey;
    this._items = new Map();
    items.forEach((item) => {
      this._items.set(item[idKey], deepCopy(item));
    });
  }

  async getById(id) {
    const item = this._items.get(id);
    return item === undefined ? null : deepCopy(item);
  }

  async list() {
    return Array.from(this._items.values()).map((item) => deepCopy(item));
  }
}

export class LocalStorageJsonArrayRepository {
  constructor({ storageKey, storage = null, idKey = "id" } = {}) {
    if (!storageKey) {
      throw new Error("LocalStorageJsonArrayRepository requires storageKey");
    }
    this._storageKey = storageKey;
    this._storage = storage;
    this._idKey = idKey;
  }

  async getById(id) {
    const item = (await this.list()).find((candidate) => candidate[this._idKey] === id);
    return item ?? null;
  }

  async list() {
    const storage = this._resolveStorage();
    const raw = storage.getItem(this._storageKey);
    if (raw === null || raw === "") return [];
    return JSON.parse(raw);
  }

  _resolveStorage() {
    if (this._storage !== null) return this._storage;
    if (globalThis.localStorage === undefined) {
      throw new Error("localStorage is not available in this environment");
    }
    return globalThis.localStorage;
  }
}

export class LocalStorageGeometryRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "geometryEntities", ...options });
  }
}

export class LocalStorageProcessFlowInstanceRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "processFlowInstances", ...options });
  }
}

export class LocalStorageProcessFlowTemplateRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "processFlowTemplates", ...options });
  }
}

export class LocalStorageProcessStepRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "processStepTemplates", ...options });
  }
}
