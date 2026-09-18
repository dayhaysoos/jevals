import type {
  Evaluation,
  Suite,
  RunSummary,
  RunView,
  RunHistoryPage,
} from "./types.js";

export type EvaluationDocument = Evaluation & {
  runs: RunSummary[];
  runCursor: number | null;
  selectedRun: RunView | null;
  bestRuns: Record<string, RunSummary | null>;
};
export interface WorkspaceView {
  includeRun: boolean;
  runId?: string;
}
export interface WorkspacePersistence {
  read(
    id: string,
    signal?: AbortSignal,
    view?: WorkspaceView,
  ): Promise<EvaluationDocument>;
  history(id: string, before: number): Promise<RunHistoryPage>;
  write(
    id: string,
    suite: Suite,
    revision: number,
    signal?: AbortSignal,
  ): Promise<Evaluation>;
  archive(
    id: string,
    archived: boolean,
    revision: number,
    signal?: AbortSignal,
  ): Promise<Evaluation>;
}
interface Draft {
  suite: Suite;
  baseline: Suite;
  revision: number;
  dirty: boolean;
  archivedAt: string | null;
  selected: number;
}

/** Owns draft/revision policy; DOM focus, rendering and URLs belong to the browser adapter. */
export class EvaluationWorkspace {
  private readonly drafts = new Map<string, Draft>();
  private readonly writing = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private currentId: string | null = null;
  private currentRuns: RunSummary[] = [];
  private currentRun: RunView | null = null;
  private currentBest: Record<string, RunSummary | null> = {};
  private cursor: number | null = null;
  private expandedHistory = false;
  private loadingHistory = 0;
  private selection = 0;
  private pendingSelection = 0;
  private view: WorkspaceView = { includeRun: false };
  private navigation = 0;
  private refreshVersion = 0;
  constructor(private readonly persistence: WorkspacePersistence) {}

  /** Notify the browser adapter when write ownership changes, without replacing focused controls. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get id() {
    return this.currentId;
  }
  /** Editable document reference. Call markDirty after a synchronous edit. */
  get suite(): Suite {
    return this.current().suite;
  }
  get revision() {
    return this.current().revision;
  }
  get dirty() {
    return this.currentId ? this.current().dirty : false;
  }
  get archivedAt() {
    return this.currentId ? this.current().archivedAt : null;
  }
  get runs() {
    return this.currentId ? this.currentRuns : [];
  }
  get run() {
    return this.currentRun;
  }
  get bestRuns() {
    return this.currentBest;
  }
  get runCursor() {
    return this.cursor;
  }
  get isLoadingHistory() {
    return this.loadingHistory !== 0;
  }

  async loadMoreRuns() {
    const id = this.currentId,
      before = this.cursor,
      navigation = this.navigation;
    if (!id || before === null || this.loadingHistory) return false;
    this.loadingHistory = navigation;
    try {
      const page = await this.persistence.history(id, before);
      if (navigation !== this.navigation || before !== this.cursor)
        return false;
      const seen = new Set(this.currentRuns.map((r) => r.id));
      this.currentRuns.push(...page.runs.filter((r) => !seen.has(r.id)));
      this.cursor = page.nextCursor;
      this.expandedHistory = true;
      return true;
    } catch (error) {
      if (navigation !== this.navigation) return false;
      throw error;
    } finally {
      if (this.loadingHistory === navigation) this.loadingHistory = 0;
    }
  }
  async selectRun(runId: string) {
    const id = this.currentId,
      navigation = this.navigation;
    if (!id) return false;
    const selection = ++this.selection;
    this.pendingSelection = selection;
    const view = { includeRun: true, runId };
    try {
      const document = await this.persistence.read(id, undefined, view);
      if (navigation !== this.navigation || selection !== this.selection)
        return false;
      this.receive(document);
      this.receiveHistory(document);
      this.view = view;
      return true;
    } catch (error) {
      if (navigation !== this.navigation || selection !== this.selection)
        return false;
      throw error;
    } finally {
      if (this.pendingSelection === selection) this.pendingSelection = 0;
    }
  }
  private receiveHistory(document: EvaluationDocument, reset = false) {
    const previous = new Set(this.currentRuns.map((r) => r.id));
    // A nonoverlapping new head could hide a gap; restart paging instead of claiming completeness.
    if (
      reset ||
      !this.expandedHistory ||
      !document.runs.some((r) => previous.has(r.id))
    ) {
      this.currentRuns = document.runs;
      this.cursor = document.runCursor;
      this.expandedHistory = false;
    } else {
      const seen = new Set(document.runs.map((r) => r.id));
      this.currentRuns = [
        ...document.runs,
        ...this.currentRuns.filter((r) => !seen.has(r.id)),
      ];
    }
    this.currentRun = document.selectedRun;
    this.currentBest = document.bestRuns;
  }
  get selected() {
    return this.currentId ? this.current().selected : 0;
  }
  set selected(index: number) {
    const draft = this.current();
    draft.selected = Math.min(
      Math.max(0, index),
      Math.max(0, draft.suite.cases.length - 1),
    );
  }
  isSaving(id: string) {
    return this.writing.has(id);
  }
  hasUnsavedChanges(id?: string) {
    return id === undefined
      ? [...this.drafts.values()].some((d) => d.dirty)
      : (this.drafts.get(id)?.dirty ?? false);
  }
  canMutate(id: string) {
    return !this.hasUnsavedChanges(id) && !this.isSaving(id);
  }
  markDirty() {
    this.current().dirty = true;
  }

