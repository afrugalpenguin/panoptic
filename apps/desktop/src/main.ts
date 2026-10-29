import { connectSidecar, type PingResult } from "./sidecar";
import { checkForUpdates, type UpdateState } from "./updates";

const status = document.querySelector<HTMLElement>("#status")!;
const details = document.querySelector<HTMLElement>("#details")!;
const pingButton = document.querySelector<HTMLButtonElement>("#ping")!;
const version = document.querySelector<HTMLElement>("#version")!;
const updateBar = document.querySelector<HTMLElement>("#update")!;

function show(state: "connected" | "disconnected" | "connecting", text: string) {
  status.dataset.state = state;
  status.textContent = text;
}

async function start() {
  show("connecting", "Connecting to sidecar...");
  const rpc = await connectSidecar((code) => {
    show("disconnected", `Sidecar disconnected (exit ${code ?? "unknown"})`);
    pingButton.disabled = true;
  });

  const ping = async () => {
    const t0 = performance.now();
    const r = await rpc.request<PingResult>("ping");
    const roundTripMs = performance.now() - t0;
    show("connected", "Sidecar connected");
    details.textContent = [
      `sidecar start-up   ${r.startupMs} ms (${r.mode})`,
      `ping round trip    ${roundTripMs.toFixed(1)} ms`,
      `ui load to ready   ${performance.now().toFixed(0)} ms`,
      `sidecar            v${r.version}, pid ${r.pid}`,
    ].join("\n");
  };

  pingButton.addEventListener("click", () => ping().catch((e) => show("disconnected", String(e))));
  await ping().catch((e) => show("disconnected", String(e)));
}

function showUpdate(s: UpdateState) {
  version.textContent = `v${s.current}`;
  updateBar.replaceChildren();
  updateBar.hidden = s.kind === "idle";
  if (s.kind === "downloading") updateBar.textContent = `Downloading v${s.next}...`;
  if (s.kind === "error") updateBar.textContent = `Update check failed: ${s.message}`;
  if (s.kind === "ready") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Restart to update";
    button.addEventListener("click", () => {
      button.disabled = true;
      s.install().catch((e) => showUpdate({ kind: "error", current: s.current, message: String(e) }));
    });
    updateBar.append(`v${s.next} is ready. `, button);
  }
}

start();
checkForUpdates(showUpdate);
