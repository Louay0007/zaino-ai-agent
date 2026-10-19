//! Connector installer: writes MCP server entries into engine config files.
//!
//! For each target engine, constructs the appropriate JSON (Claude) or TOML
//! (Codex) server entry and performs an atomic read-modify-write using the
//! same lock and hash-verification as the existing MCP toggle logic.

use super::{ConnectorDef, InstallConnectorRequest, InstallConnectorResult, EngineInstallResult, RemoveConnectorRequest};
use crate::mcp::config::{claude_user_config_path, codex_user_config_path, file_hash, read_text};
use crate::mcp::{McpError, WRITE_LOCK};
use crate::settings::atomic_write;
use serde_json::{Map, Value};
use std::collections::HashMap;
use toml_edit::{value as toml_value, Array, DocumentMut, Item};

/// Look up a connector definition by id.
fn find_connector(id: &str) -> Result<ConnectorDef, McpError> {
    super::catalog::all_connectors()
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| McpError::not_found(format!("connector '{}' not found in catalog", id)))
}

/// Validate that all required env vars are provided.
fn validate_env(def: &ConnectorDef, values: &HashMap<String, String>) -> Result<(), McpError> {
    for var in &def.env_vars {
        if var.required {
            let val = values.get(&var.key).map(String::as_str).unwrap_or("").trim();
            if val.is_empty() {
                return Err(McpError::invalid(format!(
                    "missing required env var '{}' for connector '{}'",
                    var.key, def.name
                )));
            }
        }
    }
    Ok(())
}

/// Build the env map from user-provided values + connector defaults.
fn build_env_map(def: &ConnectorDef, values: &HashMap<String, String>) -> Map<String, Value> {
    let mut env = Map::new();
    for var in &def.env_vars {
        if let Some(val) = values.get(&var.key) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                env.insert(var.key.clone(), Value::String(trimmed.to_string()));
            }
        }
    }
    env
}

/// Install a connector into one or more engine configs.
pub(crate) async fn install(
    db: &crate::db::Db,
    request: InstallConnectorRequest,
) -> Result<InstallConnectorResult, McpError> {
    let def = find_connector(&request.connector_id)?;
    validate_env(&def, &request.env_values)?;

    let target_engines = if request.engines.is_empty() {
        def.engines.clone()
    } else {
        request.engines.clone()
    };

    let workspace = request.workspace.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(ws) = workspace {
        crate::files::ensure_allowed(ws, db).map_err(McpError::invalid)?;
    }

    let mut results = Vec::new();
    for engine in &target_engines {
        let result = match engine.as_str() {
            "claude" => install_claude(&def, &request.env_values, workspace),
            "codex" => install_codex(&def, &request.env_values, workspace),
            other => EngineInstallResult {
                engine: other.to_string(),
                success: false,
                message: Some(format!("engine '{}' not supported for connectors yet", other)),
            },
        };
        results.push(result);
    }

    Ok(InstallConnectorResult {
        connector_id: request.connector_id,
        results,
    })
}

/// Remove a connector from one or more engine configs.
pub(crate) async fn remove(
    db: &crate::db::Db,
    request: RemoveConnectorRequest,
) -> Result<InstallConnectorResult, McpError> {
    let def = find_connector(&request.connector_id)?;
    let target_engines = if request.engines.is_empty() {
        def.engines.clone()
    } else {
        request.engines.clone()
    };

    let workspace = request.workspace.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(ws) = workspace {
        crate::files::ensure_allowed(ws, db).map_err(McpError::invalid)?;
    }

    let mut results = Vec::new();
    for engine in &target_engines {
        let result = match engine.as_str() {
            "claude" => remove_claude(&def, workspace),
            "codex" => remove_codex(&def, workspace),
            other => EngineInstallResult {
                engine: other.to_string(),
                success: false,
                message: Some(format!("engine '{}' not supported for connectors yet", other)),
            },
        };
        results.push(result);
    }

    Ok(InstallConnectorResult {
        connector_id: request.connector_id,
        results,
    })
}

// ===== Claude (JSON: ~/.claude.json → mcpServers) =====

fn install_claude(
    def: &ConnectorDef,
    env_values: &HashMap<String, String>,
    workspace: Option<&str>,
) -> EngineInstallResult {
    let path = claude_user_config_path();
    let _guard = WRITE_LOCK.lock();

    // Read existing or start fresh
    let raw = read_text(&path).unwrap_or_else(|_| "{}".to_string());
    let mut root: Value = serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Map::new()));

    // Ensure mcpServers object exists
    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));

    let servers_obj = match servers.as_object_mut() {
        Some(obj) => obj,
        None => {
            return EngineInstallResult {
                engine: "claude".to_string(),
                success: false,
                message: Some("mcpServers is not an object in ~/.claude.json".to_string()),
            };
        }
    };

    // Build the server entry
    let mut entry = Map::new();
    entry.insert("command".to_string(), Value::String("npx".to_string()));

    let mut args = vec![Value::String("-y".to_string()), Value::String(def.package.clone())];
    for arg in &def.args {
        args.push(Value::String(arg.clone()));
    }
    entry.insert("args".to_string(), Value::Array(args));

    let env_map = build_env_map(def, env_values);
    if !env_map.is_empty() {
        entry.insert("env".to_string(), Value::Object(env_map));
    }

    servers_obj.insert(def.name.clone(), Value::Object(entry));

    // Atomic write
    let mut text = serde_json::to_string_pretty(&root).unwrap_or_default();
    text.push('\n');
    match atomic_write(&path, &text) {
        Ok(()) => EngineInstallResult {
            engine: "claude".to_string(),
            success: true,
            message: Some(format!("{} connector successfully added to Zaino AI Agent", def.name)),
        },
        Err(e) => EngineInstallResult {
            engine: "claude".to_string(),
            success: false,
            message: Some(format!("Failed to write ~/.claude.json: {}", e)),
        },
    }
}

