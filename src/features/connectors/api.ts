/** Connector marketplace IPC — mirrors src-tauri/src/connectors/mod.rs */
import { invoke } from "@/lib/transport";
import type {
  ConnectorDef,
  InstallConnectorRequest,
  InstallConnectorResult,
  RemoveConnectorRequest,
} from "./types";

export const connectorsApi = {
  catalog: async (): Promise<ConnectorDef[]> => {
    return invoke<ConnectorDef[]>("connector_catalog");
  },
  install: async (request: InstallConnectorRequest): Promise<InstallConnectorResult> => {
    return invoke<InstallConnectorResult>("install_connector", { request });
  },
  remove: async (request: RemoveConnectorRequest): Promise<InstallConnectorResult> => {
    return invoke<InstallConnectorResult>("remove_connector", { request });
  },
};
