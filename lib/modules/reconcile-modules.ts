import { ResolvedModule } from './module-manifest';

/**
 * A module as the installation remembers it: the id, and nothing else.
 *
 * There is no version here because a module does not have one. The modules are
 * the application, released together, so a per-module version could only ever
 * say what the application's already says — and while it existed it read as a
 * compatibility contract between modules, which it never was.
 */
export interface ModuleState {
  id: string;
}

/**
 * A module that is recorded but whose code is gone: an uninstalled package, a
 * renamed id, a deploy that dropped a folder. Its data is untouched.
 */
export type ModuleOrphan = ModuleState;

export interface Reconciliation {
  install: ModuleState[];
  orphaned: ModuleOrphan[];
}

/**
 * Compares the modules present in the code against what the installation
 * recorded, and says what changed. Pure on purpose: the decision is the part
 * worth testing, and it can be reviewed without a database.
 *
 * Every module present in the code runs: there is no on and off. What limits
 * who reaches what is permissions, which is the application's policy and has
 * nothing to do with what is deployed.
 *
 * A module whose code disappeared is **reported, never deleted**. Dropping the
 * row is a decision about data, and it belongs to whoever runs the install, not
 * to a boot sequence.
 */
export function reconcileModules(
  code: ResolvedModule[],
  stored: ModuleState[],
): Reconciliation {
  const storedIds = new Set(stored.map((record) => record.id));
  const codeIds = new Set(code.map((mod) => mod.id));

  const install = code
    .filter((mod) => !storedIds.has(mod.id))
    .map((mod) => ({ id: mod.id }));

  const orphaned = stored.filter((record) => !codeIds.has(record.id));

  return { install, orphaned };
}
