const core = require('@actions/core');
const github = require('@actions/github');
const { getConfig } = require('./lib/config');
const { collectMetrics, collectArtifacts } = require('./lib/collector');
const {
  createMeterProvider,
  recordMetrics,
  shutdown,
  createTracerProvider,
  recordTraces,
  shutdownTracer,
} = require('./lib/exporter');

/**
 * Post-action entry point
 * Collects workflow metrics and traces and exports them to Google Cloud
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

    // Check for artifacts (likely won't find any while job is running)
    const artifacts = await collectArtifacts(octokit, github.context);

    // Add artifact info to metrics if found
    if (artifacts.length > 0) {
      metrics.artifacts = {
        count: artifacts.length,
        totalBytes: artifacts.reduce((sum, a) => sum + a.sizeBytes, 0),
        artifacts: artifacts, // Include full artifact details
      };
    }

    // Initialize OpenTelemetry providers
    const { meterProvider: provider, meter } = createMeterProvider(config);
    meterProvider = provider;

    const { tracerProvider: tProvider, tracer } = createTracerProvider(config);
    tracerProvider = tProvider;

    // Record metrics
    core.info('');
    core.info('📊 Recording metrics...');
    recordMetrics(meter, metrics, config.metricPrefix);

    // Record traces
    core.info('');
    core.info('🔍 Recording traces...');
    recordTraces(tracer, metrics);

    // Force flush and shutdown to ensure data is exported
    core.info('');
    core.info('⬆️  Exporting data to Google Cloud...');
    await shutdown(meterProvider);
    await shutdownTracer(tracerProvider);

    core.info('');
    core.info('✅ Metrics and traces successfully exported to Google Cloud');
    core.info(`   Project: ${config.gcpProjectId}`);
    core.info(`   View metrics: https://console.cloud.google.com/monitoring/metrics-explorer?project=${config.gcpProjectId}`);
    core.info(`   View traces: https://console.cloud.google.com/traces/list?project=${config.gcpProjectId}`);
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
    core.warning('Observability export failed, but workflow will continue');
  }
}

run();
