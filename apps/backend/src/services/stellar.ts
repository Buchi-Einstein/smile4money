import axios, { type AxiosInstance } from "axios";
import http from "node:http";
import https from "node:https";

const DEFAULT_RPC_POOL_SIZE = 10;
const DEFAULT_RPC_KEEP_ALIVE_TIMEOUT_MS = 5_000;

export interface StellarRpcClientOptions {
  poolSize?: number;
  keepAliveTimeoutMs?: number;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRpcClientOptions(): Required<StellarRpcClientOptions> {
  return {
    poolSize: readPositiveInteger(
      process.env.STELLAR_RPC_POOL_SIZE,
      DEFAULT_RPC_POOL_SIZE,
    ),
    keepAliveTimeoutMs: readPositiveInteger(
      process.env.STELLAR_RPC_KEEP_ALIVE_TIMEOUT_MS,
      DEFAULT_RPC_KEEP_ALIVE_TIMEOUT_MS,
    ),
  };
}

export function createStellarRpcClient(
  options: StellarRpcClientOptions = getRpcClientOptions(),
): AxiosInstance {
  const poolSize = options.poolSize ?? DEFAULT_RPC_POOL_SIZE;
  const keepAliveTimeoutMs =
    options.keepAliveTimeoutMs ?? DEFAULT_RPC_KEEP_ALIVE_TIMEOUT_MS;

  return axios.create({
    httpAgent: new http.Agent({
      keepAlive: true,
      maxSockets: poolSize,
      keepAliveMsecs: keepAliveTimeoutMs,
    }),
    httpsAgent: new https.Agent({
      keepAlive: true,
      maxSockets: poolSize,
      keepAliveMsecs: keepAliveTimeoutMs,
    }),
  });
}

const stellarRpcClient = createStellarRpcClient();

export async function checkStellarRpc(): Promise<void> {
  const rpcUrl = process.env.STELLAR_RPC_URL;
  if (!rpcUrl) {
    throw new Error("STELLAR_RPC_URL not configured");
  }

  const response = await stellarRpcClient.post(
    rpcUrl,
    {
      method: "get health",
      params: [],
      id: 1,
      jsonrpc: "2.0",
    },
    {
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (response.status !== 200 || !response.data || response.data.error) {
    throw new Error("Stellar RPC unavailable");
  }
}
