import { Database } from './database';
import { Container, ContractError } from './container';
import { loadModuleProviders, loadModuleStrategies } from './module-loader';
import { ResolvedModule } from './module-manifest';

/**
 * Builds the container from the modules that are actually active, and refuses
 * a set where something consumed is provided by nobody.
 *
 * The check runs at startup on purpose. Without it, a missing provider surfaces
 * on the first request that happens to need it — in production, on whichever
 * endpoint a user reached first. Declaring `consumes` is what buys that: the
 * framework cannot see which contracts a module calls by reading its code.
 *
 * Registration follows dependency order, so the error names the module that
 * asked before any of its dependents complicate the picture.
 */
export async function buildContainer(
  modules: ResolvedModule[],
  db: Database,
): Promise<Container> {
  const container = new Container(db);

  for (const mod of modules) {
    // Two folders, two relationships. `providers/` is how the module answers
    // the contracts it owns; `strategies/` is what it contributes to extension
    // points somebody else opened. The token comes from each class's own
    // decorator, so nothing lists them.
    for (const { target, ProviderClass } of await loadModuleProviders(mod)) {
      container.register(mod.id, target, ProviderClass);
    }
    for (const { target, StrategyClass } of await loadModuleStrategies(mod)) {
      container.contribute(mod.id, target, StrategyClass);
    }
  }

  for (const mod of modules) {
    for (const token of mod.consumes) {
      if (container.has(token)) continue;

      throw new ContractError(
        `Module "${mod.id}" consumes the contract "${token.id}", which no module provides.`,
        token.id,
      );
    }
  }

  return container;
}
