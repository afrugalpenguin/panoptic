// Dev-only preview of the landing with synthetic data, for screenshots (docs/plans/2026-10-31-landing.md, Task 12).
// Query string: ?q=<text> types into Seek, ?envs=0 shows no environments, ?engine=connecting|disconnected.
// ?app=start|explorer|query|messages mounts the whole App on a fake sidecar instead (README screenshots).
import { mount } from "svelte";
import "../app/app.css";
import App from "../app/App.svelte";
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
const app = params.get("app");
if (app) await mountApp(app);
else mountLanding();

/** The whole App on the fake sidecar, driven through the DOM to the state asked for. */
async function mountApp(state: string) {
  const { installFakeSidecar } = await import("./fake-sidecar");
  installFakeSidecar();
  // Fresh profile each capture: the same recent objects as the landing states.
  const usage = { envs: { "env:prod": { last: 50, uses: 40 }, "env:dev": { last: 40, uses: 12 }, "env:uat": { last: 30, uses: 3 } }, last: orders, recent };
  try {
    localStorage.setItem("panoptic.usage", JSON.stringify(usage));
    localStorage.setItem("panoptic.treeWidth", "340");
  } catch {}
  document.getElementById("host")!.remove();
  mount(App, { target: document.body, props: { info: { mainStartEpochMs: performance.timeOrigin, benchMode: null } } });
  if (state === "start") return;

  const until = async <T>(find: () => T | null | undefined): Promise<T> => {
    for (let i = 0; i < 200; i++) {
      const found = find();
      if (found) return found;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("preview: element never appeared");
  };
  const row = (label: string) =>
    until(() => [...document.querySelectorAll<HTMLElement>(".tree-row")].find((r) => r.textContent?.replace(/\s+/g, " ").includes(label)));
  const open = async (label: string) => (await row(label)).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

  const expandAll = await until(() => document.querySelector<HTMLButtonElement>('button[aria-label="Expand all"]:not([disabled])'));
  expandAll.click();
  await open("dev-sql-01");
  await open("Sales");
  await open("Tables");
  const target = await row("dbo.Orders");
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  if (state === "explorer") return;

  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 200, clientY: 300 }));
  const item = await until(() => [...document.querySelectorAll<HTMLElement>("[role=menuitem], .menu button")].find((b) => b.textContent?.trim() === "Select top 1000"));
  item.click();
  if (state === "messages") {
    const tab = await until(() => [...document.querySelectorAll<HTMLButtonElement>(".result-tabs button")].find((b) => b.textContent?.startsWith("Messages (")));
    tab.click();
  }
}

function mountLanding() {
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
      onNewConnection: noop,
      onImport: noop,
      onRestart: noop,
    },
  });
}
