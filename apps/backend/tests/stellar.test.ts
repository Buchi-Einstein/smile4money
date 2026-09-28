import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import axios from "axios";
import { createStellarRpcClient } from "../src/services/stellar.js";

describe("Soroban RPC HTTP connection pooling", () => {
  let server: http.Server;
  let rpcUrl: string;
  let connectionCount = 0;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { status: "healthy" },
          }),
        );
      });
    });
    server.on("connection", () => {
      connectionCount += 1;
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test RPC server did not bind to a TCP port");
    }
    rpcUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("reduces TCP connections for repeated RPC calls when pooling is enabled", async () => {
    const pooledClient = createStellarRpcClient({
      poolSize: 4,
      keepAliveTimeoutMs: 1_000,
    });
    const nonPooledClient = axios.create({
      httpAgent: new http.Agent({ keepAlive: false }),
    });

    connectionCount = 0;
    for (let requestNumber = 0; requestNumber < 20; requestNumber += 1) {
      await pooledClient.post(rpcUrl, {
        method: "get health",
        params: [],
        id: requestNumber,
        jsonrpc: "2.0",
      });
    }
    const pooledConnections = connectionCount;

    for (let requestNumber = 0; requestNumber < 20; requestNumber += 1) {
      await nonPooledClient.post(rpcUrl, {
        method: "get health",
        params: [],
        id: requestNumber,
        jsonrpc: "2.0",
      });
    }
    const nonPooledConnections = connectionCount - pooledConnections;

    expect(pooledConnections).toBe(1);
    expect(nonPooledConnections).toBe(20);
  });
});
