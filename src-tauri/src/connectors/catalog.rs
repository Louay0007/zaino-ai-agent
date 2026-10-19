//! Static catalog of well-known MCP connectors available in the marketplace.
//!
//! Each entry describes an npx-based MCP server with its required env vars,
//! supported engines, and display metadata. The installer reads this catalog
//! to construct the correct config snippet for each target engine.

use super::{ConnectorDef, EnvVarDef};

pub fn all_connectors() -> Vec<ConnectorDef> {
    vec![
        github(),
        filesystem(),
        brave_search(),
        postgres(),
        sentry(),
    ]
}

fn github() -> ConnectorDef {
    ConnectorDef {
        id: "github".to_string(),
        name: "GitHub".to_string(),
        description: "Repository management, pull requests, issues, and code search via the GitHub API.".to_string(),
        icon: "github".to_string(),
        category: "developer-tools".to_string(),
        package: "@modelcontextprotocol/server-github".to_string(),
        args: vec![],
        env_vars: vec![EnvVarDef {
            key: "GITHUB_PERSONAL_ACCESS_TOKEN".to_string(),
            label: "Personal Access Token".to_string(),
            description: "A GitHub PAT with repo, read:org, and read:user scopes.".to_string(),
            required: true,
            secret: true,
            placeholder: Some("ghp_xxxxxxxxxxxx".to_string()),
        }],
        engines: vec!["claude".to_string(), "codex".to_string()],
        docs_url: Some("https://github.com/modelcontextprotocol/servers/tree/main/src/github".to_string()),
    }
}

fn filesystem() -> ConnectorDef {
    ConnectorDef {
        id: "filesystem".to_string(),
        name: "Filesystem".to_string(),
        description: "Secure local file access with configurable allowed directories. Read, write, search, and manage files.".to_string(),
        icon: "folder".to_string(),
        category: "developer-tools".to_string(),
        package: "@modelcontextprotocol/server-filesystem".to_string(),
        args: vec!["/tmp".to_string()],
        env_vars: vec![],
        engines: vec!["claude".to_string(), "codex".to_string()],
        docs_url: Some("https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem".to_string()),
    }
}

fn brave_search() -> ConnectorDef {
    ConnectorDef {
        id: "brave-search".to_string(),
        name: "Brave Search".to_string(),
        description: "Web search and content extraction powered by the Brave Search API.".to_string(),
        icon: "search".to_string(),
        category: "integrations".to_string(),
        package: "@modelcontextprotocol/server-brave-search".to_string(),
        args: vec![],
        env_vars: vec![EnvVarDef {
            key: "BRAVE_API_KEY".to_string(),
            label: "Brave Search API Key".to_string(),
            description: "Get a free API key at brave.com/search/api.".to_string(),
            required: true,
            secret: true,
            placeholder: Some("BSA...".to_string()),
        }],
        engines: vec!["claude".to_string(), "codex".to_string()],
        docs_url: Some("https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search".to_string()),
    }
}

fn postgres() -> ConnectorDef {
    ConnectorDef {
        id: "postgres".to_string(),
        name: "PostgreSQL".to_string(),
        description: "Read-only access to PostgreSQL databases. Query schemas, inspect tables, and run SELECT statements.".to_string(),
        icon: "database".to_string(),
        category: "developer-tools".to_string(),
        package: "@modelcontextprotocol/server-postgres".to_string(),
        args: vec![],
        env_vars: vec![EnvVarDef {
            key: "DATABASE_URL".to_string(),
            label: "Database URL".to_string(),
            description: "PostgreSQL connection string (e.g. postgresql://user:pass@localhost:5432/mydb).".to_string(),
            required: true,
            secret: true,
            placeholder: Some("postgresql://user:pass@localhost:5432/mydb".to_string()),
        }],
        engines: vec!["claude".to_string(), "codex".to_string()],
        docs_url: Some("https://github.com/modelcontextprotocol/servers/tree/main/src/postgres".to_string()),
    }
}

fn sentry() -> ConnectorDef {
    ConnectorDef {
        id: "sentry".to_string(),
        name: "Sentry".to_string(),
        description: "Error tracking and performance monitoring. Fetch issues, stack traces, and release data from Sentry.".to_string(),
        icon: "bug".to_string(),
        category: "integrations".to_string(),
        package: "@sentry/mcp-server".to_string(),
        args: vec![],
        env_vars: vec![
            EnvVarDef {
                key: "SENTRY_AUTH_TOKEN".to_string(),
                label: "Auth Token".to_string(),
                description: "A Sentry auth token with org:read and project:read scopes.".to_string(),
                required: true,
                secret: true,
                placeholder: Some("sntrys_xxxxxxxxxxxx".to_string()),
            },
            EnvVarDef {
                key: "SENTRY_ORG".to_string(),
                label: "Organization Slug".to_string(),
                description: "Your Sentry organization slug.".to_string(),
                required: true,
                secret: false,
                placeholder: Some("my-org".to_string()),
            },
        ],
        engines: vec!["claude".to_string(), "codex".to_string()],
        docs_url: Some("https://docs.sentry.io/product/sentry-mcp/".to_string()),
    }
}
