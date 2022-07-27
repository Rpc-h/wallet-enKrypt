import ActivityState from "@/libs/activity-state";
import { getNetworkByName } from "@/libs/utils/networks";
import { fromBase, toBase } from "@/libs/utils/units";
import erc20 from "@/providers/ethereum/libs/abi/erc20";
import API from "@/providers/ethereum/libs/api";
import { NATIVE_TOKEN_ADDRESS } from "@/providers/ethereum/libs/common";
import Transaction from "@/providers/ethereum/libs/transaction";
import { GasPriceTypes } from "@/providers/ethereum/libs/transaction/types";
import { Erc20Token } from "@/providers/ethereum/types/erc20-token";
import { EvmNetwork } from "@/providers/ethereum/types/evm-network";
import { TransactionSigner } from "@/providers/ethereum/ui/libs/signer";
import { Activity, ActivityStatus, ActivityType } from "@/types/activity";
import { BaseToken } from "@/types/base-token";
import { EnkryptAccount } from "@enkryptcom/types";
import BigNumber from "bignumber.js";
import Web3 from "web3";
import { isAddress, numberToHex, toBN } from "web3-utils";
import {
  Quote,
  QuoteInfo,
  SwapProvider,
  TokenData,
  TradeInfo,
  TradePreview,
  TradeStatus,
  TransactionInfo,
} from "./SwapProvider";

const HOST_URL = "https://mainnet.mewwallet.dev/v4";
const REQUEST_CACHER = "https://requestcache.mewapi.io/?url=";
const GET_LIST = "/swap/list";
const GET_QUOTE = "/swap/quote";
const GET_TRADE = "/swap/trade";
const GET_RATE = "/swap/rate";
const REQUEST_TIMEOUT = 30_000;

type TradeResponseTransaction = {
  to: `0x${string}` | string;
  from: `0x${string}` | string;
  data: `0x${string}`;
  value: `0x${string}`;
  gas?: `0x${string}`;
};

type TradeResponse = {
  provider: string;
  from_amount: string;
  to_amount: string;
  gas: `0x${string}`;
  price_impact: string;
  max_slippage: string;
  minimum: string;
  fee: string;
  transfer_fee: boolean;
  transactions: TradeResponseTransaction[];
};

export class EvmSwapProvider extends SwapProvider {
  public supportedDexes = ["ZERO_X", "ONE_INCH", "PARASWAP"];
  public supportedNetworks: string[] = ["ETH", "MATIC", "BSC"];

  constructor() {
    super();
  }

  public isValidAddress(
    address: string,
    toToken: Erc20Token
  ): Promise<boolean> {
    if (toToken.contract) {
      return Promise.resolve(isAddress(address));
    } else {
      return Promise.resolve(false);
    }
  }

