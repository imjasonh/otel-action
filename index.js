const core = require('@actions/core');
const { getConfig } = require('./lib/config');

/**
 * Main action entry point
 * Validates configuration early so errors are caught before the job runs
 */
async function run() {
  try {
    core.info('OpenTelemetry metrics collection action initialized');

    // Validate configuration early (checks repo visibility, SA permissions, etc.)
    core.info('Validating configuration...');
    const config = await getConfig();

    core.info(`✓ Configuration validated successfully`);
    core.info(`  Project: ${config.gcpProjectId}`);
    core.info(`  Service: ${config.serviceName}`);
    core.info(`  Namespace: ${config.serviceNamespace}`);
    core.info(`  Metric prefix: ${config.metricPrefix}`);
    core.info('');
    core.info('Metrics will be collected and exported after the job completes');
  } catch (error) {
    core.setFailed(`Configuration validation failed: ${error.message}`);
  }
}

run();
