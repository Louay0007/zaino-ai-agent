import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
/* The real consumption path: goes through the exports map plus the host's full index.css (the compiled tokens) */
import "../../../src/index.css";
import "@ccgui/plugin-ui/styles.css";
import { Badge, Button, Input, Select, Textarea } from "@ccgui/plugin-ui";

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{children}</div>
    </div>
  );
}

function Panel() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 20,
        background: "var(--color-background-full, #fff)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        minHeight: "100%",
      }}
    >
      <Row label="Button — primary / secondary / ghost / sm / disabled">
        <Button variant="primary">Export PNG + PDF</Button>
        <Button variant="secondary">New</Button>
        <Button variant="ghost">Refresh</Button>
        <Button variant="secondary" size="sm">
          Reveal in Finder
        </Button>
        <Button variant="primary" disabled>
          Working…
        </Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
      </Row>
      <Row label="Input / Select / invalid / disabled">
        <Input style={{ width: 180 }} defaultValue="~/Documents/ccgui-release-notes" />
        <Select style={{ width: 140 }} defaultValue="article.md">
          <option value="article.md">article.md</option>
          <option value="v1.0.6.md">v1.0.6.md</option>
        </Select>
        <Input style={{ width: 120 }} placeholder="deepseek-flash" />
        <Input style={{ width: 120 }} invalid defaultValue="bad value" />
        <Input style={{ width: 100 }} disabled defaultValue="disabled" />
      </Row>
      <Row label="Badge">
        <Badge>v1.0.6</Badge>
        <Badge tone="accent">Switched to ~/Documents</Badge>
        <Badge tone="success">Export complete</Badge>
        <Badge tone="error">Export failed</Badge>
      </Row>
      <Row label="Chat bubbles + composer">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
          <div className="pui-bubble-user">Hi, help me rewrite the announcement in a lighter tone</div>
          <div className="pui-bubble-agent">
            Sure. There is already a finished article in the current directory (article.md, Zaino AI Agent v1.0.6, with 3 feature sections and 5 screenshots).
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <Textarea
              style={{ flex: 1, minHeight: 44 }}
              placeholder="Describe your task; Enter sends, Shift+Enter inserts a newline"
            />
            <Button variant="primary">Send</Button>
          </div>
        </div>
      </Row>
    </div>
  );
}

function App() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: "100vh" }}>
      <Panel />
      <div className="dark">
        <Panel />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