  public async getSupportedTokens(
    chain: string
  ): Promise<{ tokens: Erc20Token[]; featured: Erc20Token[] }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.error("Request timedout");
      }, REQUEST_TIMEOUT);

      const res = await fetch(
        `${REQUEST_CACHER}${HOST_URL}${GET_LIST}?chain=${chain}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!res.ok) {
        console.error(res.statusText);
      }

      const {
        tokens,
        featured,
      }: { tokens: TokenData[]; featured: TokenData[] } = await res.json();

      const allTokens = tokens.map((tokenData: TokenData) => {
        return new Erc20Token({
          decimals: tokenData.decimals,
          contract: tokenData.contract_address,
          icon:
            tokenData.icon && tokenData.icon !== ""
              ? `https://img.mewapi.io/?image=${tokenData.icon}`
              : `https://img.mewapi.io/?image=https://mpolev.ru/enkrypt/eth.png`,
          symbol: tokenData.symbol.toUpperCase(),
          name: tokenData.name ?? tokenData.symbol,
          price: tokenData.price,
          balance: toBase("1", tokenData.decimals),
        });
      });

      const featuredTokens = featured.map((tokenData: TokenData) => {
        return new Erc20Token({
          decimals: tokenData.decimals,
          contract: tokenData.contract_address,
          icon:
            tokenData.icon && tokenData.icon !== ""
              ? `https://img.mewapi.io/?image=${tokenData.icon}`
              : "https://img.mewapi.io/?image=https://mpolev.ru/enkrypt/eth.png",
          symbol: tokenData.symbol.toUpperCase(),
          name: tokenData.name ?? tokenData.symbol,
          price: tokenData.price,
          balance: toBase("1", tokenData.decimals),
        });
      });

      return { tokens: allTokens, featured: featuredTokens };
    } catch {
      throw new Error("Could not fetch tokens");
    }
  }

  public async getTradePreview(
    chain: string,
    fromToken: Erc20Token,
    toToken: Erc20Token
  ): Promise<TradePreview | null> {
    if (!fromToken.contract || !toToken.contract) {
      return null;
    }

    const params = new URLSearchParams();
    params.append("fromContractAddress", fromToken.contract);
    params.append("toContractAddress", toToken.contract);
    params.append("chain", chain);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.error("Request timedout");
      }, REQUEST_TIMEOUT);

      const res = await fetch(`${HOST_URL}${GET_RATE}?${params.toString()}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rates = await res.json();
      const { min, max } = await this.getMinMaxAmount(fromToken);
      return {
        min,
        max,
        rates,
      };
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  public getMinMaxAmount(fromToken: BaseToken): Promise<{
    min: string;
    max: string;
  }> {
    return Promise.resolve({
      min: new BigNumber(1)
        .dividedBy(new BigNumber(10).pow(fromToken.decimals))
        .toFixed(),
      max: new BigNumber(1)
        .multipliedBy(new BigNumber(10).pow(fromToken.decimals))
        .toFixed(),
    });
  }

  public async getQuote(
    chain: string,
    fromToken: Erc20Token,
    toToken: Erc20Token,
    fromAmount: string
  ): Promise<QuoteInfo[]> {
    if (!isAddress(fromToken.contract) || !isAddress(toToken.contract))
      return [];
    const params = new URLSearchParams();
    params.append("fromContractAddress", fromToken.contract);
    params.append("toContractAddress", toToken.contract);
    params.append("amount", fromAmount);
    params.append("chain", chain);

    const { min, max } = await this.getMinMaxAmount(fromToken);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.error("Request timedout");
      }, REQUEST_TIMEOUT);

      const res = await fetch(`${HOST_URL}${GET_QUOTE}?${params.toString()}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const { quotes }: { quotes: Quote[] } = await res.json();

      return quotes.map(({ exchange, amount, dex }) => {
        return {
          exchange,
          min,
          max,
          amount,
          dex,
        };
      });
    } catch {
      throw new Error("Could not retrieve pairs");
    }

    return [];
  }

  public async getTrade(
    chain: string,
    fromAddress: string,
    toAddress: string,
    fromToken: Erc20Token,
    toToken: Erc20Token,
    fromAmount: string,
    swapMax: boolean
  ): Promise<TradeInfo[]> {
    try {
      if (!fromToken.contract || !toToken.contract) {
        return [];
      }

      let amountToSwap = fromAmount;

      if (swapMax) {
        if (fromToken.contract === NATIVE_TOKEN_ADDRESS) {
          // TODO send native max
        } else {
          const network = getNetworkByName(chain);
          const web3 = new Web3(network!.node);
          const tokenContract = new web3.eth.Contract(
            erc20 as any,
            fromToken.contract
          );

          amountToSwap = fromBase(
            await tokenContract.methods.balanceOf(fromAddress).call(),
            fromToken.decimals
          );
        }
      }

      const params = new URLSearchParams();
      params.append("chain", chain);
      params.append("fromContractAddress", fromToken.contract);
      params.append("toContractAddress", toToken.contract);
      params.append("amount", amountToSwap);
      params.append("address", fromAddress);
      params.append("platform", "web");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.error("Request timedout");
      }, REQUEST_TIMEOUT);

      const res = await fetch(`${HOST_URL}${GET_TRADE}?${params.toString()}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data: TradeResponse[] = await res.json();

      const network = getNetworkByName(chain);
      return data.map((tradeResponse) => {
        if (tradeResponse.transactions.length === 2) {
          const allowanceTx = tradeResponse.transactions[0];
          const nativeToken = {
            decimals: network!.decimals,
            icon: network!.icon,
            name: network!.name_long,
            symbol: network!.name,
            coingeckoID: network!.coingeckoID,
          };
          const nativeTokenValue = "0x0";

          const allowanceTxInfo: TransactionInfo = {
            token: nativeToken,
            tokenValue: nativeTokenValue,
            ...allowanceTx,
          };

          tradeResponse.transactions[0] = allowanceTxInfo;

          const swapTx = tradeResponse.transactions[1];
          const token = {
            decimals: fromToken.decimals,
            icon: fromToken.icon,
            name: fromToken.name,
            symbol: fromToken.symbol,
            coingeckoID: fromToken.coingeckoID,
            price: fromToken.price,
          };
          const tokenValue = toBase(fromAmount, fromToken.decimals);

          const swapTxInfo: TransactionInfo = {
            token,
            tokenValue,
            ...swapTx,
          };

          tradeResponse.transactions[1] = swapTxInfo;
        } else {
          const swapTx = tradeResponse.transactions[0];
          const token = {
            decimals: fromToken.decimals,
            icon: fromToken.icon,
            name: fromToken.name,
            symbol: fromToken.symbol,
            coingeckoID: fromToken.coingeckoID,
            price: fromToken.price,
          };
          const tokenValue = toBase(fromAmount, fromToken.decimals);

          const swapTxInfo: TransactionInfo = {
            token,
            tokenValue,
            ...swapTx,
          };

          tradeResponse.transactions[0] = swapTxInfo;
        }

        return {
          provider: tradeResponse.provider,
          fromAmount,
          minimumReceived: tradeResponse.minimum,
          maxSlippage: tradeResponse.max_slippage,
          priceImpact: tradeResponse.price_impact,
          fee: tradeResponse.fee,
          gas: tradeResponse.gas,
          txs: tradeResponse.transactions as TransactionInfo[],
        };
      });
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  public getStatus(): TradeStatus {
    // TODO get status for activity tab

    return TradeStatus.UNKNOWN;
  }

  public async executeTrade(
    network: EvmNetwork,
    fromAccount: EnkryptAccount,
    trade: TradeInfo,
    gasPriceType?: GasPriceTypes
  ): Promise<`0x${string}`[]> {
    const api = (await network.api()) as API;
    await api.init();
    const web3 = api.web3;

    const nonce = await web3.eth.getTransactionCount(fromAccount.address);
    const activityState = new ActivityState();
    const txPromises = trade.txs
      .map(({ data, value, gas, to, from, token, tokenValue }, index) => {
        const txActivity: Activity = {
          from,
          to,
          token,
          isIncoming: fromAccount.address === to,
          network: network.name,
          status: ActivityStatus.pending,
          timestamp: new Date().getTime(),
          type: ActivityType.transaction,
          value: tokenValue,
          transactionHash: "",
        };

        return [
          new Transaction(
            {
              from: fromAccount.address as `0x${string}`,
              to: to as `0x${string}`,
              data,
              value,
              gas,
              chainId: numberToHex(network.chainID) as `0x{string}`,
              nonce: `0x${toBN(nonce)
                .addn(index)
                .toString("hex")}` as `0x${string}`,
            },
            web3
          ),
          txActivity,
        ] as const;
      })
      .map(([tx, activity]) =>
        tx
          .getFinalizedTransaction({
            gasPriceType: gasPriceType ?? GasPriceTypes.REGULAR,
          })
          .then((finalizedTx) =>
            TransactionSigner({
              account: fromAccount,
              network: network,
              payload: finalizedTx,
            }).then((signedTx) =>
              web3.eth
                .sendSignedTransaction(
                  `0x${signedTx.serialize().toString("hex")}`
                )
                .on("transactionHash", (hash: string) => {
                  activityState.addActivities(
                    [
                      {
                        ...JSON.parse(JSON.stringify(activity)),
                        ...{ transactionHash: hash },
                      },
                    ],
                    { address: fromAccount.address, network: network.name }
                  );
                  console.log("hash", hash);
                })
                .then((receipt) => receipt.transactionHash as `0x${string}`)
            )
          )
      );

    return Promise.all(txPromises);
  }
}
