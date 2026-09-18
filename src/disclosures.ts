/** Owns disclosure lifetimes, safe deferred rendering, and focus restoration.
 * DOM adapters choose markup/placement; native close and toggle events own dismissal. */
export class Disclosures {
  private active = new Map<HTMLElement, string>();
  private bound = new WeakSet<HTMLElement>();
  private deferred = false;
  constructor(private render: () => void) {
    document.addEventListener("focusout", () => {
      setTimeout(() => this.flush(), 0);
    });
  }
  get pending(): boolean {
    return this.deferred;
  }
  defer(): void {
    this.deferred = true;
  }
  clear(): void {
    this.deferred = false;
  }
  blocked(): boolean {
    if (!this.active.size) return false;
    this.defer();
    return true;
  }
  open(surface: HTMLElement, trigger: HTMLElement): void {
    if (this.active.has(surface) && this.shown(surface)) return;
    if (!this.bound.has(surface)) {
      this.bound.add(surface);
      const closed = () => {
        const id = this.active.get(surface);
        // Native events are queued; an earlier close must not dismiss a reopened surface.
        if (id === undefined || this.shown(surface)) return;
        this.active.delete(surface);
        const restore =
          surface instanceof HTMLDialogElement ||
          surface.contains(document.activeElement) ||
          document.activeElement === document.body ||
          document.activeElement?.id === id;
        this.flush(restore);
        if (restore && !this.active.size) document.getElementById(id)?.focus();
      };
      if (surface instanceof HTMLDialogElement)
        surface.addEventListener("close", closed);
      else
        surface.addEventListener("toggle", (event) => {
          if ((event as ToggleEvent).newState === "closed") closed();
        });
    }
    this.active.set(surface, trigger.id);
    try {
      if (surface instanceof HTMLDialogElement) surface.showModal();
      else surface.showPopover();
    } catch (error) {
      this.active.delete(surface);
      throw error;
    }
  }
  private shown(surface: HTMLElement): boolean {
    return surface instanceof HTMLDialogElement
      ? surface.open
      : surface.matches(":popover-open");
  }
  private flush(restoreFocus = false): void {
    if (
      !this.deferred ||
      this.active.size ||
      (!restoreFocus &&
        document.activeElement?.matches("input,textarea,select"))
    )
      return;
    this.clear();
    this.render();
  }
}