  /** Commit only the latest navigation, after all adapter reads are ready. */
  async navigate(
    id: string | null,
    ready: () => Promise<void> = async () => {},
    view: WorkspaceView = { includeRun: false },
  ) {
    const version = ++this.navigation;
    try {
      const [document] = await Promise.all([
        id ? this.persistence.read(id, undefined, view) : null,
        ready(),
      ]);
      if (version !== this.navigation) return false;
      if (document) this.receive(document);
      this.currentId = id;
      this.expandedHistory = false;
      this.loadingHistory = 0;
      this.pendingSelection = 0;
      this.view = view;
      if (document) this.receiveHistory(document, true);
      else {
        this.currentRuns = [];
        this.currentRun = null;
        this.currentBest = {};
        this.cursor = null;
      }
      return true;
    } catch (error) {
      if (version !== this.navigation) return false;
      throw error;
    }
  }

  /** Stale refreshes never restore an earlier route or replace a newer document. */
  async refresh(ready: () => Promise<void> = async () => {}) {
    if (this.pendingSelection) return false;
    const selection = this.selection;
    const id = this.currentId;
    const navigation = this.navigation;
    const version = ++this.refreshVersion;
    try {
      const [document] = await Promise.all([
        id ? this.persistence.read(id, undefined, this.view) : null,
        ready(),
      ]);
      if (
        navigation !== this.navigation ||
        version !== this.refreshVersion ||
        selection !== this.selection
      )
        return false;
      if (document) {
        this.receive(document);
        this.receiveHistory(document);
      }
      return true;
    } catch (error) {
      if (
        navigation !== this.navigation ||
        version !== this.refreshVersion ||
        selection !== this.selection
      )
        return false;
      throw error;
    }
  }

  async save(id: string) {
    const draft = this.drafts.get(id);
    if (!draft) throw Error("Open this evaluation before saving.");
    return this.exclusive(id, async () => {
      const snapshot = structuredClone(draft.suite);
      const revision = draft.revision;
      const saved = await this.persistence.write(id, snapshot, revision);
      this.accept(saved, revision);
      return saved;
    });
  }

  /** Agent edits share write ownership and reconciliation with human edits. */
  async mutateSaved(
    id: string,
    revision: number,
    edit: (suite: Suite) => void,
    signal?: AbortSignal,
  ) {
    this.requireClean(id);
    return this.exclusive(id, async () => {
      const current = await this.persistence.read(id, signal);
      // A human may begin editing while the agent's read is pending.
      this.requireClean(id);
      if (revision !== current.revision)
        throw Error(
          "Revision is stale. Read the evaluation and review the latest definition before updating.",
        );
      this.receive(current, true);
      const suite = structuredClone(current.suite);
      edit(suite);
      const saved = await this.persistence.write(id, suite, revision, signal);
      this.accept(saved, revision);
      return saved;
    });
  }

  async changeArchive(
    id: string,
    archived: boolean,
    revision: number,
    signal?: AbortSignal,
  ) {
    this.requireClean(id);
    return this.exclusive(id, async () => {
      const saved = await this.persistence.archive(
        id,
        archived,
        revision,
        signal,
      );
      this.accept(saved, revision);
      return saved;
    });
  }

  private current() {
    const draft = this.currentId && this.drafts.get(this.currentId);
    if (!draft) throw Error("No evaluation is open.");
    return draft;
  }
  private requireClean(id: string) {
    if (this.hasUnsavedChanges(id))
      throw Error(
        "This evaluation has unsaved UI edits. Save them before an agent changes, archives or runs it.",
      );
  }
  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.writing.has(id))
      throw Error("This evaluation is being saved. Wait for it to finish.");
    this.writing.add(id);
    this.changed();
    try {
      return await work();
    } finally {
      this.writing.delete(id);
      this.changed();
    }
  }
  private changed() {
    for (const listener of this.listeners)
      queueMicrotask(() => {
        if (this.listeners.has(listener)) listener();
      });
  }
  private receive(document: EvaluationDocument, duringWrite = false) {
    const draft = this.drafts.get(document.id);
    if (!draft) {
      const suite = structuredClone(document.suite);
      this.drafts.set(document.id, {
        suite,
        baseline: structuredClone(suite),
        revision: document.revision,
        dirty: false,
        archivedAt: document.archivedAt ?? null,
        selected: 0,
      });
      return;
    }
    if (document.revision < draft.revision) return;
    draft.archivedAt = document.archivedAt ?? null;
    // Refresh cannot decide what was saved while a write is still in flight.
    if (draft.dirty || (!duringWrite && this.writing.has(document.id))) return;
    draft.suite = structuredClone(document.suite);
    draft.baseline = structuredClone(draft.suite);
    draft.revision = document.revision;
    draft.selected = Math.min(
      draft.selected,
      Math.max(0, draft.suite.cases.length - 1),
    );
  }
  private accept(saved: Evaluation, previousRevision: number) {
    const draft = this.drafts.get(saved.id);
    if (!draft) {
      this.receive({
        ...saved,
        runs: [],
        runCursor: null,
        selectedRun: null,
        bestRuns: {},
      });
      return;
    }
    if (draft.revision !== previousRevision) return;
    const suite = structuredClone(saved.suite);
    // Comparing with the old baseline distinguishes a new human edit from an agent edit.
    const edited =
      JSON.stringify(structuredClone(draft.suite)) !==
      JSON.stringify(draft.baseline);
    if (!edited) draft.suite = suite;
    draft.baseline = structuredClone(suite);
    draft.revision = saved.revision;
    draft.archivedAt = saved.archivedAt ?? null;
    draft.dirty =
      JSON.stringify(structuredClone(draft.suite)) !== JSON.stringify(suite);
  }
}
