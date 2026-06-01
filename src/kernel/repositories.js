import { deepCopy } from "../data/schema.js";

/**
 * Small repository implementation for tests, examples, and in-memory frontend
 * state. It deep-copies values on read/write to avoid accidental mutation.
 */
export class InMemoryRepository {
  /**
   * @param {object[]} items - Items to index by id.
   * @param {object} options
   * @param {string} options.idKey - Field name used as the item id.
   */
  constructor(items = [], { idKey = "id" } = {}) {
    this._idKey = idKey;
    this._items = new Map();
    items.forEach((item) => {
      this._items.set(item[idKey], deepCopy(item));
    });
  }

  /**
   * Return one item by id, or null when the item does not exist.
   */
  async getById(id) {
    const item = this._items.get(id);
    return item === undefined ? null : deepCopy(item);
  }

  /**
   * Return all items in this repository.
   */
  async list() {
    return Array.from(this._items.values()).map((item) => deepCopy(item));
  }
}

/**
 * Browser repository backed by a localStorage entry containing a JSON array.
 */
export class LocalStorageJsonArrayRepository {
  /**
   * @param {object} options
   * @param {string} options.storageKey - localStorage key containing a JSON array.
   * @param {?Storage} options.storage - Optional storage object for tests.
   * @param {string} options.idKey - Field name used as the item id.
   */
  constructor({ storageKey, storage = null, idKey = "id" } = {}) {
    if (!storageKey) {
      throw new Error("LocalStorageJsonArrayRepository requires storageKey");
    }
    this._storageKey = storageKey;
    this._storage = storage;
    this._idKey = idKey;
  }

  /**
   * Return one item by id, or null when the item does not exist.
   */
  async getById(id) {
    const item = (await this.list()).find((candidate) => candidate[this._idKey] === id);
    return item ?? null;
  }

  /**
   * Read and parse every item from the configured localStorage key.
   */
  async list() {
    const storage = this._resolveStorage();
    const raw = storage.getItem(this._storageKey);
    if (raw === null || raw === "") return [];
    return JSON.parse(raw);
  }

  /**
   * Resolve the storage object lazily so this class can be imported in Node.
   */
  _resolveStorage() {
    if (this._storage !== null) return this._storage;
    if (globalThis.localStorage === undefined) {
      throw new Error("localStorage is not available in this environment");
    }
    return globalThis.localStorage;
  }
}

/**
 * localStorage repository for geometry entity records.
 */
export class LocalStorageGeometryRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "GeometryEntity", ...options });
  }
}

/**
 * localStorage repository for process flow instance records.
 */
export class LocalStorageProcessFlowInstanceRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "processFlowInstances", ...options });
  }
}

/**
 * localStorage repository for process flow template records.
 */
export class LocalStorageProcessFlowTemplateRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "processFlowTemplates", ...options });
  }
}

/**
 * localStorage repository for process step template records.
 */
export class LocalStorageProcessStepRepository extends LocalStorageJsonArrayRepository {
  constructor(options = {}) {
    super({ storageKey: "processStepTemplates", ...options });
  }
}
