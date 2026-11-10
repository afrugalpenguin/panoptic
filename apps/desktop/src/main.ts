import { mount } from "svelte";
import App from "./app/App.svelte";
import "./app/app.css";
import { trackInputModality } from "./app/focus";
import { getStartupInfo } from "./startup";

const info = await getStartupInfo();
if (info.benchMode === "ui") {
  location.replace("/bench.html?auto=1");
} else {
  trackInputModality();
  mount(App, { target: document.body, props: { info } });
}
