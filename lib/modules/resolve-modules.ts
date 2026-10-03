import { ResolvedModule } from './module-manifest';

/** Thrown when a set of modules cannot be resolved into a startup order. */
export class ModuleResolutionError extends Error {
  constructor(
    message: string,
    /** Id of the offending module, when there is a single one. */
    public moduleId: string | null = null,
  ) {
    super(message);
    this.name = 'ModuleResolutionError';
  }
}

/**
 * Orders a set of modules so that every module comes after the ones it depends
 * on, and refuses the set when it cannot be started safely.
 *
 * It checks what only becomes visible with every module in hand — duplicate
 * ids, missing dependencies and cycles — while `defineModule()` already checked
 * each manifest on its own. Everything here is
 * a startup error: the process must fail before serving a request, never
 * halfway through mounting routes.
 *
 * The order is deterministic: modules with no relation between them keep the
 * order they were given, so two runs of the same installation migrate and mount
 * in the same sequence.
 */
export function resolveModules(modules: ResolvedModule[]): ResolvedModule[] {
  const byId = new Map<string, ResolvedModule>();
  for (const mod of modules) {
    if (byId.has(mod.id)) {
      throw new ModuleResolutionError(
        `Two modules share the id "${mod.id}".`,
        mod.id,
      );
    }
    byId.set(mod.id, mod);
  }

  return sortByDependency(modules);
}

/**
 * Depth-first topological sort. DFS over Kahn's algorithm because it can name
 * the cycle it found: "a -> b -> c -> a" is actionable, "there is a cycle" is
 * not.
 *
 * It is also what refuses a module whose dependency is not there: the edge has
 * to be followed to be sorted, so a missing one cannot slip past.
 */
function sortByDependency(modules: ResolvedModule[]): ResolvedModule[] {
  const byId = new Map(modules.map((mod) => [mod.id, mod]));
  const sorted: ResolvedModule[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const trail: string[] = [];

  const visit = (mod: ResolvedModule): void => {
    if (done.has(mod.id)) return;

    if (visiting.has(mod.id)) {
      const cycle = [...trail.slice(trail.indexOf(mod.id)), mod.id];
      throw new ModuleResolutionError(
        `Dependency cycle: ${cycle.join(' -> ')}.`,
        mod.id,
      );
    }

    visiting.add(mod.id);
    trail.push(mod.id);

    for (const dependency of mod.requires) {
      const next = byId.get(dependency);
      if (!next) {
        throw new ModuleResolutionError(
          `Module "${mod.id}" requires "${dependency}", which is not installed.`,
          mod.id,
        );
      }
      visit(next);
    }

    trail.pop();
    visiting.delete(mod.id);
    done.add(mod.id);
    sorted.push(mod);
  };

  for (const mod of modules) visit(mod);

  return sorted;
}
