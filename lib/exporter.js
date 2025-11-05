const core = require('@actions/core');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { MetricExporter } = require('@google-cloud/opentelemetry-cloud-monitoring-exporter');
const { TraceExporter } = require('@google-cloud/opentelemetry-cloud-trace-exporter');
const { BasicTracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { context, trace } = require('@opentelemetry/api');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE, ATTR_SERVICE_INSTANCE_ID } = require('@opentelemetry/semantic-conventions');
const { Logging } = require('@google-cloud/logging');

/**
 * Creates and configures an OpenTelemetry MeterProvider with GCP exporter
 * @param {Object} config - Configuration object
 * @returns {Object} MeterProvider and meters
 */
function createMeterProvider(config) {
  core.info('Initializing OpenTelemetry MeterProvider with Google Cloud Monitoring exporter');

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_NAMESPACE]: config.serviceNamespace,
    [ATTR_SERVICE_INSTANCE_ID]: process.env.GITHUB_RUN_ID || 'unknown',
  });

  // Configure exporter options
  const exporterOptions = {
    projectId: config.gcpProjectId,
  };

  // If service account key is provided, parse and use it
  if (config.gcpServiceAccountKey) {
    try {
      const credentials = JSON.parse(config.gcpServiceAccountKey);
      exporterOptions.credentials = credentials;
      core.info('Using provided service account credentials');
    } catch (error) {
      core.error(`Failed to parse service account key: ${error.message}`);
      throw new Error('Invalid service account key JSON');
    }
  } else {
    core.info('Using Application Default Credentials');
  }

  const exporter = new MetricExporter(exporterOptions);

  // Note: We use PeriodicExportingMetricReader not for periodic exports,
  // but because it handles metric aggregation and collection.
  // We trigger export manually via forceFlush() in the shutdown function.
  const metricReader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60000, // Set high since we export manually via forceFlush()
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  const meter = meterProvider.getMeter(config.metricPrefix);

  return { meterProvider, meter };
}

/**
 * Records metrics for collected workflow data
 * @param {Object} meter - OpenTelemetry meter
 * @param {Object} metrics - Collected metrics from GitHub
 * @param {string} metricPrefix - Metric name prefix
 */
function recordMetrics(meter, metrics, metricPrefix) {
  core.info('Recording metrics to OpenTelemetry');

  const baseAttributes = {
    'workflow.name': metrics.workflow,
    'job.name': metrics.job.name,
    'repository.owner': metrics.repository.owner,
    'repository.name': metrics.repository.repo,
    'repository.full_name': metrics.repository.fullName,
    'run.id': metrics.run.id.toString(),
    'run.number': metrics.run.number.toString(),
    'run.attempt': metrics.run.attempt,
  };

  // Create meters for step metrics
  const stepDurationName = `${metricPrefix}.step.duration`;
  const stepDurationHistogram = meter.createHistogram(stepDurationName, {
    description: 'Duration of workflow steps in milliseconds',
    unit: 'ms',
  });
  core.debug(`Created histogram metric: ${stepDurationName}`);

  const stepCounterName = `${metricPrefix}.step.total`;
  const stepCounter = meter.createCounter(stepCounterName, {
    description: 'Total count of workflow steps by conclusion',
  });
  core.debug(`Created counter metric: ${stepCounterName}`);

  // Record job-level metrics
  if (metrics.job.durationMs > 0) {
    const jobDurationHistogram = meter.createHistogram(`${metricPrefix}.job.duration`, {
      description: 'Duration of workflow jobs in milliseconds',
      unit: 'ms',
    });

    jobDurationHistogram.record(metrics.job.durationMs, {
      ...baseAttributes,
      'job.status': metrics.job.status,
      'job.conclusion': metrics.job.conclusion || 'unknown',
    });

    core.info(`Recorded job duration: ${metrics.job.durationMs}ms`);
  }

  // Record step-level metrics
  for (const step of metrics.steps) {
    const stepAttributes = {
      ...baseAttributes,
      'step.name': step.name,
      'step.number': step.number.toString(),
      'step.status': step.status,
      'step.conclusion': step.conclusion || 'unknown',
    };

    // Record step duration
    if (step.durationMs > 0) {
      stepDurationHistogram.record(step.durationMs, stepAttributes);
      core.info(`Recorded step "${step.name}" duration: ${step.durationMs}ms`);
    }

    // Record step count (for success/failure tracking)
    stepCounter.add(1, stepAttributes);
  }

  core.info(`Recorded metrics for ${metrics.steps.length} steps`);
}

/**
 * Forces metrics export and shuts down the meter provider
 * @param {Object} meterProvider - MeterProvider instance
 * @returns {Promise<void>}
 */
