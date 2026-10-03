import { defineModule } from '../../../lib';

/**
 * Identity: who the people are.
 *
 * Note what a manifest is: where the pieces are wired, and nothing else. No
 * paths, because the folders are the standard layout, and no implementation,
 * because that lives in `providers/`.
 */
export default defineModule({
  id: 'identity',
  label: 'Identity',
  // Core: it cannot be turned off. Nothing else would have anyone to serve.
  // Where this module lives. Everything samble finds by itself is found from
  // here; without it there is nothing to resolve against.
  dir: __dirname,

  // The vocabulary this module can gate. No labels: the keys say it, and a
  // label that restates a key is one more string to keep true. `catalog` shows
  // the case where one is worth writing.
  permissions: ['identity.users.view', 'identity.users.manage'],
});
