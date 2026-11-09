// The connection detail pane (docs/connection-pane.md): properties edit in place and save on change (phase 1); the
// session, About and Needs attention come from the sidecar's cache (phase 2).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { ConnectionConfig, EnvironmentConfig, ProbeResult, ServerState, TreeNode } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import { paneNotices, type ConnectionPaneProps } from "./conn-pane";
import ConnectionPane from "./ConnectionPane.svelte";
import { kindBadge, registerKinds } from "./kinds";

// Synthetic names only (the spec's fictional Fabrikam estate).
const prod: EnvironmentConfig = { id: "prod", name: "Prod", color: "#e03131", readOnly: true, connections: [] };
const uat: EnvironmentConfig = { id: "uat", name: "UAT", color: "#f08c00", readOnly: false, connections: [] };
const sqlConn: ConnectionConfig = {
  id: "c2", name: "fabrikam-prod-02.example.test", kind: "sql", endpoint: "fabrikam-prod-02.example.test", auth: "sql",
  user: "report_reader", database: null, trustServerCertificate: false,
};
const db = (name: string): TreeNode => ({ id: `conn:c2/db:${name}`, kind: "database", label: name, icon: "database", hasChildren: true, actions: [] });
const dbs = [db("Sales"), db("Inventory"), db("Reporting")];

beforeAll(() => registerKinds(BUILTIN_KINDS));

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
  paneNotices.clear();
});

