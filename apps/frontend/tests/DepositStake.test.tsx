import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DepositStake } from '../src/components/DepositStake';

// Mutable state shared between the test body and the @stellar/stellar-sdk mock.
// vi.mock is hoisted above imports, so the mock can only close over values
// created with vi.hoisted().
const { defaultMatch, setSimulateResponse, getSimulateResponse } = vi.hoisted(() => {
  const defaultMatch = {
    id: 0n,
    player1: 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456',
    player2: 'G1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
    stake_amount: 10000000n,
    // Matches the value returned by the mocked Asset.native().contractId()
    token: 'NATIVE-XLM-TOKEN',
    game_id: 'lichess_abc123',
    platform: 'Lichess',
    state: 'Pending',
    player1_deposited: false,
    player2_deposited: false,
  };

  let simulateResponse: unknown = { result: { retval: defaultMatch } };

  return {
    defaultMatch,
    setSimulateResponse: (response: unknown) => {
      simulateResponse = response;
    },
    getSimulateResponse: () => simulateResponse,
  };
});

// Mock @stellar/stellar-sdk so DepositStake's read-only get_match simulation
// can run without a live Soroban RPC server.
vi.mock('@stellar/stellar-sdk', () => ({
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      simulateTransaction: vi.fn().mockImplementation(async () => getSimulateResponse()),
    })),
  },
  Account: class Account {
    constructor(_accountId: string, _sequence: string) {}
  },
  Operation: {
    invokeContractFunction: vi.fn((opts) => opts),
  },
  TransactionBuilder: class TransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return {};
    }
  },
  nativeToScVal: vi.fn((value) => value),
  scValToNative: vi.fn((value) => value),
  Asset: {
    native: () => ({
      contractId: () => 'NATIVE-XLM-TOKEN',
    }),
  },
}));

beforeEach(() => {
  setSimulateResponse({ result: { retval: defaultMatch } });
});

describe('DepositStake — loading state', () => {
  it('shows loading state initially while fetching match details', () => {
    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);
    expect(screen.getByTestId('deposit-stake')).toBeInTheDocument();
  });
});

describe('DepositStake — no match ID', () => {
  it('returns null when no match ID provided', () => {
    const { container } = render(
      <DepositStake matchId="" playerAddress="GABCDEF123456" contractId="test-contract" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('DepositStake — match info display', () => {
  it('displays match details fetched from the escrow contract', async () => {
    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);

    await screen.findByTestId('match-info');

    // On-chain stake amount (stroops) and the native token symbol
    expect(screen.getByText('10000000')).toBeInTheDocument();
    expect(screen.getByText('XLM')).toBeInTheDocument();

    // Player addresses are truncated for display
    expect(screen.getByText('GABC...3456')).toBeInTheDocument();
    expect(screen.getByText('G123...90AB')).toBeInTheDocument();

    expect(screen.getByTestId('player1-status')).toHaveTextContent('Pending');
    expect(screen.getByTestId('player2-status')).toHaveTextContent('Pending');
  });

  it('renders the raw token address when the token is not native XLM', async () => {
    setSimulateResponse({
      result: {
        retval: {
          ...defaultMatch,
          token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        },
      },
    });

    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);

    await screen.findByTestId('match-info');
    expect(
      screen.getByText('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'),
    ).toBeInTheDocument();
  });

  it('shows deposited indicators when on-chain data reports a deposit', async () => {
    setSimulateResponse({
      result: {
        retval: { ...defaultMatch, player1_deposited: true },
      },
    });

    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);

    await screen.findByTestId('match-info');
    expect(screen.getByTestId('player1-status')).toHaveTextContent('✓ Deposited');
    expect(screen.getByTestId('player2-status')).toHaveTextContent('Pending');

    // Already deposited — deposit button is disabled and relabelled
    expect(screen.getByTestId('deposit-btn')).toBeDisabled();
    expect(screen.getByTestId('deposit-btn')).toHaveTextContent('Already Deposited');
  });
});

describe('DepositStake — RPC error handling', () => {
  it('shows an error and a retry button when get_match returns an error', async () => {
    setSimulateResponse({ error: 'HostError' });

    render(<DepositStake matchId="999" playerAddress="GABCDEF123456" contractId="test-contract" />);

    await waitFor(() => {
      expect(screen.getByTestId('deposit-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/Could not load match 999/)).toBeInTheDocument();
    expect(screen.getByTestId('retry-btn')).toBeInTheDocument();
  });

  it('recovers via the retry button when the RPC call later succeeds', async () => {
    setSimulateResponse({ error: 'HostError' });

    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);

    await waitFor(() => {
      expect(screen.getByTestId('deposit-error')).toBeInTheDocument();
    });

    // The match now exists on-chain — retrying loads it
    setSimulateResponse({ result: { retval: defaultMatch } });
    fireEvent.click(screen.getByTestId('retry-btn'));

    await screen.findByTestId('match-info');
    expect(screen.getByText('10000000')).toBeInTheDocument();
  });
});

describe('DepositStake — deposit button states', () => {
  it('shows Deposit Stake button after loading', async () => {
    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);

    await waitFor(() => {
      expect(screen.getByTestId('deposit-btn')).toBeInTheDocument();
    });
  });

  /**
   * #1080 — Regression guard for double-submit race condition.
   *
   * While an in-flight deposit transaction is pending the button must be:
   *   - disabled (cannot be clicked again)
   *   - aria-busy="true" (accessible loading indicator)
   *   - showing the "Depositing…" label
   *
   * We use a never-resolving promise to freeze the component in the pending
   * state so we can assert all three properties synchronously.
   */
  it('disables the button and shows a loading indicator while a deposit is in flight', async () => {
    // onDeposit never resolves — keeps the component in the 'pending' state
    // for as long as we need to make assertions.
    let resolveDeposit!: () => void;
    const inFlightDeposit = new Promise<void>((resolve) => {
      resolveDeposit = resolve;
    });
    const onDeposit = vi.fn().mockReturnValue(inFlightDeposit);

    render(
      <DepositStake
        matchId="123"
        playerAddress="GABCDEF123456"
        contractId="test-contract"
        onDeposit={onDeposit}
      />,
    );

    // Wait for match details to load so the deposit button is enabled
    const depositBtn = await screen.findByTestId('deposit-btn');
    expect(depositBtn).not.toBeDisabled();

    // Trigger the deposit — this sets status to 'pending' synchronously
    fireEvent.click(depositBtn);

    // The button must be disabled while the transaction is in flight
    expect(depositBtn).toBeDisabled();

    // aria-busy must be true so screen readers announce the loading state
    expect(depositBtn).toHaveAttribute('aria-busy', 'true');

    // The label must communicate the in-progress state to sighted users
    expect(depositBtn).toHaveTextContent('Depositing…');

    // Confirm onDeposit was only called once — no double-submit
    expect(onDeposit).toHaveBeenCalledTimes(1);

    // Clean up: let the promise resolve so the component can unmount cleanly
    resolveDeposit();
  });
});

describe('DepositStake — form rendering', () => {
  it('renders with correct test id', () => {
    render(<DepositStake matchId="123" playerAddress="GABCDEF123456" contractId="test-contract" />);
    expect(screen.getByTestId('deposit-stake')).toBeInTheDocument();
  });
});

describe('DepositStake — wallet connection check', () => {
  it('handles no player address', () => {
    render(<DepositStake matchId="123" playerAddress={null} contractId="test-contract" />);
    expect(screen.getByTestId('deposit-stake')).toBeInTheDocument();
  });
});
