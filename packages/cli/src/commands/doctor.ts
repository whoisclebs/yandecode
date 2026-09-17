import { registerCommand } from '../cli.js';
import { defaultProbeVersion, doctorExitCode, formatDoctor, runDoctor } from '../doctor/checks.js';
import { VERSION } from '../version.js';

registerCommand((program) => {
  program
    .command('doctor')
    .description('Check the YandeCode installation and this project')
    .action(() => {
      const results = runDoctor({
        cwd: process.cwd(),
        probeVersion: defaultProbeVersion,
        nodeVersion: process.version,
        yandecodeVersion: VERSION,
      });
      process.stdout.write(formatDoctor(results));
      process.exitCode = doctorExitCode(results);
    });
});
