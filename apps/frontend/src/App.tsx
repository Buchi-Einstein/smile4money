import { ClaimBurn } from './components/claim-burn';
import { NetworkBadge } from './components/NetworkBadge';
import { History } from './pages/History';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useStellarWallet } from './hooks/useStellarWallet';
import { useTheme } from './hooks/useTheme';
import type { WalletStatus } from './types';
import { invalidateHistoryCache } from './pages/history-cache';

const ClaimBurn = lazy(() =>
  import('./components/claim-burn').then((m) => ({ default: m.ClaimBurn })),
);
const NetworkBadge = lazy(() =>
  import('./components/NetworkBadge').then((m) => ({ default: m.NetworkBadge })),
);
const History = lazy(() =>
  import('./pages/History').then((m) => ({ default: m.History })),
);

export function App() {
  const { status, address, balance, network, connect, disconnect, refreshBalance } =
    useStellarWallet();
  const { theme, toggle } = useTheme();

  const walletState = (
    status === 'connected' && network !== 'unknown' && network !== 'testnet'
      ? 'wrongNetwork'
      : status
  ) as WalletStatus;

  const handleClaim = async (amount: string): Promise<string> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    const server = new rpc.Server(RPC_URL);
    const networkPassphrase = getNetworkPassphrase(network as Network);

    // Build and submit claim transaction via Stellar SDK
    // This would:
    // 1. Build a TransactionEnvelope with the contract call
    // 2. Sign with Freighter wallet
    // 3. Submit to Soroban RPC
    // 4. Poll for confirmation
    // For implementation, see the contract call documentation:
    // https://stellar-sdk.js.org/docs/server#sendtransaction

    // Sign transaction using Freighter wallet
    if (!window.freighterApi?.signTransaction) {
      throw new Error('Freighter wallet does not support signTransaction');
    }

    // In a real implementation, build transaction XDR here
    // const transactionXdr = buildClaimTransaction(amount, address, networkPassphrase);
    const mockTxXdr = 'AAAA...'; // Placeholder

    const { signedTxXdr } = await window.freighterApi.signTransaction(mockTxXdr, {
      networkPassphrase,
    });
    return signAndSubmitTransaction(signedTxXdr, server);
  };

  const handleBurn = async (amount: string): Promise<string | void> => {
    console.info('Burn request', amount);
  };

  const handleCreateMatch = async (data: {
    player2: string;
    stakeAmount: string;
    token: 'xlm' | 'usdc';
    gameId: string;
    platform: 'lichess' | 'chesscom';
  }): Promise<string> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    const server = new rpc.Server(RPC_URL);
    const networkPassphrase = getNetworkPassphrase(network as Network);

    // Build and submit create_match transaction via Stellar SDK
    // This would call the contract's create_match function with:
    // - player1 (connected wallet address)
    // - player2 (from form)
    // - stake_amount (from form)
    // - token (from form toggle)
    // - game_id (from form)
    // - platform (from form selector)

    if (!window.freighterApi?.signTransaction) {
      throw new Error('Freighter wallet does not support signTransaction');
    }

    // In a real implementation, build transaction XDR here
    // const transactionXdr = buildCreateMatchTransaction(data, address, networkPassphrase);
    const mockTxXdr = 'AAAA...';

    const { signedTxXdr } = await window.freighterApi.signTransaction(mockTxXdr, {
      networkPassphrase,
    });
    await signAndSubmitTransaction(signedTxXdr, server);
    invalidateHistoryCache(address);
    return '1'; // Placeholder match ID
  };

  const handleDeposit = async (matchId: string): Promise<void> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    const server = new rpc.Server(RPC_URL);
    const networkPassphrase = getNetworkPassphrase(network as Network);

    // Build and submit deposit transaction via Stellar SDK
    // This would call the contract's deposit function for the given match

    if (!window.freighterApi?.signTransaction) {
      throw new Error('Freighter wallet does not support signTransaction');
    }

    // In a real implementation, build transaction XDR here
    const mockTxXdr = 'AAAA...';

    const { signedTxXdr } = await window.freighterApi.signTransaction(mockTxXdr, {
      networkPassphrase,
    });
    await signAndSubmitTransaction(signedTxXdr, server);
    invalidateHistoryCache(address);
  };

  return (
    <ErrorBoundary>
      <main className="dark:bg-slate-950 dark:text-slate-100 min-h-screen bg-gray-100 px-4 py-6 text-slate-900 transition-colors">
        <div className="mx-auto mb-4 flex max-w-2xl items-center justify-between">
          <NetworkBadge />
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <div>
            <ClaimBurn
              walletState={walletState}
              onConnect={connect}
              onDisconnect={disconnect}
              onRefreshBalance={refreshBalance}
              onClaim={handleClaim}
              onBurn={handleBurn}
              publicKey={address}
              balance={balance}
              expectedNetwork="testnet"
              network={network}
            />
          </div>
          <div>
            <History walletState={walletState} publicKey={address} />
          </div>
        </div>
      </main>
    </ErrorBoundary>
  );
}
