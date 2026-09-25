# ADR-002: SQLite as the DLQ Persistence Backend

**Date:** August 2026

**Status:** Accepted

## Context

The oracle backend (`apps/backend`) maintains a dead-letter queue (DLQ) for failed
oracle submissions. When a result submission fails — e.g. a Soroban RPC error, a
network timeout, or a transient 5xx from the chess platform — the job is written to
the DLQ and retried later by a retry worker (`startRetryWorker` in
`apps/backend/src/queue.ts`) protected by a circuit breaker. The DLQ must be
**durable**: a process restart or crash must not lose pending jobs, otherwise
affected matches would never receive their result.

The DLQ store is selected through the `PersistentQueueStore` interface
(`apps/backend/src/store/persistent-queue-store.ts`), which has three
implementations:

- `InMemoryQueueStore` — development only, data lost on restart.
- `MongoDBQueueStore` — server-backed, selected when `MONGODB_URL` is set.
- `SQLiteQueueStore` — file-based, the **default** when no `MONGODB_URL` is set
  (`QUEUE_STORE=auto`).

This ADR records the decision to make **SQLite** the default DLQ persistence
backend, and documents the operational consequences that operators must understand.

## Problem Statement

We needed a durable DLQ store that:

1. Survives process restarts and crashes (no lost jobs).
2. Requires **zero external infrastructure** for the common deployment.
3. Keeps operational overhead low for small-to-medium deployments.
4. Remains trivially swappable for a heavier store (MongoDB) when scale demands it.

The alternatives considered were **PostgreSQL**, **Redis**, and **MongoDB**.

## Decision

**SQLite is the default DLQ persistence backend** for the oracle service. When
`QUEUE_STORE` is `auto` (the default) and `MONGODB_URL` is unset, the service uses
`SQLiteQueueStore`, which writes to a single file at
`apps/backend/data/oracle-queue.db` (configurable via the store constructor).

MongoDB remains a supported alternative for multi-instance / high-throughput
deployments and is auto-selected when `MONGODB_URL` is present.

DLQ entries are retained for a fixed TTL of **30 days** (`expireAt =
createdAt + 30 * 24 * 60 * 60 * 1000` in `sqlite-queue-store.ts`), after which
they are purged on the next read.

## Rationale

### Why SQLite over the alternatives

#### PostgreSQL
- **Pros:** Mature, strong concurrency, multi-instance friendly.
- **Cons:** Requires running and operating a dedicated database server; significant
  overhead for what is fundamentally a low-throughput, append-mostly queue. Overkill
  for the common single-instance oracle deployment.

#### Redis
- **Pros:** Extremely fast, simple list/stream primitives.
- **Cons:** Default persistence is asynchronous (RDB/AOF) and can lose recently
  written entries on hard failure unless carefully tuned; it is an in-memory store
  first and a durable store second. Operational semantics (eviction, memory caps)
  make it a poor fit for a "must never silently drop a failed submission" queue.

#### MongoDB
- **Pros:** Durable, good query model, native 30-day TTL index, horizontally
  scalable. **This is the recommended store for multi-instance production.**
- **Cons:** Requires provisioning and operating a MongoDB instance — extra cost and
  operational surface for the default/small deployment.

#### SQLite (chosen)
- **Pros:**
  - **Zero external infrastructure** — a single file on disk, no server to provision.
  - **Truly durable** for our write pattern: synchronous commit to a local file.
  - **Embeds with the service** — the DLQ lives right next to the process that owns
    it, simplifying deployment (a single container, no sidecars).
  - **Trivially swappable** — the `PersistentQueueStore` interface means moving to
    MongoDB later is a config change, not a rewrite.
  - **More than enough throughput** — the DLQ is a low-volume, failure-path store,
    not the hot path. The steady-state write rate is effectively the failure rate of
    oracle submissions, which is tiny.
  - **Easy to inspect/backup** — `sqlite3 data/oracle-queue.db` for debugging; file
    copy for backup.

We judged that for the common deployment (a single oracle backend instance watching
a modest number of matches), the operational simplicity of SQLite outweighs the
scaling ceiling. The ceiling is explicitly addressed below and via the MongoDB
option.

## Operational Implications