async function shutdown(meterProvider) {
  core.info('Exporting metrics and shutting down MeterProvider');
  try {
    // forceFlush() triggers an immediate export and waits for completion
    core.info('Triggering metric export...');
    await meterProvider.forceFlush();
    core.info('Metrics exported successfully');

    // Shutdown the provider
    core.info('Shutting down MeterProvider...');
    await meterProvider.shutdown();
    core.info('MeterProvider shut down successfully');
  } catch (error) {
    core.error(`Error during export/shutdown: ${error.message}`);
    core.error(`Stack trace: ${error.stack}`);
    throw error;
  }
}

/**
 * Creates and configures an OpenTelemetry TracerProvider with GCP exporter
 * @param {Object} config - Configuration object
 * @returns {Object} TracerProvider and tracer
 */
function createTracerProvider(config) {
  core.info('Initializing OpenTelemetry TracerProvider with Google Cloud Trace exporter');

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_NAMESPACE]: config.serviceNamespace,
    [ATTR_SERVICE_INSTANCE_ID]: process.env.GITHUB_RUN_ID || 'unknown',
  });

  const exporterOptions = {
    projectId: config.gcpProjectId,
  };

  if (config.gcpServiceAccountKey) {
    try {
      const credentials = JSON.parse(config.gcpServiceAccountKey);
      exporterOptions.credentials = credentials;
    } catch (error) {
      core.error(`Failed to parse service account key for traces: ${error.message}`);
      throw new Error('Invalid service account key JSON');
    }
  }

  const exporter = new TraceExporter(exporterOptions);
  const spanProcessor = new BatchSpanProcessor(exporter);

  const tracerProvider = new BasicTracerProvider({
    resource,
  });

  tracerProvider.addSpanProcessor(spanProcessor);

  const tracer = tracerProvider.getTracer(config.metricPrefix);

  return { tracerProvider, tracer };
}

/**
 * Records traces for collected workflow data
 * @param {Object} tracer - OpenTelemetry tracer
 * @param {Object} metrics - Collected metrics from GitHub
 * @returns {Object} Root span for the job
 */
function recordTraces(tracer, metrics) {
  core.info('Recording traces to OpenTelemetry');

  const baseAttributes = {
    'workflow.name': metrics.workflow,
    'repository.owner': metrics.repository.owner,
    'repository.name': metrics.repository.repo,
    'repository.full_name': metrics.repository.fullName,
    'run.id': metrics.run.id.toString(),
    'run.number': metrics.run.number.toString(),
    'run.attempt': metrics.run.attempt,
  };

  // Create a span for the entire job
  const jobSpan = tracer.startSpan(`Job: ${metrics.job.name}`, {
    startTime: metrics.job.startedAt,
    attributes: {
      ...baseAttributes,
      'job.name': metrics.job.name,
      'job.id': metrics.job.id.toString(),
      'job.status': metrics.job.status,
      'job.conclusion': metrics.job.conclusion || 'unknown',
    },
  });

  // Set job span as active in context for creating child spans
  const jobContext = trace.setSpan(context.active(), jobSpan);

  // Create child spans for each step within job context
  for (const step of metrics.steps) {
    if (step.startedAt && step.completedAt) {
      // Start span within the job context (makes it a child of jobSpan)
      const stepSpan = tracer.startSpan(
        `Step: ${step.name}`,
        {
          startTime: step.startedAt,
          attributes: {
            ...baseAttributes,
            'job.name': metrics.job.name,
            'step.name': step.name,
            'step.number': step.number.toString(),
            'step.status': step.status,
            'step.conclusion': step.conclusion || 'unknown',
          },
        },
        jobContext // Use job context to make this a child span
      );

      // Mark span as error if step failed
      if (step.conclusion === 'failure') {
        stepSpan.setStatus({ code: 2, message: 'Step failed' }); // SpanStatusCode.ERROR = 2
        stepSpan.recordException(new Error(`Step "${step.name}" failed`));
      }

      stepSpan.end(step.completedAt);
      core.debug(`Created span for step: ${step.name}`);
    }
  }

  // End the job span
  if (metrics.job.completedAt) {
    if (metrics.job.conclusion === 'failure') {
      jobSpan.setStatus({ code: 2, message: 'Job failed' });
    }
    jobSpan.end(metrics.job.completedAt);
  }

  core.info(`Recorded traces for job and ${metrics.steps.length} steps`);
  return jobSpan;
}

/**
 * Shuts down tracer provider
 * @param {Object} tracerProvider - TracerProvider instance
 * @returns {Promise<void>}
 */
