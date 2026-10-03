import { Glob } from 'glob';
import path from 'path';
import slash from 'slash';

type ModuleFile<T = any> = T;

export default class PatternResolve<T = any> {
  private readonly ignore = ['**/node_modules/**'];
  private sizes: number = 0;
  private modules: ModuleFile<T[]>[] = [];
  private paths: string[] = [];

  constructor(private pattern: string) {}

  public async readModule() {
    const glob = new Glob(slash(this.pattern), { ignore: this.ignore });
    for await (const file of glob) {
      const mod = await require(path.resolve(file));
      const exported: T[] = Object.values(mod);
      if (exported.length > 0) {
        this.modules.push(exported);
        this.sizes++;
      }
    }
  }

  public async readPath() {
    const glob = new Glob(slash(this.pattern), { ignore: this.ignore });
    for await (const file of glob) {
      this.paths.push(file);
      this.sizes++;
    }
  }

  public hasExport = () => {
    return this.sizes > 0;
  };

  public getSizes = () => this.sizes;

  public getModules = () => this.modules as ModuleFile<T[]>[];

  public getPaths = () => this.paths;
}
