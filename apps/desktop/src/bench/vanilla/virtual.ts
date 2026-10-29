import { OVERSCAN } from "../types";

/**
 * Fixed-height virtual list: a spacer sized to every row, and a translated window holding a
 * recycled pool of row elements. Only rows whose index changed are re-rendered.
 */
export class VirtualRows {
  readonly scroller: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly window: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly poolIndex: number[] = [];
  private count = 0;

  constructor(
    host: HTMLElement,
    private readonly rowHeight: number,
    private readonly createRow: () => HTMLDivElement,
    private readonly renderRow: (el: HTMLDivElement, index: number) => void,
  ) {
    this.scroller = el("div", "v-scroller");
    this.spacer = el("div", "v-spacer");
    this.window = el("div", "v-window");
    this.spacer.append(this.window);
    this.scroller.append(this.spacer);
    host.append(this.scroller);
    this.scroller.addEventListener("scroll", () => this.update(), { passive: true });
  }

  setCount(count: number): void {
    this.count = count;
    this.spacer.style.height = `${count * this.rowHeight}px`;
    this.poolIndex.fill(-2);
    this.update();
  }

  update(): void {
    const h = this.rowHeight;
    const start = Math.max(0, Math.floor(this.scroller.scrollTop / h) - OVERSCAN);
    const visible = Math.ceil(this.scroller.clientHeight / h) + 2 * OVERSCAN;

    while (this.pool.length < visible) {
      const row = this.createRow();
      this.pool.push(row);
      this.poolIndex.push(-2);
      this.window.append(row);
    }

    this.window.style.transform = `translateY(${start * h}px)`;
    for (let k = 0; k < this.pool.length; k++) {
      const index = start + k;
      const row = this.pool[k];
      if (index >= this.count) {
        if (this.poolIndex[k] !== -1) {
          row.style.display = "none";
          this.poolIndex[k] = -1;
        }
        continue;
      }
      if (this.poolIndex[k] === index) continue;
      if (this.poolIndex[k] === -1) row.style.display = "";
      this.poolIndex[k] = index;
      this.renderRow(row, index);
    }
  }

  destroy(): void {
    this.scroller.remove();
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