async function shutdownTracer(tracerProvider) {
  core.info('Exporting traces and shutting down TracerProvider');
  try {
    core.info('Triggering trace export...');
    await tracerProvider.forceFlush();
    core.info('Traces exported successfully');

    core.info('Shutting down TracerProvider...');
    await tracerProvider.shutdown();
    core.info('TracerProvider shut down successfully');
  } catch (error) {
    core.error(`Error during trace export/shutdown: ${error.message}`);
    core.error(`Stack trace: ${error.stack}`);
    throw error;
  }
}

/**
 * Creates Google Cloud Logging client
 * @param {Object} config - Configuration object
 * @returns {Object} Logging client and log instance
 */
function createLogger(config) {
  core.info('Initializing Google Cloud Logging client');

  const loggingOptions = {
    projectId: config.gcpProjectId,
  };

  if (config.gcpServiceAccountKey) {
    try {
      const credentials = JSON.parse(config.gcpServiceAccountKey);
      loggingOptions.credentials = credentials;
    } catch (error) {
      core.error(`Failed to parse service account key for logging: ${error.message}`);
      throw new Error('Invalid service account key JSON');
    }
  }

  const logging = new Logging(loggingOptions);
  const log = logging.log('github-actions');

  return { logging, log };
}

/**
 * Writes logs for collected workflow data
 * @param {Object} log - Cloud Logging instance
 * @param {Object} metrics - Collected metrics from GitHub
 * @param {Array} logLines - Parsed log lines from job execution (optional)
 * @returns {Promise<void>}
 */
async function recordLogs(log, metrics, logLines = []) {
  core.info('Writing logs to Google Cloud Logging');

  const baseMetadata = {
    resource: {
      type: 'generic_task',
      labels: {
        project_id: metrics.repository.owner,
        location: 'global',
        namespace: metrics.repository.repo,
        job: metrics.job.name,
        task_id: metrics.run.id.toString(),
      },
    },
    labels: {
      workflow: metrics.workflow,
      repository: metrics.repository.fullName,
      run_number: metrics.run.number.toString(),
      run_attempt: metrics.run.attempt,
      job_name: metrics.job.name,
    },
  };

  const entries = [];

  // If we have detailed log lines, write them with accurate timestamps
  if (logLines && logLines.length > 0) {
    core.info(`Writing ${logLines.length} detailed log lines`);

    for (const logLine of logLines) {
      // Determine severity from log content
      let severity = 'INFO';
      if (logLine.message.includes('::error::') || logLine.message.includes('ERROR')) {
        severity = 'ERROR';
      } else if (logLine.message.includes('::warning::') || logLine.message.includes('WARNING')) {
        severity = 'WARNING';
      } else if (logLine.message.includes('::debug::')) {
        severity = 'DEBUG';
      }

      entries.push(log.entry(
        {
          ...baseMetadata,
          severity,
          timestamp: logLine.timestamp,
          labels: {
            ...baseMetadata.labels,
            step: logLine.step || 'unknown',
          },
        },
        {
          message: logLine.message,
          step: logLine.step,
        }
      ));
    }
  } else {
    // Fallback: Write summary entries if detailed logs not available
    core.info('Writing summary log entries (detailed logs not available)');

    // Log job-level entry
    entries.push(log.entry(
      {
        ...baseMetadata,
        severity: metrics.job.conclusion === 'success' ? 'INFO' : 'ERROR',
        timestamp: metrics.job.completedAt || new Date(),
      },
      {
        message: `Job ${metrics.job.name} ${metrics.job.conclusion}`,
        job: {
          name: metrics.job.name,
          id: metrics.job.id,
          status: metrics.job.status,
          conclusion: metrics.job.conclusion,
          duration_ms: metrics.job.durationMs,
        },
      }
    ));

    // Log step-level entries
    for (const step of metrics.steps) {
      entries.push(log.entry(
        {
          ...baseMetadata,
          severity: step.conclusion === 'success' ? 'INFO' : step.conclusion === 'failure' ? 'ERROR' : 'WARNING',
          timestamp: step.completedAt || new Date(),
          labels: {
            ...baseMetadata.labels,
            step_name: step.name,
            step_number: step.number.toString(),
          },
        },
        {
          message: `Step "${step.name}" ${step.conclusion}`,
          step: {
            name: step.name,
            number: step.number,
            conclusion: step.conclusion,
            duration_ms: step.durationMs,
          },
        }
      ));
    }
  }

  // Write all log entries in batches (Cloud Logging has limits)
  const batchSize = 100;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    try {
      await log.write(batch);
      core.debug(`Wrote batch of ${batch.length} log entries`);
    } catch (error) {
      core.error(`Failed to write log batch: ${error.message}`);
      throw error;
    }
  }

  core.info(`✓ Wrote ${entries.length} log entries to Cloud Logging`);
}

module.exports = {
  createMeterProvider,
  recordMetrics,
  shutdown,
  createTracerProvider,
  recordTraces,
  shutdownTracer,
  createLogger,
  recordLogs,
};
