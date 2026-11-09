<script lang="ts">
  // A connection's certificate checks, as label/field pairs in the parent's two-column grid: Trust server certificate
  // with its warning, then the certificate host name and file for kinds that have them. Part of the secret binding, so
  // the connection pane's Authentication popover edits them with the sign-in fields.
  import { open as openFile } from "@tauri-apps/plugin-dialog";
  import type { SignInDraft } from "./sign-in.svelte";

  let { draft, idPrefix = "c" }: { draft: SignInDraft; idPrefix?: string } = $props();

  const id = (name: string) => `${idPrefix}-${name}`;

  async function browseCertificate() {
    const picked = await openFile({ multiple: false, directory: false, filters: [{ name: "Certificates", extensions: ["pem", "cer", "crt", "der"] }] });
    if (typeof picked === "string") draft.certFile = picked;
  }
</script>

<span></span>
<label class="check">
  <input type="checkbox" bind:checked={draft.trust} />
  {draft.fields.trustLocalOnly ? "Skip certificate validation (localhost emulator only)" : "Trust server certificate"}
</label>
{#if draft.trustWarning}<p class="full trust-warning">{draft.trustWarning}</p>{/if}

{#if draft.fields.certificateOptions}
  <label for={id("cert-host")}>Certificate host name <span class="muted">(optional)</span></label>
  <input id={id("cert-host")} bind:value={draft.certHost} placeholder="The name on the certificate, if not the server's" spellcheck="false" autocomplete="off" />
  <label for={id("cert-file")}>Certificate file <span class="muted">(optional)</span></label>
  <span class="file-row">
    <input id={id("cert-file")} bind:value={draft.certFile} placeholder="A CA or server certificate to trust (.pem, .cer)" spellcheck="false" autocomplete="off" />
    <button type="button" onclick={browseCertificate}>Browse...</button>
  </span>
{/if}

<style>
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text) !important;
  }
  .file-row {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  .file-row input {
    flex: 1;
    min-width: 0;
  }
  .trust-warning {
    margin: 0;
    padding: 6px 10px;
    border-radius: 4px;
    color: var(--text);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    border-left: 3px solid var(--warn);
  }
</style>
