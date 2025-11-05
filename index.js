const core = require('@actions/core');

/**
 * Main action entry point
 * This action performs its work in the post-action phase
 */
async function run() {
  try {
    core.info('OpenTelemetry metrics collection action initialized');
    core.info('Metrics will be collected and exported after the job completes');
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
