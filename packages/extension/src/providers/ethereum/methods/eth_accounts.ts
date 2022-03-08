import type { MiddlewareFunction } from "@enkryptcom/types";
import type EthereumProvider from "..";
import { WindowPromise } from "@/libs/window-promise";
import { ProviderRPCRequest } from "@/types/provider";
const method: MiddlewareFunction = function (
  this: EthereumProvider,
  payload: ProviderRPCRequest,
  res,
  next
): void {
  if (
    payload.method !== "eth_accounts" &&
    payload.method !== "eth_requestAccounts"
  )
    return next();
  else {
    const windowPromise = new WindowPromise();
    windowPromise
      .getResponse(
        this.getUIPath(this.UIRoutes.ethaccounts.path),
        JSON.stringify(payload)
      )
      .then(({ error, result }) => {
        if (error) res(error as any);
        res(null, JSON.parse(result || "[]"));
      });
  }
};
export default method;
