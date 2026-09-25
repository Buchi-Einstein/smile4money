import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryQueueStore } from "../src/store/in-memory-queue-store.js";
import { SQLiteQueueStore } from "../src/store/sqlite-queue-store.js";
import type { DlqEntry } from "../src/store/persistent-queue-store.js";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";

/**
 * Test suite for queue store implementations.
 * Can be parameterized to test all store types.
 */

async function testQueueStore(createStore: () => any) {
  describe("Queue Store Implementation", () => {
    let store: any;

    beforeEach(async () => {
      store = createStore();
      await store.initialize();
    });

    afterEach(async () => {
      await store.close();
    });

    const createEntry = (id: string, payload: any = {}): DlqEntry => ({
      id,
      payload,
      failureReason: "test error",
      attempts: 0,
      createdAt: Date.now(),
      lastAttemptAt: null,
    });

    describe("add and getAll", () => {
      it("stores and retrieves entries", async () => {
        const entry = createEntry("e1");
        await store.add(entry);

        const all = await store.getAll();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe("e1");
      });

      it("retrieves multiple entries in order", async () => {
        await store.add(createEntry("e1"));
        await store.add(createEntry("e2"));
        await store.add(createEntry("e3"));

        const all = await store.getAll();
        expect(all).toHaveLength(3);
        expect(all.map((entry: DlqEntry) => entry.id)).toEqual([
          "e1",
          "e2",
          "e3",
        ]);
      });

      it("preserves payload data", async () => {
        const payload = {
          matchId: 42,
          gameId: "abc123",
          nested: { data: "value" },
        };
        const entry = createEntry("e1", payload);
        await store.add(entry);

        const [retrieved] = await store.getAll();
        expect(retrieved.payload).toEqual(payload);
      });
    });

    describe("remove", () => {
      it("removes entry by ID", async () => {
        await store.add(createEntry("e1"));
        await store.add(createEntry("e2"));

        await store.remove("e1");

        const all = await store.getAll();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe("e2");
      });

      it("is idempotent", async () => {
        await store.add(createEntry("e1"));
        await store.remove("e1");
        await expect(store.remove("e1")).resolves.not.toThrow();
        await expect(store.remove("nonexistent")).resolves.not.toThrow();
      });
    });

    describe("update", () => {
      it("updates attempts field", async () => {
        const entry = createEntry("e1");
        await store.add(entry);

        await store.update("e1", { attempts: 3 });

        const [retrieved] = await store.getAll();
        expect(retrieved.attempts).toBe(3);
      });

      it("updates lastAttemptAt field", async () => {
        const entry = createEntry("e1");
        await store.add(entry);

        const timestamp = Date.now();
        await store.update("e1", { lastAttemptAt: timestamp });

        const [retrieved] = await store.getAll();
        expect(retrieved.lastAttemptAt).toBe(timestamp);
      });

      it("updates multiple fields", async () => {
        const entry = createEntry("e1");
        await store.add(entry);

        const timestamp = Date.now();
        await store.update("e1", {
          attempts: 5,
          lastAttemptAt: timestamp,
        });

        const [retrieved] = await store.getAll();
        expect(retrieved.attempts).toBe(5);
        expect(retrieved.lastAttemptAt).toBe(timestamp);
      });
    });

    describe("count", () => {
      it("returns correct count", async () => {
        expect(await store.count()).toBe(0);

        await store.add(createEntry("e1"));
        expect(await store.count()).toBe(1);

        await store.add(createEntry("e2"));
        expect(await store.count()).toBe(2);

        await store.remove("e1");
        expect(await store.count()).toBe(1);
      });
    });

    describe("clear", () => {
      it("removes all entries", async () => {
        await store.add(createEntry("e1"));
        await store.add(createEntry("e2"));
        await store.add(createEntry("e3"));

        expect(await store.count()).toBe(3);

        await store.clear();

        expect(await store.count()).toBe(0);
        expect(await store.getAll()).toEqual([]);
      });
    });

    describe("data integrity", () => {
      it("preserves all fields", async () => {
        const now = Date.now();
        const entry: DlqEntry = {
          id: "e1",
          payload: { test: "data" },
          failureReason: "specific error message",
          attempts: 7,
          createdAt: now - 10000,
          lastAttemptAt: now - 5000,
        };

        await store.add(entry);
        const [retrieved] = await store.getAll();

        expect(retrieved.id).toBe(entry.id);
        expect(retrieved.payload).toEqual(entry.payload);
        expect(retrieved.failureReason).toBe(entry.failureReason);
        expect(retrieved.attempts).toBe(entry.attempts);
        expect(retrieved.createdAt).toBe(entry.createdAt);
        expect(retrieved.lastAttemptAt).toBe(entry.lastAttemptAt);
      });

      it("handles large payloads", async () => {
        const largePayload = {
          matchId: 1,
          data: "x".repeat(10000),
        };
        const entry = createEntry("e1", largePayload);
        await store.add(entry);

        const [retrieved] = await store.getAll();
        expect(retrieved.payload.data).toBe("x".repeat(10000));
      });

      it("handles complex nested payloads", async () => {
        const complexPayload = {
          level1: {
            level2: {
              level3: {
                value: 42,
                array: [1, 2, 3, { nested: true }],
              },
            },
          },
        };
        const entry = createEntry("e1", complexPayload);
        await store.add(entry);

        const [retrieved] = await store.getAll();
        expect(retrieved.payload).toEqual(complexPayload);
      });

      it("handles null and undefined in payload", async () => {
        const payload = {
          nullValue: null,
          undefinedValue: undefined,
          otherValue: "test",
        };
        const entry = createEntry("e1", payload);
        await store.add(entry);

        const [retrieved] = await store.getAll();
        // Note: JSON serialization converts undefined to null
        expect(retrieved.payload.nullValue).toBe(null);
        expect(retrieved.payload.otherValue).toBe("test");
      });
    });
  });
}

