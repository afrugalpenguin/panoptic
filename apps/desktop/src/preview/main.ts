// Dev-only preview of the landing with synthetic data, for screenshots (docs/plans/2026-10-31-landing.md, Task 12).
// Query string: ?q=<text> types into Seek, ?envs=0 shows no environments, ?engine=connecting|disconnected.
import { mount } from "svelte";
import "../app/app.css";
import Landing from "../app/Landing.svelte";
import type { SeekEnv, SeekIndex } from "../app/seek";
import type { Place } from "../app/usage";

const host = (env: string, name: string) => ({ id: `env:${env}/conn:${name}`, name, envId: `env:${env}` });
const env = (id: string, name: string, color: string, hosts: string[]): SeekEnv => ({ id: `env:${id}`, name, color, hosts: hosts.map((h) => host(id, h)) });

// Synthetic names only (no real servers or tenants).
const envs: SeekEnv[] = [
  env("dev", "Dev", "#2f9e44", ["dev-sql-01", "uk-dev-pg"]),
  env("prod", "Prod", "#e03131", ["uk-prod-sql-01", "uk-prod-sql-02", "us-prod-sql-01"]),
  env("uat", "UAT", "#f08c00", ["uat-sql-01"]),
  env("test", "Test", "#1971c2", ["test-sql-01"]),
  env("staging", "Staging", "#7048e8", ["stg-sql-01", "stg-cosmos"]),
  env("dr", "DR", "#868e96", ["dr-sql-01"]),
  env("sandbox", "Sandbox", "#0c8599", ["sbx-pg-01"]),
];
const place = (envId: string, hostName: string, nodeId: string, label: string, kind = "table"): Place => ({
  envId: `env:${envId}`, hostId: `env:${envId}/conn:${hostName}`, hostName, nodeId, label, kind,
});
const orders = place("prod", "uk-prod-sql-01", "n1", "dbo.Orders");
const recent = [orders, place("prod", "uk-prod-sql-02", "n2", "dbo.OrderLines"), place("dev", "uk-dev-pg", "n3", "public.customers"), place("uat", "uat-sql-01", "n4", "dbo.usp_Settle", "proc")];

const params = new URLSearchParams(location.search);
const none = params.get("envs") === "0";
const engine = (["connecting", "disconnected"] as const).find((e) => e === params.get("engine")) ?? "connected";
const index: SeekIndex = none
  ? { envs: [], usage: { envs: {}, recent: [] } }
  : {
      envs,
      usage: { envs: { "env:prod": { last: 50, uses: 40 }, "env:dev": { last: 40, uses: 12 }, "env:uat": { last: 30, uses: 3 } }, last: orders, recent },
    };

const target = document.getElementById("host")!;
target.style.height = "100vh";
const noop = () => {};
mount(Landing, {
  target,
  props: {
    index,
    envCount: index.envs.length,
    version: "0.2.0",
    engine,
    // As in the app: only known once the engine is ready.
    openedMs: engine === "connected" ? 412 : undefined,
    query: params.get("q") ?? "",
    onSeekOpen: noop,
    onSeekQuery: noop,
    onSeekLeave: noop,
    onReopen: noop,
    onNewQuery: noop,
    onNewEnvironment: noop,
    onImport: noop,
    onRestart: noop,
  },
});
