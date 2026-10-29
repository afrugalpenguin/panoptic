import { connectSidecar, type PingResult } from "./sidecar";

const status = document.querySelector<HTMLElement>("#status")!;
const details = document.querySelector<HTMLElement>("#details")!;
const pingButton = document.querySelector<HTMLButtonElement>("#ping")!;

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

start();
