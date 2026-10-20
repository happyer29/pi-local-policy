import { argumentsFor, help, uninstall } from './management.mjs';

try {
  const options = argumentsFor(process.argv.slice(2), 'uninstall');
  if (options.help) console.log(help('uninstall'));
  else console.log(JSON.stringify(uninstall(options), null, 2));
} catch (error) {
  console.error(`Uninstall stopped: ${error.message}`);
  process.exitCode = 1;
}