// Test in-memory store
testQueueStore(() => new InMemoryQueueStore());

// Test SQLite store
testQueueStore(() => {
  const dbPath = path.join("/tmp", `test-oracle-queue-${Date.now()}.db`);
  const store = new SQLiteQueueStore(dbPath);

  // Clean up after tests
  const originalClose = store.close.bind(store);
  store.close = async () => {
    await originalClose();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  };

  return store;
});

describe("SQLite WAL mode", () => {
  it("enables WAL and allows reads during writes", async () => {
    const dbPath = path.join("/tmp", `test-oracle-queue-wal-${Date.now()}.db`);
    const store = new SQLiteQueueStore(dbPath);
    const writer = new sqlite3.Database(dbPath);
    const reader = new sqlite3.Database(dbPath);

    const run = (db: sqlite3.Database, sql: string) =>
      new Promise<void>((resolve, reject) => {
        db.run(sql, (err: Error | null) => (err ? reject(err) : resolve()));
      });
    const get = <T>(db: sqlite3.Database, sql: string) =>
      new Promise<T>((resolve, reject) => {
        db.get(sql, (err: Error | null, row: T) =>
          err ? reject(err) : resolve(row),
        );
      });
    const close = (db: sqlite3.Database) =>
      new Promise<void>((resolve, reject) => {
        db.close((err: Error | null) => (err ? reject(err) : resolve()));
      });

    try {
      await store.initialize();
      const journalMode = await get<{ journal_mode: string }>(
        reader,
        `PRAGMA journal_mode`,
      );
      expect(journalMode.journal_mode).toBe("wal");

      await run(writer, `BEGIN IMMEDIATE`);
      await expect(
        get<{ count: number }>(
          reader,
          `SELECT COUNT(*) AS count FROM oracle_dlq`,
        ),
      ).resolves.toEqual({ count: 0 });
      await run(writer, `ROLLBACK`);
    } finally {
      await store.close();
      await close(writer);
      await close(reader);
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      if (fs.existsSync(`${dbPath}-wal`)) {
        fs.unlinkSync(`${dbPath}-wal`);
      }
      if (fs.existsSync(`${dbPath}-shm`)) {
        fs.unlinkSync(`${dbPath}-shm`);
      }
    }
  });
});
