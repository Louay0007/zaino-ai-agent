/** Hook to manage connector catalog, installation state, and MCP inventory refresh. */
import { useCallback, useEffect, useState } from "react";
import { connectorsApi } from "./api";
import type { ConnectorDef, InstallConnectorResult } from "./types";
import { mcpApi } from "@/features/mcp/api";
import type { McpInventory } from "@/features/mcp/types";

export function useConnectors(workspace: string | null) {
  const [catalog, setCatalog] = useState<ConnectorDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [inventory, setInventory] = useState<McpInventory | null>(null);
  const [lastResult, setLastResult] = useState<InstallConnectorResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cat, inv] = await Promise.all([
        connectorsApi.catalog(),
        mcpApi.inventory(workspace),
      ]);
      setCatalog(cat);
      setInventory(inv);
    } catch (err) {
      console.error("[connectors] refresh failed", err);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const install = useCallback(async (
    connectorId: string,
    envValues: Record<string, string>,
    engines: string[],
  ) => {
    setInstalling(connectorId);
    setLastResult(null);
    try {
      const result = await connectorsApi.install({
        connectorId,
        engines,
        envValues,
        workspace,
      });
      setLastResult(result);
      await refresh();
      return result;
    } catch (err) {
      console.error("[connectors] install failed", err);
      throw err;
    } finally {
      setInstalling(null);
    }
  }, [workspace, refresh]);

  const remove = useCallback(async (connectorId: string, engines: string[]) => {
    setRemoving(connectorId);
    setLastResult(null);
    try {
      const result = await connectorsApi.remove({
        connectorId,
        engines,
        workspace,
      });
      setLastResult(result);
      await refresh();
      return result;
    } catch (err) {
      console.error("[connectors] remove failed", err);
      throw err;
    } finally {
      setRemoving(null);
    }
  }, [workspace, refresh]);

  /** Check if a connector is installed in any engine's config. */
  const isInstalled = useCallback((connectorName: string): boolean => {
    if (!inventory) return false;
    return inventory.engines.some((eng) =>
      eng.config.entries.some((entry) => entry.name === connectorName),
    );
  }, [inventory]);

  return {
    catalog,
    loading,
    installing,
    removing,
    inventory,
    lastResult,
    install,
    remove,
    isInstalled,
    refresh,
  };
}
