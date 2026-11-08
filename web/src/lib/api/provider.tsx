"use client";
import {
  QueryClient,
  QueryClientProvider,
  QueryClientContext,
} from "@tanstack/react-query";
import { useContext, useState, type ReactNode } from "react";
function LocalProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
/** M4 can mount this in the root layout; feature fallbacks reuse an existing provider. */
export function DataProvider({ children }: { children: ReactNode }) {
  const existing = useContext(QueryClientContext);
  return existing ? <>{children}</> : <LocalProvider>{children}</LocalProvider>;
}
