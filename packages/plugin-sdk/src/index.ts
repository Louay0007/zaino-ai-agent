/**
 * @ccgui/plugin-sdk — the plugin system contract package (single source of truth).
 *
 * The host (src/features/plugins/) implements the interfaces defined here;
 * plugins (separate repos) depend only on these types and constants. The
 * version evolves independently (see CHANGELOG.md); a plugin declares its
 * compatible range via the manifest's `sdkVersion` range, handshaked at load time.
 *
 * This file is a pure re-export barrel; the implementation is split by concern into sibling modules:
 * - manifest.ts     base types + PluginManifest / JSON Schema (zero runtime deps)
 * - permissions.ts  the full permission set and network:/exec: grants (zero deps, Node-usable)
 * - version.ts      SDK_VERSION / version comparison and range evaluation (zero deps)
 * - registry.ts     extension point Def types + Registry/useRegistry + registration singletons
 *                   (the only module in the package that depends on the React runtime)
 * - context.ts      the PluginContext facade interface (types only)
 *
 * The single source of truth for permission/grant shapes is spec/permissions.json (consumed by
 * TS, Rust, and the template alike). The layered trust model is in
 * .omx/plans/plugin-system-plan.md ADR-1.
 */

export * from "./manifest";
export * from "./permissions";
export * from "./version";
export * from "./registry";
export * from "./context";
/**
 * The compile anchor for the type-drift guard (P3): contract-check.ts is
 * pure types with no runtime code, but it only joins the typecheck if something
 * in the compile graph references it. It used to be neither in the barrel nor
 * imported by anyone, so neither the host's `tsc --noEmit` nor the package's own
 * typecheck script covered it, and drift between plugin.d.ts and src/* could ship
 * silently. This side-effect import pulls the guard into the compile graph for
 * every compilation unit that imports this package (including the host build's
 * tsc phase) — with zero runtime output.
 */
import "./contract-check";
