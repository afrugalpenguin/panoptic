<script lang="ts">
  // The sign-in fields of a connection, as label/field pairs in the parent's two-column grid: Authentication, then
  // whatever it needs (user, client certificate, AWS profile, secret, tenant and client id). The New connection dialog
  // and the connection pane's Authentication popover both use it.
  import { open as openFile } from "@tauri-apps/plugin-dialog";
  import type { SignInDraft } from "./sign-in.svelte";

  let {
    draft,
    keepsSaved,
    idPrefix = "c",
  }: {
    draft: SignInDraft;
    /** A saved secret can be kept: the secret field says a blank keeps it. */
    keepsSaved: boolean;
    /** Field ids are `${idPrefix}-auth` and so on, unique on the page. */
    idPrefix?: string;
  } = $props();

  const id = (name: string) => `${idPrefix}-${name}`;

  $effect(() => {
    if (!draft.authOptions.some((o) => o.id === draft.auth)) draft.auth = draft.authOptions[0].id;
  });

  async function browse(name: string, extensions: string[], set: (path: string) => void) {
    const picked = await openFile({ multiple: false, directory: false, filters: [{ name, extensions }] });
    if (typeof picked === "string") set(picked);
  }
</script>

<label for={id("auth")}>Authentication</label>
<select id={id("auth")} bind:value={draft.auth}>
  {#each draft.authOptions as o}<option value={o.id}>{o.label}</option>{/each}
</select>

{#if draft.login}
  <label for={id("user")}>User</label>
  <input id={id("user")} bind:value={draft.user} spellcheck="false" autocomplete="off" />
{:else if draft.entraUser}
  <label for={id("user")}>User <span class="muted">(optional)</span></label>
  <input id={id("user")} bind:value={draft.user} placeholder="Defaults to the account you sign in with" spellcheck="false" autocomplete="off" />
{/if}

{#if draft.certAuth}
  <label for={id("client-cert")}>Client certificate</label>
  <span class="file-row">
    <input id={id("client-cert")} bind:value={draft.clientCert} placeholder="The certificate to sign in with (.crt, .pem, or a .pfx with its key)" spellcheck="false" autocomplete="off" />
    <button type="button" onclick={() => browse("Certificates", ["crt", "pem", "cer", "pfx", "p12"], (p) => (draft.clientCert = p))}>Browse...</button>
  </span>
  {#if !draft.bundle}
    <label for={id("client-key")}>Key file</label>
    <span class="file-row">
      <input id={id("client-key")} bind:value={draft.clientKey} placeholder="The certificate's private key (.key, .pem)" spellcheck="false" autocomplete="off" />
      <button type="button" onclick={() => browse("Private keys", ["key", "pem"], (p) => (draft.clientKey = p))}>Browse...</button>
    </span>
  {/if}
{/if}

{#if draft.awsAuth}
  <label for={id("aws-profile")}>AWS profile <span class="muted">(optional)</span></label>
  <input id={id("aws-profile")} bind:value={draft.awsProfile} placeholder="default" spellcheck="false" autocomplete="off" />
  <label for={id("aws-region")}>Region</label>
  <input id={id("aws-region")} bind:value={draft.awsRegion} placeholder={draft.rdsRegion || "Required for this server name"} spellcheck="false" autocomplete="off" />
{/if}

{#if draft.showSecret}
  <label for={id("secret")}>{draft.auth === "key" ? "Account key" : draft.certAuth ? "Key passphrase" : "Password"}{#if draft.certAuth} <span class="muted">(optional)</span>{/if}</label>
  <input
    id={id("secret")}
    type="password"
    bind:value={draft.secret}
    autocomplete="off"
    placeholder={keepsSaved ? "Leave blank to keep the saved one" : ""}
  />
{/if}

{#if draft.entra}
  <label for={id("tenant")}>Tenant <span class="muted">(optional)</span></label>
  <input id={id("tenant")} bind:value={draft.tenantId} placeholder="Defaults to your work account's tenant" spellcheck="false" />
  <label for={id("client")}>Client id <span class="muted">(optional)</span></label>
  <input id={id("client")} bind:value={draft.clientId} placeholder="An app registration's ID, if your tenant needs its own" spellcheck="false" autocomplete="off" />
{/if}

<style>
  .file-row {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  .file-row input {
    flex: 1;
    min-width: 0;
  }
</style>
