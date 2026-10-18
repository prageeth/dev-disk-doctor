export type WorktreeStatus =
  /** In use or recently used. Left alone. */
  | 'active'
  /** Clean, merged or pushed, and idle past the stale threshold. Safe to offer for removal. */
  | 'stale'
  /** Git lists it but the folder is gone. `git worktree prune` clears the record. */
  | 'prunable'
  /** Uncommitted changes, unpushed commits, or could not be checked. Never auto-removed. */
  | 'at-risk'
  | 'locked';

export interface WorktreeInfo {
  repo: string;
  path: string;
  isMain: boolean;
  branch?: string;
  head?: string;
  detached: boolean;
  locked: boolean;
  lockReason?: string;
  exists: boolean;
  prunable: boolean;
  dirty?: boolean;
  /** Commits on this worktree's HEAD that no remote has. */
  unpushed?: number;
  /** HEAD is an ancestor of the repo's default branch. */
  merged?: boolean;
  lastActivityMs?: number;
  idleDays?: number;
  bytes?: number;
  /** AI tool that created it, from its location. */
  toolOwned?: 'claude' | 'codex' | 'cursor' | 'conductor' | 'worktrees-dir';
  status: WorktreeStatus;
  reason: string;
}

/** A folder with a `.git` file whose repository metadata no longer exists. */
export interface OrphanDir {
  path: string;
  gitdir: string;
  bytes?: number;
  idleDays?: number;
  reason: string;
}

export interface RepoAudit {
  repo: string;
  defaultBranch?: string;
  worktrees: WorktreeInfo[];
}

export interface WorktreeAudit {
  rootsScanned: string[];
  repos: RepoAudit[];
  orphans: OrphanDir[];
  totals: {
    repos: number;
    reposWithLinkedWorktrees: number;
    linkedWorktrees: number;
    byStatus: Record<WorktreeStatus, number>;
    orphans: number;
    bytes: number;
  };
}
