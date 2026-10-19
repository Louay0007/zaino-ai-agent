/** Connector marketplace types — mirror src-tauri/src/connectors/mod.rs */

export interface EnvVarDef {
  key: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  placeholder: string | null;
}

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  package: string;
  args: string[];
  envVars: EnvVarDef[];
  engines: string[];
  docsUrl: string | null;
}

export interface EngineInstallResult {
  engine: string;
  success: boolean;
  message: string | null;
}

export interface InstallConnectorResult {
  connectorId: string;
  results: EngineInstallResult[];
}

export interface InstallConnectorRequest {
  connectorId: string;
  engines: string[];
  envValues: Record<string, string>;
  workspace: string | null;
}

export interface RemoveConnectorRequest {
  connectorId: string;
  engines: string[];
  workspace: string | null;
}
