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
      if (surface instanceof HTMLDialogElement) {
        surface.addEventListener("keydown", (event) => {
          if (event.key !== "Tab") return;
          const controls = [
            ...surface.querySelectorAll<HTMLElement>(
              "a[href], button, input, textarea, select, summary, [tabindex]",
            ),
          ].filter(
            (el) =>
              el.tabIndex >= 0 &&
              !el.matches(":disabled") &&
              el.getClientRects().length > 0 &&
              getComputedStyle(el).visibility !== "hidden",
          );
          if (!controls.length) {
            event.preventDefault();
            surface.focus();
            return;
          }
          const first = controls[0],
            last = controls[controls.length - 1];
          if (
            !surface.contains(document.activeElement) ||
            (event.shiftKey && document.activeElement === first) ||
            (!event.shiftKey && document.activeElement === last)
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        });
        // A gesture that starts in a field must not dismiss the form when released outside.
        let startedOnBackdrop = false;
        const outside = (event: MouseEvent) => {
          const bounds = surface.getBoundingClientRect();
          return (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          );
        };
        surface.addEventListener("pointerdown", (event) => {
          startedOnBackdrop =
            event.isPrimary &&
            event.button === 0 &&
            event.target === surface &&
            outside(event);
        });
        surface.addEventListener("pointercancel", () => {
          startedOnBackdrop = false;
        });
        surface.addEventListener("click", (event) => {
          const dismiss =
            startedOnBackdrop && event.target === surface && outside(event);
          startedOnBackdrop = false;
          if (dismiss) surface.close();
        });
        surface.addEventListener("close", () => {
          startedOnBackdrop = false;
        });
        surface.addEventListener("close", closed);
      } else
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
