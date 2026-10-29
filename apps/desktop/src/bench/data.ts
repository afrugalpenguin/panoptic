// Synthetic fixtures for the M0 benchmarks. Shapes mirror the real tree:
// environment > connection > database > folder > object.

export const KINDS = ["environment", "connection", "database", "folder", "table", "view", "proc", "container"] as const;
export type Kind = (typeof KINDS)[number];

/** Columnar tree in preorder: node i's subtree is [i, i + size[i]). */
export interface TreeData {
  count: number;
  label: string[];
  kind: Uint8Array;
  depth: Uint8Array;
  parent: Int32Array;
  size: Int32Array;
}

const ENVS = ["dev", "uat", "prod", "sandbox-a"];
const FOLDERS: [string, Kind][] = [
  ["Tables", "table"],
  ["Views", "view"],
  ["Stored procedures", "proc"],
  ["Containers", "container"],
  ["Functions", "proc"],
  ["Synonyms", "table"],
];
const CONNECTIONS_PER_ENV = 4;
const DATABASES_PER_CONNECTION = 6;
const WORDS = ["customer", "order", "invoice", "ledger", "tenant", "audit", "product", "shipment", "payment", "session"];

export function generateTree(targetNodes: number): TreeData {
  const folders = ENVS.length * CONNECTIONS_PER_ENV * DATABASES_PER_CONNECTION * FOLDERS.length;
  const structural = ENVS.length * (1 + CONNECTIONS_PER_ENV * (1 + DATABASES_PER_CONNECTION * (1 + FOLDERS.length)));
  const objectsPerFolder = Math.max(1, Math.ceil((targetNodes - structural) / folders));
  const count = structural + folders * objectsPerFolder;

  const tree: TreeData = {
    count,
    label: new Array(count),
    kind: new Uint8Array(count),
    depth: new Uint8Array(count),
    parent: new Int32Array(count),
    size: new Int32Array(count),
  };

  let next = 0;
  const add = (label: string, kind: Kind, depth: number, parent: number) => {
    const i = next++;
    tree.label[i] = label;
    tree.kind[i] = KINDS.indexOf(kind);
    tree.depth[i] = depth;
    tree.parent[i] = parent;
    return i;
  };
  const close = (i: number) => (tree.size[i] = next - i);

  for (const env of ENVS) {
    const e = add(env, "environment", 0, -1);
    for (let c = 0; c < CONNECTIONS_PER_ENV; c++) {
      const conn = add(c % 2 ? `cosmos-${env}-${c}` : `sql-${env}-${c}.database.windows.net`, "connection", 1, e);
      for (let d = 0; d < DATABASES_PER_CONNECTION; d++) {
        const db = add(`${WORDS[d % WORDS.length]}_db`, "database", 2, conn);
        for (const [folderName, objKind] of FOLDERS) {
          const f = add(folderName, "folder", 3, db);
          for (let o = 0; o < objectsPerFolder; o++) {
            const i = add(`dbo.${WORDS[o % WORDS.length]}_${WORDS[(o >> 3) % WORDS.length]}_${o}`, objKind, 4, f);
            tree.size[i] = 1;
          }
          close(f);
        }
        close(db);
      }
      close(conn);
    }
    close(e);
  }
  return tree;
}

/** Indices of visible nodes, in display order. O(n) thanks to preorder layout. */
export function flatten(tree: TreeData, expanded: Uint8Array): Int32Array {
  const out = new Int32Array(tree.count);
  let n = 0;
  for (let i = 0; i < tree.count; ) {
    out[n++] = i;
    i += expanded[i] ? 1 : tree.size[i];
  }
  return out.subarray(0, n);
}

export interface GridData {
  rowCount: number;
  columns: string[];
  /** Columnar: data[col][row]. */
  data: string[][];
}

export function generateGrid(rowCount: number): GridData {
  const columns = ["Id", "TenantId", "Name", "Email", "Status", "Amount", "Currency", "CreatedUtc", "UpdatedUtc", "Region", "Notes", "Version"];
  const statuses = ["active", "pending", "closed", "suspended"];
  const regions = ["uksouth", "ukwest", "westeurope", "northeurope"];
  const data = columns.map(() => new Array<string>(rowCount));
  const base = Date.UTC(2024, 0, 1);

  for (let r = 0; r < rowCount; r++) {
    const word = WORDS[r % WORDS.length];
    data[0][r] = String(r + 1);
    data[1][r] = `t-${(r * 7919) % 500}`;
    data[2][r] = `${word} ${WORDS[(r >> 4) % WORDS.length]} ${r}`;
    data[3][r] = `${word}.${r}@example.com`;
    data[4][r] = statuses[r % statuses.length];
    data[5][r] = ((r * 104729) % 1_000_000 / 100).toFixed(2);
    data[6][r] = r % 3 ? "GBP" : "EUR";
    data[7][r] = new Date(base + r * 60_000).toISOString();
    data[8][r] = new Date(base + r * 90_000).toISOString();
    data[9][r] = regions[r % regions.length];
    data[10][r] = r % 5 ? "" : `Follow up re ${word} batch ${r % 97}`;
    data[11][r] = String(1 + (r % 9));
  }
  return { rowCount, columns, data };
}
