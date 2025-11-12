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
  let config;

  try {
    core.info('Starting OpenTelemetry data collection post-action');

    // Get configuration
    config = await getConfig();

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
    recordMetrics(meter, metrics, config.metricPrefix, config.customAttributes);

    // Record traces
    recordTraces(tracer, metrics, config.customAttributes);

    // Force flush and shutdown to ensure data is exported
    await shutdown(meterProvider);
    await shutdownTracer(tracerProvider);

    core.info('✓ Metrics and traces successfully exported to Google Cloud');
  } catch (error) {
    core.error(`Post-action failed: ${error?.message || JSON.stringify(error)}`);
    core.error(error.stack);

    // Try to shutdown gracefully even on error
    if (meterProvider) {
      try {
        await shutdown(meterProvider);
      } catch (shutdownError) {
        core.error(`Error during metrics shutdown: ${shutdownError?.message || JSON.stringify(shutdownError)}`);
      }
      core.info('✓ Meter provider shut down successfully after error');
    } else {
      core.info('No meter provider to shut down after error');
    }

    if (tracerProvider) {
      try {
        await shutdownTracer(tracerProvider);
      } catch (shutdownError) {
        core.error(`Error during trace shutdown: ${shutdownError?.message || JSON.stringify(shutdownError)}`);
      }
      core.info('✓ Tracer provider shut down successfully after error');
    } else {
      core.info('No tracer provider to shut down after error');
    }

    // Decide whether to fail the workflow based on config
    // Note: config might not be defined if error occurred before getConfig()
    const shouldFail = config?.failOnError || false;
    const errorMsg = error?.message || error?.toString() || 'Unknown error';
    if (shouldFail) {
      core.setFailed(`Observability export failed: ${errorMsg}`);
    } else {
      core.warning(`Observability export failed, but workflow will continue (set fail-on-error: true to fail on export errors): ${errorMsg}`);
    }
  }
}

run();