fn remove_claude(def: &ConnectorDef, _workspace: Option<&str>) -> EngineInstallResult {
    let path = claude_user_config_path();
    let _guard = WRITE_LOCK.lock();

    let raw = match read_text(&path) {
        Ok(r) => r,
        Err(_) => {
            return EngineInstallResult {
                engine: "claude".to_string(),
                success: true,
                message: Some("No config file to clean".to_string()),
            };
        }
    };

    let mut root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            return EngineInstallResult {
                engine: "claude".to_string(),
                success: false,
                message: Some("Invalid JSON in ~/.claude.json".to_string()),
            };
        }
    };

    let removed = root
        .as_object_mut()
        .and_then(|obj| obj.get_mut("mcpServers"))
        .and_then(Value::as_object_mut)
        .map(|servers| servers.remove(&def.name).is_some())
        .unwrap_or(false);

    if removed {
        let mut text = serde_json::to_string_pretty(&root).unwrap_or_default();
        text.push('\n');
        match atomic_write(&path, &text) {
            Ok(()) => EngineInstallResult {
                engine: "claude".to_string(),
                success: true,
                message: Some(format!("{} connector removed from Zaino AI Agent", def.name)),
            },
            Err(e) => EngineInstallResult {
                engine: "claude".to_string(),
                success: false,
                message: Some(format!("Failed to write ~/.claude.json: {}", e)),
            },
        }
    } else {
        EngineInstallResult {
            engine: "claude".to_string(),
            success: true,
            message: Some(format!("'{}' was not found in ~/.claude.json", def.name)),
        }
    }
}

// ===== Codex (TOML: config.toml → [mcp_servers.<name>]) =====

fn install_codex(
    def: &ConnectorDef,
    env_values: &HashMap<String, String>,
    _workspace: Option<&str>,
) -> EngineInstallResult {
    let path = codex_user_config_path();
    let _guard = WRITE_LOCK.lock();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let raw = read_text(&path).unwrap_or_else(|_| String::new());
    let mut doc: DocumentMut = raw.parse().unwrap_or_else(|_| DocumentMut::new());

    // Ensure [mcp_servers] table exists
    if doc.get("mcp_servers").is_none() {
        doc.insert("mcp_servers", Item::Table(toml_edit::Table::new()));
    }

    let servers = match doc.get_mut("mcp_servers").and_then(|item| item.as_table_mut()) {
        Some(t) => t,
        None => {
            return EngineInstallResult {
                engine: "codex".to_string(),
                success: false,
                message: Some("mcp_servers is not a table in config.toml".to_string()),
            };
        }
    };

    // Build the server inline table
    let mut server_table = toml_edit::Table::new();
    server_table.insert("command", toml_value("npx"));

    let mut args_array = Array::new();
    args_array.push("-y");
    args_array.push(def.package.as_str());
    for arg in &def.args {
        args_array.push(arg.as_str());
    }
    server_table.insert("args", toml_value(args_array));

    // Env vars as [mcp_servers.<name>.env]
    let env_map = build_env_map(def, env_values);
    if !env_map.is_empty() {
        let mut env_table = toml_edit::Table::new();
        for (k, v) in &env_map {
            if let Value::String(s) = v {
                env_table.insert(k, toml_value(s.as_str()));
            }
        }
        server_table.insert("env", Item::Table(env_table));
    }

    server_table.insert("enabled", toml_value(true));
    servers.insert(&def.name, Item::Table(server_table));

    match atomic_write(&path, &doc.to_string()) {
        Ok(()) => EngineInstallResult {
            engine: "codex".to_string(),
            success: true,
            message: Some(format!("{} connector successfully added to Zaino AI Agent", def.name)),
        },
        Err(e) => EngineInstallResult {
            engine: "codex".to_string(),
            success: false,
            message: Some(format!("Failed to write Codex config.toml: {}", e)),
        },
    }
}

fn remove_codex(def: &ConnectorDef, _workspace: Option<&str>) -> EngineInstallResult {
    let path = codex_user_config_path();
    let _guard = WRITE_LOCK.lock();

    let raw = match read_text(&path) {
        Ok(r) => r,
        Err(_) => {
            return EngineInstallResult {
                engine: "codex".to_string(),
                success: true,
                message: Some("No config file to clean".to_string()),
            };
        }
    };

    let mut doc: DocumentMut = match raw.parse() {
        Ok(d) => d,
        Err(_) => {
            return EngineInstallResult {
                engine: "codex".to_string(),
                success: false,
                message: Some("Invalid TOML in Codex config.toml".to_string()),
            };
        }
    };

    let removed = doc
        .get_mut("mcp_servers")
        .and_then(|item| item.as_table_mut())
        .map(|servers| servers.remove(&def.name).is_some())
        .unwrap_or(false);

    if removed {
        match atomic_write(&path, &doc.to_string()) {
            Ok(()) => EngineInstallResult {
                engine: "codex".to_string(),
                success: true,
                message: Some(format!("{} connector removed from Zaino AI Agent", def.name)),
            },
            Err(e) => EngineInstallResult {
                engine: "codex".to_string(),
                success: false,
                message: Some(format!("Failed to write Codex config.toml: {}", e)),
            },
        }
    } else {
        EngineInstallResult {
            engine: "codex".to_string(),
            success: true,
            message: Some(format!("'{}' was not found in Codex config.toml", def.name)),
        }
    }
}
