/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Refuses to publish a prerelease as `latest`.
 *
 * `publishConfig.tag` is declared in package.json and npm 11 IGNORES it: a
 * plain `npm publish` reports "with tag latest" even so (verified with
 * `--dry-run`). Publishing a 1.0.0-alpha.x as `latest` would make
 * `npm i @samble/core` hand an API that still moves to whoever asks for the stable
 * line.
 *
 * So the check runs in `prepublishOnly`, where refusing still costs nothing.
 */
const { version } = require('../package.json');

const prerelease = version.includes('-');
const tag = process.env.npm_config_tag;
const channel = version.split('-')[1]?.split('.')[0];

if (prerelease && tag !== channel) {
  console.error(
    [
      '',
      `Refusing to publish ${version} with tag "${tag || 'latest'}".`,
      '',
      `  npm publish --tag ${channel}`,
      '',
      `A prerelease published as "latest" is what \`npm i @samble/core\` installs from`,
      '  then on, while its API still moves.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

if (!prerelease && tag && tag !== 'latest') {
  console.error(
    `\nRefusing to publish the stable ${version} under "${tag}".\n`,
  );
  process.exit(1);
}
