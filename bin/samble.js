#!/usr/bin/env node
/**
 * `npx samble ...`
 *
 * A plain JavaScript stub on purpose: the published entry must not depend on
 * how the build happens to emit a shebang, which is what makes a bin file work
 * at all on a POSIX shell.
 */
const { main } = require('../dist/lib/cli/program');

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
