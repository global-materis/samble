import EndpointReader from '../core/endpoint-reader';
import { Endpoint } from '../templates/endpoint';
import { PROVIDES, ProvidesMetadata } from '../decorators/provides.decorator';
import { FILLS, FillsMetadata } from '../decorators/fills.decorator';
import { Provider } from '../templates/provider';
import { Strategy } from '../templates/strategy';
import type { Contract } from './container';
import type { Slot } from './slots';
import { Routine } from '../templates/routine';
import { ResolvedModule } from './module-manifest';
import { readExports, readFiles } from './module-files';
import { Logger } from '../utilities/logger';

export {
  MODULE_EXTENSIONS,
  pickOneFilePerModule,
  resolveModulePattern,
  withModuleExtensions,
} from './module-files';

/** A module with its endpoints already read and ordered. */
export interface LoadedModule {
  module: ResolvedModule;
  readers: EndpointReader[];
}

/**
 * Keeps the classes that are actually endpoints and orders them by `@Priority`.
 *
 * A file may export more than its class — constants, helpers, types — and
 * `Reflect.getMetadata` throws on a primitive, so anything that is not an
 * `Endpoint` subclass is ignored. A class without an HTTP verb is discarded
 * the same way: it is a file being written, not a startup failure.
 *
 * Pure, so the filter and the ordering can be tested without touching disk.
 *
 * @param defaultGroup Prefix for the classes that declare no `@Group` — the
 * module id, so the decorator is only needed to say something else.
 */
export function toEndpointReaders(
  exported: unknown[],
  defaultGroup?: string,
): EndpointReader[] {
  return exported
    .filter(
      (value): value is new () => Endpoint =>
        typeof value === 'function' && value.prototype instanceof Endpoint,
    )
    .map((value) => new EndpointReader(value, defaultGroup))
    .filter((reader) => !reader.isInvalid())
    .sort(byPriority);
}

/** `@Priority` first, in ascending order; everything else keeps its place. */
function byPriority(a: EndpointReader, b: EndpointReader): number {
  if (a.priority === null && b.priority === null) return 0;
  if (a.priority === null) return 1;
  if (b.priority === null) return -1;
  return a.priority - b.priority;
}

/** Reads and orders the endpoints a module contributes. */
export async function loadModuleEndpoints(
  mod: ResolvedModule,
): Promise<EndpointReader[]> {
  if (mod.routes.length === 0) return [];
  const { exported } = await readExports(mod.routes, mod.dir);
  return toEndpointReaders(exported, mod.id);
}

/** Reads the scheduled routines a module contributes. */
export async function loadModuleRoutines(
  mod: ResolvedModule,
): Promise<Array<new () => Routine>> {
  if (mod.routines.length === 0) return [];

  const { exported } = await readExports(mod.routines, mod.dir);
  return exported.filter(
    (value): value is new () => Routine =>
      typeof value === 'function' && value.prototype instanceof Routine,
  );
}

/** A provider class together with the contract it declared. */
export interface LoadedProvider {
  target: Contract<unknown>;
  ProviderClass: new () => Provider;
}

/** A strategy class together with the extension point it declared. */
export interface LoadedStrategy {
  target: Slot<unknown>;
  StrategyClass: new () => Strategy;
}

/**
 * Reads the `Provider` classes a module contributes.
 *
 * A `Provider` without `@Provides` is skipped rather than fatal, the same way
 * an endpoint without a verb is: it reads as a file being written, not as a
 * broken installation.
 */
export async function loadModuleProviders(
  mod: ResolvedModule,
): Promise<LoadedProvider[]> {
  if (mod.providers.length === 0) return [];

  const { exported } = await readExports(mod.providers, mod.dir);

  return exported
    .filter(
      (value): value is new () => Provider =>
        typeof value === 'function' && value.prototype instanceof Provider,
    )
    .map((ProviderClass) => {
      const metadata = Reflect.getMetadata(
        PROVIDES,
        ProviderClass,
      ) as ProvidesMetadata;
      if (!metadata) {
        Logger.warn(
          `Provider ${ProviderClass.name} in module "${mod.id}" has no @Provides(token) and was skipped.`,
        );
        return null;
      }
      return { target: metadata.target, ProviderClass };
    })
    .filter((loaded): loaded is LoadedProvider => loaded !== null);
}

/**
 * Reads the `Strategy` classes a module contributes to other modules'
 * extension points.
 *
 * Same tolerance as a provider: one without `@Fills` is skipped with a warning
 * rather than refusing to start, because a half-written file is the likelier
 * explanation than a broken installation.
 */
export async function loadModuleStrategies(
  mod: ResolvedModule,
): Promise<LoadedStrategy[]> {
  if (mod.strategies.length === 0) return [];

  const { exported } = await readExports(mod.strategies, mod.dir);

  return exported
    .filter(
      (value): value is new () => Strategy =>
        typeof value === 'function' && value.prototype instanceof Strategy,
    )
    .map((StrategyClass) => {
      const metadata = Reflect.getMetadata(
        FILLS,
        StrategyClass,
      ) as FillsMetadata;
      if (!metadata) {
        Logger.warn(
          `Strategy ${StrategyClass.name} in module "${mod.id}" has no @Fills(token) and was skipped.`,
        );
        return null;
      }
      return { target: metadata.target, StrategyClass };
    })
    .filter((loaded): loaded is LoadedStrategy => loaded !== null);
}

/**
 * Says why a module mounted nothing, or stays quiet when there is nothing to
 * say.
 *
 * The two cases are not the same. A glob the author WROTE that finds nothing is
 * a mistake worth a line in the log — almost always a typo or a missing `dir`,
 * and silence turns it into endpoints that simply do not answer. The default
 * glob finding nothing just means the module has no endpoints, which is a
 * perfectly ordinary module that provides a contract.
 *
 * What is worth saying in both cases is the third one: the files ARE there and
 * none of them is an endpoint. That is a class missing `extends Endpoint` or
 * its HTTP decorator, and it is invisible from the outside.
 */
async function explainEmptyRoutes(mod: ResolvedModule): Promise<void> {
  const declared = !mod.implicit.includes('routes');

  const files = (
    await Promise.all(mod.routes.map((pattern) => readFiles(pattern, mod.dir)))
  ).flat();

  if (files.length > 0) {
    Logger.warn(
      `Module "${mod.id}": ${files.length} file(s) matched its routes but none is an Endpoint with an HTTP decorator (@HttpGet, @HttpPost, ...).`,
    );
    return;
  }

  if (declared) {
    Logger.warn(
      `Module "${mod.id}" declares routes but none were found. Check its "routes" globs and "dir".`,
    );
  }
}

/**
 * Loads every module in the order given, which is dependency order by the time
 * it gets here.
 */
export async function loadModules(
  modules: ResolvedModule[],
): Promise<LoadedModule[]> {
  const loaded: LoadedModule[] = [];

  for (const module of modules) {
    const readers = await loadModuleEndpoints(module);

    if (module.routes.length > 0 && readers.length === 0) {
      await explainEmptyRoutes(module);
    }

    loaded.push({ module, readers });
  }

  return loaded;
}
