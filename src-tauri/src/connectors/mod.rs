//! Connector marketplace: pre-configured MCP servers with one-click install.
//!
//! The catalog lists well-known MCP servers (GitHub, Filesystem, Brave Search,
//! Postgres, Sentry) with their npx commands, required env vars, and metadata.
//! The installer writes the server config into the target engine's native
//! config file (Claude `~/.claude.json`, Codex `config.toml`, etc.) using the
//! same atomic read-modify-write cycle as the existing MCP toggle logic.

pub mod catalog;
pub mod install;

use serde::{Deserialize, Serialize};

/// A connector in the marketplace catalog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    /// The npx package or command to run (e.g. "@modelcontextprotocol/server-github").
    pub package: String,
    /// Extra args passed after the package name.
    #[serde(default)]
    pub args: Vec<String>,
    /// Environment variables the user must provide (key = env var name).
    pub env_vars: Vec<EnvVarDef>,
    /// Which engines this connector supports ("all" = every engine with MCP).
    #[serde(default)]
    pub engines: Vec<String>,
    /// Optional URL for documentation.
    pub docs_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarDef {
    pub key: String,
    pub label: String,
    pub description: String,
    pub required: bool,
    /// If true, the UI masks the input (password-style).
    #[serde(default)]
    pub secret: bool,
    /// Optional placeholder text.
    pub placeholder: Option<String>,
}

/// Request to install a connector.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallConnectorRequest {
    pub connector_id: String,
    /// Target engine ids; empty = install to all supported engines.
    #[serde(default)]
    pub engines: Vec<String>,
    /// User-provided env var values (key → value).
    #[serde(default)]
    pub env_values: std::collections::HashMap<String, String>,
    /// Optional workspace path for project-scoped install.
    #[serde(default)]
    pub workspace: Option<String>,
}

/// Result of installing a connector.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallConnectorResult {
    pub connector_id: String,
    /// Per-engine results.
    pub results: Vec<EngineInstallResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInstallResult {
    pub engine: String,
    pub success: bool,
    pub message: Option<String>,
}

/// Request to remove a connector.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveConnectorRequest {
    pub connector_id: String,
    #[serde(default)]
    pub engines: Vec<String>,
    #[serde(default)]
    pub workspace: Option<String>,
}

/// List all available connectors in the catalog.
#[tauri::command]
pub fn connector_catalog() -> Vec<ConnectorDef> {
    catalog::all_connectors()
}

/// Install a connector into one or more engine configs.
#[tauri::command]
pub async fn install_connector(
    db: tauri::State<'_, std::sync::Arc<crate::db::Db>>,
    request: InstallConnectorRequest,
) -> Result<InstallConnectorResult, crate::mcp::McpError> {
    install::install(db.inner(), request).await
}

/// Remove a connector from one or more engine configs.
#[tauri::command]
pub async fn remove_connector(
    db: tauri::State<'_, std::sync::Arc<crate::db::Db>>,
    request: RemoveConnectorRequest,
) -> Result<InstallConnectorResult, crate::mcp::McpError> {
    install::remove(db.inner(), request).await
}
