import { argumentsFor, help, install } from './management.mjs';

try {
  const options = argumentsFor(process.argv.slice(2), 'install');
  if (options.help) console.log(help('install'));
  else console.log(JSON.stringify(install(options), null, 2));
} catch (error) {
  console.error(`Install stopped: ${error.message}`);
  process.exitCode = 1;
}
