const core = require('@actions/core');

/**
 * Parses and validates action configuration from inputs
 * @returns {Object} Configuration object
 */
function getConfig() {
  const serviceAccountKey = core.getInput('gcp-service-account-key');

  const config = {
    gcpProjectId: core.getInput('gcp-project-id', { required: true }),
    gcpServiceAccountKey: serviceAccountKey || null,
    serviceName: core.getInput('service-name') || 'github-actions',
    serviceNamespace: core.getInput('service-namespace') || 'ci',
    metricPrefix: core.getInput('metric-prefix') || 'github.actions',
    exportIntervalMillis: parseInt(core.getInput('export-interval-millis') || '5000', 10),
  };

  // Validate configuration
  if (!config.gcpProjectId) {
    throw new Error('gcp-project-id is required');
  }

  if (config.exportIntervalMillis < 1000) {
    core.warning('export-interval-millis is too low, setting to 1000ms');
    config.exportIntervalMillis = 1000;
  }

  // Log config without sensitive data
  const safeConfig = { ...config, gcpServiceAccountKey: config.gcpServiceAccountKey ? '[REDACTED]' : null };
  core.debug(`Configuration: ${JSON.stringify(safeConfig, null, 2)}`);

  return config;
}

module.exports = { getConfig };
