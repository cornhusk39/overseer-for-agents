// Public surface of the ingest package: configuration, the SQLite store, the
// redaction pass, the OTLP mapping, and the HTTP receiver. Everything that
// touches untrusted telemetry lives here, so auth, caps, timeouts, and
// redaction are all enforced before any write.

import { loadConfig, type IngestConfig } from "./config.js";
import { Store } from "./store.js";
import { createIngestServer } from "./receiver.js";

export * from "./config.js";
export * from "./redaction.js";
export * from "./pricing.js";
export * from "./semconv-map.js";
export * from "./rollups.js";
export * from "./store.js";
export * from "./otlp-mapping.js";
export * from "./trends.js";
export * from "./api.js";
export * from "./receiver.js";

export interface RunningIngest {
  store: Store;
  close: () => Promise<void>;
}

// Open the store, start the receiver, and resolve once it is accepting
// connections. The returned close() shuts the server and the database down
// together so callers (and tests) leave nothing dangling.
export function startIngest(config: IngestConfig = loadConfig()): Promise<RunningIngest> {
  const store = new Store(config.dbPath);
  const server = createIngestServer(config, store);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve({
        store,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => {
              store.close();
              res();
            });
          }),
      });
    });
  });
}
