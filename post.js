const core = require('@actions/core');
const github = require('@actions/github');
const { getConfig } = require('./lib/config');
const { collectMetrics, collectLogs } = require('./lib/collector');
const {
  createMeterProvider,
  recordMetrics,
  shutdown,
  createTracerProvider,
  recordTraces,
  shutdownTracer,
  createLogger,
  recordLogs,
} = require('./lib/exporter');

/**
 * Post-action entry point
 * Collects workflow metrics/traces/logs and exports them to Google Cloud
 */
async function run() {
  let meterProvider;
  let tracerProvider;

  try {
    core.info('Starting OpenTelemetry data collection post-action');

    // Get configuration
    const config = await getConfig();

    // Get GitHub token and create Octokit client
    const token = core.getInput('github-token', { required: true });
    const octokit = github.getOctokit(token);

    // Collect metrics from GitHub API
    const metrics = await collectMetrics(octokit, github.context);

    // Collect detailed job logs
    const logLines = await collectLogs(octokit, github.context, metrics.job.id);

    // Initialize OpenTelemetry providers and Cloud Logging
    const { meterProvider: provider, meter } = createMeterProvider(config);
    meterProvider = provider;

    const { tracerProvider: tProvider, tracer } = createTracerProvider(config);
    tracerProvider = tProvider;

    const { log } = createLogger(config);

    // Record metrics
    recordMetrics(meter, metrics, config.metricPrefix);

    // Record traces
    recordTraces(tracer, metrics);

    // Record logs (with detailed log lines if available)
    await recordLogs(log, metrics, logLines);

    // Force flush and shutdown to ensure data is exported
    await shutdown(meterProvider);
    await shutdownTracer(tracerProvider);

    core.info('✓ Metrics, traces, and logs successfully exported to Google Cloud');
  } catch (error) {
    core.error(`Post-action failed: ${error.message}`);
    core.error(error.stack);

    // Try to shutdown gracefully even on error
    if (meterProvider) {
      try {
        await shutdown(meterProvider);
      } catch (shutdownError) {
        core.error(`Error during metrics shutdown: ${shutdownError.message}`);
      }
    }

    if (tracerProvider) {
      try {
        await shutdownTracer(tracerProvider);
      } catch (shutdownError) {
        core.error(`Error during trace shutdown: ${shutdownError.message}`);
      }
    }

    // Don't fail the workflow if export fails
    core.warning('Telemetry export failed, but workflow will continue');
  }
}

run();
