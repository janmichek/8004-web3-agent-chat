import { computed, ref, type Ref } from "vue";
import {
  getAccount,
  getBalance,
  sendTransaction,
  waitForTransactionReceipt,
} from "@wagmi/vue/actions";
import { useConfig } from "@wagmi/vue";
import { parseEther } from "viem";
import { fundAgent, type AgentSummary } from "@/shared/api";
import { DEFAULT_CHAIN_ID, networkInfo, txExplorerUrl } from "@/shared/config";
import { ensureChain, e2eSendTx, friendlyFundError, prepareNativeTransfer } from "@/shared/lib";

/** Highest amount the done screen allows in one top-up. */
const MAX_FUND_ETH = 1;

export function isFundAmountValid(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_FUND_ETH;
}

function creditedBalance(balance: string, amountEth: string): string {
  const current = Number(balance || "0");
  const added = Number(amountEth);
  if (!Number.isFinite(current) || !Number.isFinite(added)) return balance;
  return String(+(current + added).toFixed(6));
}

/**
 * Post-creation wallet top-ups. Keeps the two funding paths (server master
 * wallet and the connected wallet) in one place so the done screen stays a
 * thin view.
 */
export function useAgentFunding(agent: Ref<AgentSummary>, balance: Ref<string>) {
  const wagmiConfig = useConfig();
  const fundEth = ref("0.002");
  const fundBusy = ref<"master" | "wallet" | null>(null);
  const fundStatus = ref("");
  const fundStatusKind = ref<"info" | "ok" | "error">("info");
  const fundSource = ref<"master" | "wallet" | null>(null);
  const fundTxHash = ref("");

  const fundAmountValid = computed(() => isFundAmountValid(fundEth.value));
  const funded = computed(() => fundSource.value !== null && fundStatusKind.value === "ok");
  const networkName = computed(() => networkInfo(agent.value.walletChainId).name);
  /** Button copy doubles as the live status: the in-flight step while busy. */
  const fundButtonLabel = computed(() => {
    if (fundBusy.value) return fundStatus.value || "Funding…";
    return funded.value ? "Add more" : "Fund wallet";
  });
  const fundTxUrl = computed(() =>
    fundTxHash.value ? txExplorerUrl(fundTxHash.value, agent.value.walletChainId) : "",
  );

  /** Fund the freshly created agent from the server master wallet. */
  async function fundFromMaster() {
    if (!fundAmountValid.value || fundBusy.value) return;
    fundBusy.value = "master";
    fundSource.value = "master";
    fundStatusKind.value = "info";
    fundStatus.value = "Sending…";
    fundTxHash.value = "";
    try {
      const res = await fundAgent(agent.value.name, fundEth.value.trim());
      fundTxHash.value = res.txHash;
      fundStatusKind.value = "ok";
      fundStatus.value = `Confirmed ${res.amountEth} ETH · ${res.txHash.slice(0, 10)}…`;
      balance.value = creditedBalance(balance.value, res.amountEth);
    } catch (err) {
      fundStatusKind.value = "error";
      fundStatus.value = friendlyFundError(err, "master", networkName.value);
    } finally {
      fundBusy.value = null;
    }
  }

  /**
   * Wait until the funding tx is mined; throw if it reverts.
   * (Web3Auth used to send value transfers at 21_000 gas — Sepolia needs
   * ~200k to fund a fresh account — so we always pass estimateGas up front.)
   */
  async function awaitFundSettlement(hash: `0x${string}`, chainId: number) {
    fundStatusKind.value = "info";
    fundStatus.value = "Confirming…";
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId });
    if (receipt.status !== "success") {
      throw new Error("Funding transaction reverted on-chain.");
    }
  }

  /** Fund the freshly created agent from the user's connected wallet (MetaMask signs). */
  async function fundFromWallet() {
    const walletAddress = agent.value.walletAddress;
    if (!walletAddress || !fundAmountValid.value || fundBusy.value) return;
    fundBusy.value = "wallet";
    fundSource.value = "wallet";
    fundStatusKind.value = "info";
    fundStatus.value = "Confirm in wallet…";
    fundTxHash.value = "";
    try {
      // The agent wallet is funded on the chain the agent was created on.
      const chainId = agent.value.walletChainId ?? DEFAULT_CHAIN_ID;
      await ensureChain(wagmiConfig, chainId);
      const account = getAccount(wagmiConfig);
      if (!account.address) throw new Error("Connect a wallet first");

      const amount = fundEth.value.trim();
      const value = parseEther(amount as `${number}`);
      const to = walletAddress as `0x${string}`;

      fundStatus.value = "Estimating gas…";
      const prepared = await prepareNativeTransfer({
        account: account.address,
        to,
        value,
        chainId,
      });
      const feeCap = prepared.maxFeePerGas ?? 0n;
      const gasBudget = prepared.gas * feeCap;
      const bal = await getBalance(wagmiConfig, { address: account.address, chainId });
      if (bal.value < value + gasBudget) {
        throw new Error("insufficient funds for gas");
      }

      // Playwright has no real wallet: let tests stub the send + settlement.
      const stub = e2eSendTx();
      fundStatus.value = "Confirm in wallet…";
      const hash = stub
        ? ((await stub()) as `0x${string}`)
        : await sendTransaction(wagmiConfig, {
            account: account.address,
            to,
            value,
            chainId,
            gas: prepared.gas,
            maxFeePerGas: prepared.maxFeePerGas,
            maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
          });
      fundTxHash.value = hash;
      if (!stub) {
        await awaitFundSettlement(hash, chainId);
      }
      fundStatusKind.value = "ok";
      fundStatus.value = `Confirmed ${amount} ETH (tx ${hash.slice(0, 10)}…)`;
      balance.value = creditedBalance(balance.value, amount);
    } catch (err) {
      fundStatusKind.value = "error";
      fundStatus.value = friendlyFundError(err);
    } finally {
      fundBusy.value = null;
    }
  }

  return {
    fundEth,
    fundBusy,
    fundStatus,
    fundStatusKind,
    fundSource,
    fundTxHash,
    fundAmountValid,
    funded,
    fundButtonLabel,
    networkName,
    fundTxUrl,
    fundFromMaster,
    fundFromWallet,
  };
}