SQLite is a **single-writer, embedded** database. Choosing it has concrete
operational consequences that operators MUST account for:

### 1. Not suitable for multi-instance deployments
SQLite cannot be shared safely by multiple processes writing to the same file over
a network filesystem. **Run exactly one oracle backend instance** when using the
SQLite DLQ. Horizontal scaling of the oracle service requires switching to MongoDB
(`QUEUE_STORE=mongodb` + `MONGODB_URL`).

### 2. No concurrent writes from multiple processes
Only one process should open `data/oracle-queue.db` for writing at a time. The
service opens the database with the default rollback journal; concurrent writers
from separate processes will hit `SQLITE_BUSY` / "database is locked" errors. If you
need a second process (e.g. a separate admin tool), open it **read-only**
(`sqlite3` CLI with the file copied, or a read-only connection), never as a second
writer.

### 3. Cloud / ephemeral storage handling
In containers (Docker, Kubernetes, ECS, Fargate) the local filesystem is **ephemeral**
— a restart or reschedule destroys `data/oracle-queue.db` and with it any pending
DLQ entries. **Mount a persistent volume** at `apps/backend/data` so the DLQ file
survives pod/container restarts. Without this, SQLite's durability guarantee is
voided by the platform. (PERSISTENT_QUEUE.md documents the `data/` path.)

### 4. Backups
Because the DLQ is a local file, include `data/oracle-queue.db` in your backup /
disaster-recovery plan if you care about not re-draining failed submissions after a
volume loss. A periodic file copy (or volume snapshot) is sufficient.

### 5. Single-writer throughput ceiling
The retry worker writes to the DLQ under a circuit breaker, so write pressure is
naturally bounded. Under a mass failure (many matches failing at once) write
contention is still serialized by SQLite; this is acceptable at our expected
volumes but is the concrete reason MongoDB is offered as the scale-out path.

### 6. Concurrency within a single process is fine
Multiple in-process tasks still share the one connection safely (SQLite serializes
writes internally). The limitation is strictly *cross-process* writers.

## Trade-offs

### Advantages
1. **No external infrastructure** for the default deployment.
2. **Durable** for the single-instance write pattern.
3. **Low operational surface** — one file to back up and mount.
4. **Swappable** to MongoDB via configuration when scale requires.

### Disadvantages
1. **Single-instance only** — cannot back a horizontally scaled oracle fleet.
2. **Single-writer** — a second writing process will fail with lock errors.
3. **Cloud ephemeral storage risk** — needs an explicit persistent volume mount.
4. **No built-in replication / HA** — durability depends on the underlying volume.

## Implementation Notes

- Interface: `apps/backend/src/store/persistent-queue-store.ts`
  (`PersistentQueueStore`, `DlqEntry`).
- Default store: `apps/backend/src/store/sqlite-queue-store.ts`
  (`SQLiteQueueStore`), table `oracle_dlq` with an index on `expireAt`.
- Selection logic: `QUEUE_STORE` (`auto` | `mongodb` | `sqlite` | `memory`) in
  `apps/backend/src/queue.ts`; `auto` → MongoDB if `MONGODB_URL` is set, else SQLite.
- TTL: 30 days, purged on read.
- See `PERSISTENT_QUEUE.md` for full operational/usage details and the
  troubleshooting note on "SQLite database locked".

## Future Enhancements

1. **First-class multi-instance support** — document and validate a MongoDB-only
   production topology for horizontally scaled oracle deployments.
2. **WAL mode** — enable `PRAGMA journal_mode=WAL` to improve concurrent
   read/write behaviour within the single owning process.
3. **Configurable TTL** — allow per-entry or environment-driven DLQ retention.
4. **DLQ metrics / alerts** — expose `oracle_dlq_depth` to monitoring so a growing
   queue pages on-call before the 7-day `TIMEOUT_LEDGERS` window is approached.

## Conclusion

SQLite is the pragmatic default for DLQ persistence: it is durable for our
single-instance write pattern, requires no external infrastructure, and is trivially
swapped for MongoDB when a deployment outgrows the single-writer model. Operators
must run one oracle instance, mount a persistent volume in cloud environments, and
treat the DB file as a backup artifact. This decision favours **operational
simplicity for the common case** while keeping a clear, config-only upgrade path to
MongoDB for scale.