function show(over: Partial<ConnectionPaneProps> = {}) {
  const connection = over.connection ?? sqlConn;
  const props: ConnectionPaneProps = {
    connection,
    env: prod,
    label: { prefix: "fabrikam-", core: "prod-02", suffix: ".example.test" },
    badge: kindBadge(connection.kind),
    kind: BUILTIN_KINDS.find((k) => k.kind === connection.kind),
    position: 2,
    total: 4,
    environments: [uat, prod],
    children: () => dbs,
    copyText: connection.name,
    canQuery: true,
    // Never answers unless a test says otherwise: the tile stays "-".
    probe: vi.fn(() => new Promise<ProbeResult[]>(() => {})),
    // No session has opened unless a test says otherwise.
    server: vi.fn(async (): Promise<ServerState> => ({ exceptions: [] })),
    serverRevision: 0,
    onSave: vi.fn(async () => {}),
    onMoveTo: vi.fn(async () => true),
    onMove: vi.fn(),
    onNewQuery: vi.fn(),
    onCopyName: vi.fn(),
    onRefresh: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  const target = document.createElement("div");
  target.style.height = "760px";
  target.style.width = "1100px";
  document.body.append(target);
  mounted = mount(ConnectionPane, { target, props });
  flushSync();
  return props;
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const button = (label: string) => $<HTMLButtonElement>(`button[aria-label="${label}"]`);
const byText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const hostInput = () => $<HTMLInputElement>("#connection-pane-host");
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim();
const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
function type(input: HTMLInputElement, value: string) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}
const rows = () => [...document.querySelectorAll("dt")].map((dt) => text(dt));

describe("ConnectionPane", () => {
  it("shows the colour rule, the engine tile with its environment dot, the split host, its place and the facts line", () => {
    show();
    expect(getComputedStyle($(".connection-pane")).getPropertyValue("--env")).toBe("#e03131");
    expect(document.querySelector(".rule")).not.toBeNull();
    expect(text($(".tile"))).toBe("S");
    expect(document.querySelector(".tile-dot")).not.toBeNull();
    expect($("h2 .dim").textContent).toBe("fabrikam-");
    expect($("h2 .core").textContent).toBe("prod-02");
    expect(text($(".place"))).toBe("Connection · 2 of 4 in Prod");
    expect(text($(".summary"))).toBe("3 databases | checking | SQL | writes read-only from Prod");
  });

  it("says the databases are not listed rather than counting none before the tree has listed them", () => {
    show({ children: () => undefined });
    expect(text($(".summary"))).toContain("databases not listed");
    expect(text($("footer"))).toContain("prod-02: 0 items in");
  });

  it("a loose connection has no rule, no dot and no position, and writes are allowed with no environment", () => {
    show({ env: undefined, position: 1, total: 2 });
    expect(document.querySelector(".rule")).toBeNull();
    expect(document.querySelector(".tile-dot")).toBeNull();
    expect(text($(".place"))).toBe("Loose connection");
    expect(rows()).not.toContain("Position");
    expect(text($(".summary"))).toContain("writes allowed, no environment");
    const policy = [...document.querySelectorAll("dt")].find((dt) => text(dt) === "Write policy")!.nextElementSibling!;
    expect(text(policy)).toBe("Allowedno environment");
    expect(text(policy.querySelector(".tag"))).toBe("no environment");
  });

  it("lists the properties in order, with the engine's name and the inherited write policy", () => {
    show();
    expect(rows()).toEqual(["Host", "Engine", "Environment", "Authentication", "Default database", "Write policy", "Secret", "Position"]);
    const value = (label: string) => text([...document.querySelectorAll("dt")].find((dt) => text(dt) === label)!.nextElementSibling);
    // The badge's letter, then the sidecar's name for the kind.
    expect(value("Engine")).toBe("SSQL Server / Azure SQL");
    expect(value("Write policy")).toBe("Read-onlyinherited");
    expect(value("Secret")).toBe("Encrypted store");
    expect(value("Position")).toBe("2 of 4");
  });

  it("leaves out Default database for a kind without one, and shows no secret for a sign-in that stores none", () => {
    const cosmos: ConnectionConfig = { id: "c9", name: "catalog", kind: "cosmos", endpoint: "https://catalog.example.test:443/", auth: "entra", trustServerCertificate: false };
    show({ connection: cosmos });
    expect(rows()).not.toContain("Default database");
    expect(text([...document.querySelectorAll("dt")].find((dt) => text(dt) === "Secret")!.nextElementSibling)).toBe("none");
  });

  describe("Host", () => {
    it("saves on Enter, and a display name that was the host follows it; the saved password is not carried over", async () => {
      const props = show();
      type(hostInput(), "  fabrikam-prod-03.example.test ");
      press(hostInput(), "Enter");
      await vi.waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith({ ...sqlConn, endpoint: "fabrikam-prod-03.example.test", name: "fabrikam-prod-03.example.test" }),
      );
      expect(props.onSave).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(text($("[role=status]"))).toContain("Enter the password again under Authentication"));
    });

    it("keeps that note when the save remounts the pane, as App's tree reload can", async () => {
      const props = show();
      type(hostInput(), "fabrikam-prod-03.example.test");
      press(hostInput(), "Enter");
      await vi.waitFor(() => expect(props.onSave).toHaveBeenCalled());
      unmount(mounted!);
      document.body.innerHTML = "";
      show({ ...props, connection: { ...sqlConn, endpoint: "fabrikam-prod-03.example.test" } });
      expect(text($("[role=status]"))).toContain("Enter the password again");
    });

    it("saves on blur and keeps a display name the user chose", async () => {
      const props = show({ connection: { ...sqlConn, name: "Orders reporting" } });
      type(hostInput(), "fabrikam-prod-03.example.test");
      hostInput().blur();
      await vi.waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith({ ...sqlConn, name: "Orders reporting", endpoint: "fabrikam-prod-03.example.test" }),
      );
    });

    it("reverts on Escape without saving", async () => {
      const props = show();
      type(hostInput(), "typo.example.test");
      press(hostInput(), "Escape");
      flushSync();
      expect(hostInput().value).toBe(sqlConn.endpoint);
      expect(document.activeElement).not.toBe(hostInput());
      await new Promise((r) => setTimeout(r, 20));
      expect(props.onSave).not.toHaveBeenCalled();
    });

    it("refuses an empty host, restores the previous one and flashes the field", async () => {
      const props = show();
      type(hostInput(), "   ");
      press(hostInput(), "Enter");
      flushSync();
      expect(hostInput().value).toBe(sqlConn.endpoint);
      await vi.waitFor(() => expect(hostInput().classList).toContain("bad"));
      expect(props.onSave).not.toHaveBeenCalled();
    });

    it("surfaces a failed write and puts the host back", async () => {
      show({ onSave: vi.fn(async () => Promise.reject(new Error("This server is already added"))) });
      type(hostInput(), "fabrikam-prod-01.example.test");
      press(hostInput(), "Enter");
      await vi.waitFor(() => expect(text($("[role=alert]"))).toBe("Not saved: This server is already added"));
      expect(hostInput().value).toBe(sqlConn.endpoint);
      expect(document.querySelector("[role=status]")).toBeNull();
    });

    it("probes the new host once it is saved", async () => {
      const probe = vi.fn(async (_fresh: boolean): Promise<ProbeResult[]> => [{ connectionId: "c2", status: "reachable", ms: 3 }]);
      const props = show({ probe });
      expect(probe).toHaveBeenCalledTimes(1);
      // App re-renders with the saved connection.
      unmount(mounted!);
      document.body.innerHTML = "";
      show({ ...props, connection: { ...sqlConn, endpoint: "fabrikam-prod-03.example.test" }, probe });
      expect(probe).toHaveBeenCalledTimes(2);
    });
  });

  describe("Environment", () => {
    it("lists every environment then None (loose), with the current one checked", () => {
      show();
      button("Environment Prod").click();
      flushSync();
      const items = [...document.querySelectorAll<HTMLButtonElement>("[role=menu] [role=menuitemradio]")];
      expect(items.map((i) => [text(i), i.getAttribute("aria-checked")])).toEqual([["UAT", "false"], ["Prod", "true"], ["None (loose)", "false"]]);
    });

    it("moves the connection to the environment picked, and closes", async () => {
      const props = show();
      button("Environment Prod").click();
      flushSync();
      byText("UAT").click();
      await vi.waitFor(() => expect(props.onMoveTo).toHaveBeenCalledWith("uat"));
      flushSync();
      expect(document.querySelector("[role=menu]")).toBeNull();
    });

    it("None (loose) takes it out of its environment; its own environment is no move", async () => {
      const props = show();
      button("Environment Prod").click();
      flushSync();
      byText("Prod").click();
      flushSync();
      expect(props.onMoveTo).not.toHaveBeenCalled();
      button("Environment Prod").click();
      flushSync();
      byText("None (loose)").click();
      await vi.waitFor(() => expect(props.onMoveTo).toHaveBeenCalledWith(null));
    });

    it("Escape closes the menu without moving", () => {
      const props = show();
      button("Environment Prod").click();
      flushSync();
      press(byText("UAT"), "Escape");
      flushSync();
      expect(document.querySelector("[role=menu]")).toBeNull();
      expect(props.onMoveTo).not.toHaveBeenCalled();
    });

    it("surfaces a failed move", async () => {
      show({ onMoveTo: vi.fn(async () => Promise.reject(new Error("store is read-only"))) });
      button("Environment Prod").click();
      flushSync();
      byText("UAT").click();
      await vi.waitFor(() => expect(text($("[role=alert]"))).toBe("Not saved: store is read-only"));
    });
  });

  describe("Authentication", () => {
    const openAuth = () => {
      button("Authentication SQL login").click();
      flushSync();
      return (id: string) => document.getElementById(`cp-${id}`) as HTMLInputElement;
    };
    const saveButton = () => $<HTMLButtonElement>("[role=dialog] button[type=submit]");

    it("opens the New connection dialog's sign-in editor, filled from the connection", () => {
      show();
      const field = openAuth();
      expect((document.getElementById("cp-auth") as HTMLSelectElement).value).toBe("sql");
      expect(field("user").value).toBe("report_reader");
      expect(field("secret").placeholder).toBe("Leave blank to keep the saved one");
      expect(document.querySelector("[role=dialog] .check")).not.toBeNull();
    });

    it("saves a changed sign-in with the password typed, rebinding the secret", async () => {
      const props = show();
      const field = openAuth();
      type(field("user"), "report_writer");
      type(field("secret"), "new-secret");
      saveButton().click();
      await vi.waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "c2", endpoint: sqlConn.endpoint, auth: "sql", user: "report_writer" }), "new-secret"),
      );
      await vi.waitFor(() => expect(document.querySelector("[role=dialog]")).toBeNull());
    });

    it("keeps the saved password when nothing that binds it changed", async () => {
      const props = show();
      openAuth();
      saveButton().click();
      await vi.waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ user: "report_reader" }), undefined));
    });

    it("refuses an empty user, and a changed user without the password, without saving", async () => {
      const props = show();
      const field = openAuth();
      type(field("user"), "  ");
      saveButton().click();
      flushSync();
      expect(text($("[role=dialog] [role=alert]"))).toBe("User is required");
      type(field("user"), "someone-else");
      saveButton().click();
      flushSync();
      expect(text($("[role=dialog] [role=alert]"))).toContain("Enter the password again");
      expect(props.onSave).not.toHaveBeenCalled();
    });

    it("Cancel and Escape close it without saving, and it opens fresh from the saved connection", () => {
      const props = show();
      let field = openAuth();
      type(field("user"), "typo");
      byText("Cancel").click();
      flushSync();
      expect(document.querySelector("[role=dialog]")).toBeNull();
      field = openAuth();
      expect(field("user").value).toBe("report_reader");
      press(field("user"), "Escape");
      flushSync();
      expect(document.querySelector("[role=dialog]")).toBeNull();
      expect(props.onSave).not.toHaveBeenCalled();
    });

    it("keeps the popover open with the failure when the write fails", async () => {
      show({ onSave: vi.fn(async () => Promise.reject(new Error("store is read-only"))) });
      const field = openAuth();
      type(field("secret"), "x");
      saveButton().click();
      await vi.waitFor(() => expect(text($("[role=dialog] [role=alert]"))).toBe("Not saved: store is read-only"));
    });
  });

  describe("Default database", () => {
    it("lists the tree's databases and saves the one picked; None lists every database", async () => {
      const props = show();
      button("Default database None").click();
      flushSync();
      expect([...document.querySelectorAll("[role=menu] [role=menuitemradio]")].map((i) => text(i))).toEqual(["None (list every database)", "Sales", "Inventory", "Reporting"]);
      byText("Inventory").click();
      await vi.waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...sqlConn, database: "Inventory" }, undefined));

      unmount(mounted!);
      document.body.innerHTML = "";
      const set = show({ connection: { ...sqlConn, database: "Sales" }, children: () => [db("Sales")] });
      button("Default database Sales").click();
      flushSync();
      byText("None (list every database)").click();
      await vi.waitFor(() => expect(set.onSave).toHaveBeenCalledWith({ ...sqlConn, database: null }, undefined));
    });

    it("says how to list them when the tree has not", () => {
      show({ children: () => undefined });
      button("Default database None").click();
      flushSync();
      expect(byText("Not listed yet: press R").disabled).toBe(true);
    });
  });

  it("disables the position arrows at the ends and moves by one otherwise", () => {
    const first = show({ position: 1, total: 3 });
    expect(button("Move up").disabled).toBe(true);
    button("Move down").click();
    expect(first.onMove).toHaveBeenCalledWith(1);
    unmount(mounted!);
    document.body.innerHTML = "";
    show({ position: 3, total: 3 });
    expect(button("Move up").disabled).toBe(false);
    expect(button("Move down").disabled).toBe(true);
  });

  it("Remove connection asks through App, with the note under it", () => {
    const props = show();
    byText("Remove connection").click();
    expect(props.onRemove).toHaveBeenCalledOnce();
    expect(text($(".delete p"))).toBe("Deletes the saved connection and its secret. Nothing on the server is touched.");
  });

  it("times listing the children, not a constant, in the footer", () => {
    // A store call that takes measurable time, so the measurement is seen to wrap it.
    const slow = () => {
      const until = performance.now() + 3;
      while (performance.now() < until);
      return dbs;
    };
    show({ children: slow });
    const footer = text($("footer"))!;
    const match = /prod-02: 3 items in ([\d.]+) ms/.exec(footer);
    expect(match).not.toBeNull();
    const ms = Number(match![1]);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(3);
    expect(footer).toContain("Ready");
    expect(footer).toContain("Changes save as you make them");
  });

  it("shows the Ping, Connected and Session tiles (no Catalog yet); Ping fills in when the probe answers", async () => {
    let answer: (r: ProbeResult[]) => void = () => {};
    const probe = vi.fn((_fresh: boolean) => new Promise<ProbeResult[]>((resolve) => (answer = resolve)));
    show({ probe });
    expect(probe).toHaveBeenCalledWith(false);
    expect([...document.querySelectorAll(".tile .key")].map((k) => k.textContent)).toEqual(["Ping", "Connected", "Session"]);
    expect(text($(".tiles .value"))).toBe("-");
    answer([{ connectionId: "c2", status: "reachable", ms: 88 }]);
    await vi.waitFor(() => expect(text($(".tiles .value"))).toBe("88 ms"));
    expect(text($(".tiles .sub"))).toBe("Slow");
    expect(text($(".summary"))).toContain("| slow |");
  });

  it("runs New query, Copy name and Refresh (which probes past the cache)", () => {
    const props = show();
    $<HTMLButtonElement>("button.new").click();
    button("Copy name").click();
    button("Refresh").click();
    expect(props.onNewQuery).toHaveBeenCalledOnce();
    expect(props.onCopyName).toHaveBeenCalledOnce();
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(props.probe).toHaveBeenLastCalledWith(true);
    expect(props.server).toHaveBeenLastCalledWith(true);
  });

  describe("server (phase 2)", () => {
    const now = Date.now();
    const described: ServerState = {
      session: { openedAt: now - 2 * 60_000 - 5_000, handshakeMs: 184.2, identity: "ana.costa@fabrikam.example", authMode: "Microsoft Entra ID", tokenExpiresAt: now + 42 * 60_000 + 30_000 },
      about: [
        { label: "Product", value: "Azure SQL Database", mono: false },
        { label: "Version", value: "12.0.2000.8", detail: "RTM", mono: true },
        { label: "Collation", value: "SQL_Latin1_General_CP1_CI_AS", mono: true },
      ],
      describedAt: now - 60_000,
      databases: { total: 12, online: 9, notOnline: [{ name: "Sales_archive", state: "restoring", error: false }, { name: "Old_ledger", state: "restoring", error: false }, { name: "Ledger", state: "suspect", error: true }] },
      exceptions: [
        { severity: "error", group: "database", subject: "Ledger", detail: "is suspect" },
        { severity: "warn", group: "database", subject: "Old_ledger", detail: "is restoring" },
        { severity: "warn", group: "database", subject: "Sales_archive", detail: "is restoring" },
      ],
    };
    const tile = (key: string) => [...document.querySelectorAll(".tile")].find((t) => t.querySelector(".key")?.textContent === key)!;

    it("reads the sidecar's cache when shown, never refreshing it, and with no session shows no About or Needs attention", async () => {
      const props = show();
      expect(props.server).toHaveBeenCalledExactlyOnceWith(false);
      await Promise.resolve();
      flushSync();
      expect(text(tile("Connected"))).toBe("Connected - not connected");
      expect(text(tile("Session"))).toBe("Session - not connected");
      expect(document.querySelector("[aria-label='About this server']")).toBeNull();
      expect(document.querySelector("[aria-label='Needs attention']")).toBeNull();
    });

    it("shows the session's handshake, age, identity and token time left", async () => {
      show({ server: vi.fn(async () => described) });
      await vi.waitFor(() => expect(text(tile("Connected"))).toBe("Connected 184 ms opened 2 min ago"));
      expect(text(tile("Session"))).toBe("Session ana.costa@fabrikam.example Microsoft Entra ID, token 42 min left");
    });

    it("says pooled when the session started on a connection the driver had already made", async () => {
      show({ server: vi.fn(async () => ({ ...described, session: { ...described.session!, handshakeMs: null } })) });
      await vi.waitFor(() => expect(text(tile("Connected"))).toBe("Connected pooled opened 2 min ago"));
    });

    it("lists the About facts in the backend's order, then Databases with a pill per state", async () => {
      show({ server: vi.fn(async () => described) });
      await vi.waitFor(() => expect(document.querySelector("[aria-label='About this server']")).not.toBeNull());
      const aboutRows = [...document.querySelectorAll(".about-row")].map((r) => text(r));
      expect(aboutRows).toEqual([
        "Product Azure SQL Database",
        "Version 12.0.2000.8RTM",
        "Collation SQL_Latin1_General_CP1_CI_AS",
        "Databases 12 · 9 online 2 restoring1 suspect",
      ]);
      expect([...document.querySelectorAll(".pill, .state-pill")].map((p) => text(p))).toEqual(["2 restoring", "1 suspect"]);
      expect(document.querySelectorAll(".about-row")[2].querySelector("span:last-child")?.classList).toContain("mono");
      expect(text($("[aria-label='About this server'] .next"))).toBe("read on connect, cached");
    });

    it("shows Needs attention for the databases that are not online, red when one is an error", async () => {
      show({ server: vi.fn(async () => described) });
      await vi.waitFor(() => expect(document.querySelector("[aria-label='Needs attention']")).not.toBeNull());
      const strip = $("[aria-label='Needs attention']");
      expect(text(strip.querySelector(".attention-title"))).toBe("3 databases need attention");
      expect([...strip.querySelectorAll(".attention-item")].map((i) => text(i))).toEqual(["Ledger is suspect", "Old_ledger is restoring", "Sales_archive is restoring"]);
      expect(strip.classList).toContain("error");
    });

    it("a single warning reads in the singular and stays amber", async () => {
      show({ server: vi.fn(async () => ({ ...described, exceptions: [described.exceptions[2]] })) });
      await vi.waitFor(() => expect(document.querySelector("[aria-label='Needs attention']")).not.toBeNull());
      expect(text($(".attention-title"))).toBe("1 database needs attention");
      expect($("[aria-label='Needs attention']").classList).not.toContain("error");
    });

    it("says when the server could not be read, keeping what was read before", async () => {
      show({ server: vi.fn(async () => ({ ...described, aboutError: "VIEW SERVER STATE permission was denied" })) });
      await vi.waitFor(() => expect(text($("[aria-label='About this server'] [role=status]"))).toBe("Could not read the server: VIEW SERVER STATE permission was denied"));
      expect(document.querySelectorAll(".about-row")).toHaveLength(4);
    });

    it("keeps the tiles at '-' when the engine does not answer", async () => {
      show({ server: vi.fn(async () => Promise.reject(new Error("The database engine is not running"))) });
      await new Promise((r) => setTimeout(r, 20));
      expect(text(tile("Session"))).toBe("Session - not connected");
    });
  });

  it("keys: C copies, R refreshes, F2 focuses Host, Delete removes; not while typing in a field", () => {
    const props = show();
    const pane = $(".connection-pane");
    press(pane, "c");
    press(pane, "R");
    press(pane, "Delete");
    expect(props.onCopyName).toHaveBeenCalledOnce();
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(props.onRemove).toHaveBeenCalledOnce();
    press(pane, "F2");
    expect(document.activeElement).toBe(hostInput());
    press(hostInput(), "c");
    press(hostInput(), "Delete");
    expect(props.onCopyName).toHaveBeenCalledOnce();
    expect(props.onRemove).toHaveBeenCalledOnce();
  });
});
