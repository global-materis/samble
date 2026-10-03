import * as dotenv from 'dotenv';

dotenv.config();

export type MODE = 'production' | 'development';

/**
 * Thrown when the environment does not have what the application said it needs.
 *
 * Separate from the HTTP errors on purpose: this one happens before a request
 * exists, and the only person who can fix it is whoever is installing.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    /** The variables involved, so a caller can report them its own way. */
    public readonly names: string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

const missing = (name: string): boolean => {
  const value = process.env[name];
  return value === undefined || value.trim() === '';
};

/**
 * The environment, read with the failure in the right place.
 *
 * The point of every method here is WHEN it fails. A variable that is missing on
 * a server somebody else installed has to say so by name, at boot, and not
 * arrive at a driver as `undefined` or at a port as `NaN` — which is the same
 * bug three layers away from its cause, and the one nobody can debug over the
 * phone.
 *
 * An empty string counts as missing. `DB_PASSWORD=` in a half-filled `.env` is
 * what a template looks like before anyone edited it, not a decision.
 */
export class ConfigService {
  /**
   * Declares what this application cannot run without, and refuses here.
   *
   * It goes FIRST in `createApp()`, before anything reads a value, and it names
   * **every** variable that is missing rather than the first one: whoever is
   * filling in a `.env` on a server wants one list, not one more failure per
   * round trip.
   *
   * An installed module declares its own in its manifest (`env`) instead, and
   * samble checks those at boot — a module cannot call this, because it has to be
   * possible to ask what a module needs WITHOUT running the application.
   *
   * @example
   * export async function createApp() {
   *   ConfigService.require(['DB_HOST', 'DB_PORT', 'DB_NAME', 'SECRET_KEY']);
   *   return Samble.create({ ... });
   * }
   */
  static require(names: string[]): void {
    const absent = names.filter(missing);
    if (absent.length === 0) return;

    throw new ConfigError(
      `Missing environment ${
        absent.length === 1 ? 'variable' : 'variables'
      }: ${absent.join(', ')}. ${
        absent.length === 1 ? 'It is' : 'They are'
      } declared in ConfigService.require(), so the application does not start without ${
        absent.length === 1 ? 'it' : 'them'
      }.`,
      absent,
    );
  }

  /**
   * A variable that must be there.
   *
   * It THROWS when it is missing, which is the whole difference from reading
   * `process.env` by hand: this used to be typed `string` and hand back
   * `undefined`, so the value travelled on and broke somewhere else.
   *
   * Reaching this throw normally means the variable was not in
   * {@link ConfigService.require}, because that call would have caught it first
   * and named every other one with it.
   */
  static get(name: string): string {
    if (missing(name)) {
      throw new ConfigError(
        `Environment variable ${name} is not set. Add it to the environment, and to ConfigService.require() so a missing one is caught at boot instead of here.`,
        [name],
      );
    }
    return process.env[name] as string;
  }

  /**
   * A variable that may legitimately not be there.
   *
   * For a value with a default in code. Saying so is the point: `optional()`
   * reads as a decision, while a `get()` wrapped in `?? ''` reads as someone
   * working around a type.
   */
  static optional(name: string): string | undefined {
    return missing(name) ? undefined : process.env[name];
  }

  /**
   * A variable that has to be a number.
   *
   * `+ConfigService.get('DB_PORT')` is `NaN` when the value is `"5432 "`, a
   * comment left on the line, or the word `postgres` — and `NaN` reaches the
   * driver as a port, which fails as a connection problem. This fails as what it
   * is, naming the variable and what it actually said.
   */
  static number(name: string): number {
    const raw = ConfigService.get(name);
    const value = Number(raw.trim());
    if (!Number.isFinite(value)) {
      throw new ConfigError(
        `Environment variable ${name} must be a number, and it is ${JSON.stringify(
          raw,
        )}.`,
        [name],
      );
    }
    return value;
  }

  /**
   * A variable that has to be a flag.
   *
   * Accepts `true/false`, `1/0`, `yes/no` and `on/off`, in any case. Anything
   * else throws rather than being read as false: `ENABLE_X=maybe` silently
   * meaning "no" is how a feature stays off while its `.env` says it is on.
   */
  static boolean(name: string): boolean {
    const raw = ConfigService.get(name).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'off'].includes(raw)) return false;

    throw new ConfigError(
      `Environment variable ${name} must be a boolean (true/false, 1/0, yes/no, on/off), and it is ${JSON.stringify(
        raw,
      )}.`,
      [name],
    );
  }

  /** Which of `names` are absent or empty. What a check reports, without throwing. */
  static whichMissing(names: string[]): string[] {
    return names.filter(missing);
  }

  static all(): Record<string, string> {
    return { ...process.env } as Record<string, string>;
  }

  static mode(): MODE {
    return process.env.NODE_ENV as MODE;
  }
}
