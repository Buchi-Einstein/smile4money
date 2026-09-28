import type { HistoryRow } from './History';

export interface HistoryCacheEntry {
  history: HistoryRow[];
  nextCursor: string | null;
  fetchedAt: number;
}

const historyCache = new Map<string, HistoryCacheEntry>();

export const DEFAULT_HISTORY_CACHE_TTL_MS = 30_000;

export function getHistoryCacheEntry(wallet: string): HistoryCacheEntry | undefined {
  return historyCache.get(wallet);
}

export function setHistoryCacheEntry(wallet: string, entry: HistoryCacheEntry): void {
  historyCache.set(wallet, entry);
}

export function invalidateHistoryCache(wallet?: string): void {
  if (wallet) {
    historyCache.delete(wallet);
  } else {
    historyCache.clear();
  }
}