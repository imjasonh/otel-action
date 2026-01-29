const { test, mock } = require('node:test');
const assert = require('node:assert');

test('config module exports', async (t) => {
  await t.test('should export getConfig function', () => {
    const config = require('../lib/config');
    assert.strictEqual(typeof config.getConfig, 'function');
  });
});

test('config attributes parsing', async (t) => {
  let originalGetInput;
  let originalGetBooleanInput;
  let originalInfo;
  let originalWarning;
  let loggedWarnings;
  let loggedInfo;

  t.beforeEach(() => {
    // Mock @actions/core
    const core = require('@actions/core');
    originalGetInput = core.getInput;
    originalGetBooleanInput = core.getBooleanInput;
    originalInfo = core.info;
    originalWarning = core.warning;
    loggedWarnings = [];
    loggedInfo = [];

    core.info = (msg) => loggedInfo.push(msg);
    core.warning = (msg) => loggedWarnings.push(msg);
  });

  t.afterEach(() => {
    const core = require('@actions/core');
    core.getInput = originalGetInput;
    core.getBooleanInput = originalGetBooleanInput;
    core.info = originalInfo;
    core.warning = originalWarning;
    // Clear module cache to reset state
    delete require.cache[require.resolve('../lib/config')];
  });

  await t.test('should parse valid YAML attributes', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn((name) => {
      if (name === 'attributes') {
        return 'team: platform\nenvironment: production\ncustom.label: test';
      }
      return '';
    });
    core.getBooleanInput = mock.fn(() => false);

    // Mock GoogleAuth
    const { GoogleAuth } = require('google-auth-library');
    const originalGetProjectId = GoogleAuth.prototype.getProjectId;
    GoogleAuth.prototype.getProjectId = mock.fn(async () => 'test-project');

    const config = require('../lib/config');
    const result = await config.getConfig();

    GoogleAuth.prototype.getProjectId = originalGetProjectId;

    assert.deepStrictEqual(result.customAttributes, {
      team: 'platform',
      environment: 'production',
      'custom.label': 'test'
    });
    assert.ok(loggedInfo.some(msg => msg.includes('Parsed 3 custom attribute(s)')));
  });

  await t.test('should warn on invalid YAML and continue with empty attributes', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn((name) => {
      if (name === 'attributes') {
        return 'this is not: valid: yaml: [';
      }
      return '';
    });
    core.getBooleanInput = mock.fn(() => false);

    // Mock GoogleAuth
    const { GoogleAuth } = require('google-auth-library');
    const originalGetProjectId = GoogleAuth.prototype.getProjectId;
    GoogleAuth.prototype.getProjectId = mock.fn(async () => 'test-project');

    const config = require('../lib/config');
    const result = await config.getConfig();

    GoogleAuth.prototype.getProjectId = originalGetProjectId;

    // Should not throw, but set customAttributes to empty object
    assert.deepStrictEqual(result.customAttributes, {});
    // Should have logged a warning
    assert.ok(loggedWarnings.some(msg => msg.includes('Failed to parse custom attributes')));
  });

  await t.test('should warn if attributes is not an object', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn((name) => {
      if (name === 'attributes') {
        return '- item1\n- item2'; // This is an array in YAML
      }
      return '';
    });
    core.getBooleanInput = mock.fn(() => false);

    // Mock GoogleAuth
    const { GoogleAuth } = require('google-auth-library');
    const originalGetProjectId = GoogleAuth.prototype.getProjectId;
    GoogleAuth.prototype.getProjectId = mock.fn(async () => 'test-project');

    const config = require('../lib/config');
    const result = await config.getConfig();

    GoogleAuth.prototype.getProjectId = originalGetProjectId;

    // Should not throw, but set customAttributes to empty object
    assert.deepStrictEqual(result.customAttributes, {});
    // Should have logged a warning about attributes needing to be an object
    assert.ok(loggedWarnings.some(msg => msg.includes('Failed to parse custom attributes') && msg.includes('must be a YAML object')));
  });

  await t.test('should handle empty attributes input', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn(() => '');
    core.getBooleanInput = mock.fn(() => false);

    // Mock GoogleAuth
    const { GoogleAuth } = require('google-auth-library');
    const originalGetProjectId = GoogleAuth.prototype.getProjectId;
    GoogleAuth.prototype.getProjectId = mock.fn(async () => 'test-project');

    const config = require('../lib/config');
    const result = await config.getConfig();

    GoogleAuth.prototype.getProjectId = originalGetProjectId;

    // Should have empty customAttributes
    assert.deepStrictEqual(result.customAttributes, {});
    // Should not log any warnings about attributes
    assert.ok(!loggedWarnings.some(msg => msg.includes('attributes')));
  });

  await t.test('should handle whitespace-only attributes input', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn((name) => {
      if (name === 'attributes') {
        return '    '; // Whitespace-only string causes yaml.parse to return null
      }
      return '';
    });
    core.getBooleanInput = mock.fn(() => false);

    // Mock GoogleAuth
    const { GoogleAuth } = require('google-auth-library');
    const originalGetProjectId = GoogleAuth.prototype.getProjectId;
    GoogleAuth.prototype.getProjectId = mock.fn(async () => 'test-project');

    const config = require('../lib/config');
    const result = await config.getConfig();

    GoogleAuth.prototype.getProjectId = originalGetProjectId;

    // Should not throw, but set customAttributes to empty object
    assert.deepStrictEqual(result.customAttributes, {});
    // Should have logged a warning about attributes needing to be an object
    assert.ok(loggedWarnings.some(msg => msg.includes('Failed to parse custom attributes') && msg.includes('must be a YAML object')));
  });
});

test('config OTLP endpoint', async (t) => {
  let originalGetInput;
  let originalGetBooleanInput;
  let originalInfo;
  let originalWarning;
  let loggedWarnings;
  let loggedInfo;

  t.beforeEach(() => {
    const core = require('@actions/core');
    originalGetInput = core.getInput;
    originalGetBooleanInput = core.getBooleanInput;
    originalInfo = core.info;
    originalWarning = core.warning;
    loggedWarnings = [];
    loggedInfo = [];

    core.info = (msg) => loggedInfo.push(msg);
    core.warning = (msg) => loggedWarnings.push(msg);
  });

  t.afterEach(() => {
    const core = require('@actions/core');
    core.getInput = originalGetInput;
    core.getBooleanInput = originalGetBooleanInput;
    core.info = originalInfo;
    core.warning = originalWarning;
    delete require.cache[require.resolve('../lib/config')];
  });

  await t.test('should include otlpEndpoint in config when provided', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn((name) => {
      if (name === 'otlp-endpoint') return 'localhost:4317';
      return '';
    });
    core.getBooleanInput = mock.fn(() => false);

    const config = require('../lib/config');
    const result = await config.getConfig();

    assert.strictEqual(result.otlpEndpoint, 'localhost:4317');
  });

  await t.test('should not require GCP project when otlpEndpoint is set', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn((name) => {
      if (name === 'otlp-endpoint') return 'localhost:4317';
      return '';
    });
    core.getBooleanInput = mock.fn(() => false);

    const config = require('../lib/config');

    // Should not throw even without GCP project - OTLP mode skips all GCP detection
    const result = await config.getConfig();

    assert.strictEqual(result.otlpEndpoint, 'localhost:4317');
    // gcpProjectId should be null since OTLP mode skips GCP detection entirely
    assert.strictEqual(result.gcpProjectId, null);
  });

  await t.test('should set otlpEndpoint to null when not provided', async () => {
    const core = require('@actions/core');
    core.getInput = mock.fn(() => '');
    core.getBooleanInput = mock.fn(() => false);

    const { GoogleAuth } = require('google-auth-library');
    const originalGetProjectId = GoogleAuth.prototype.getProjectId;
    GoogleAuth.prototype.getProjectId = mock.fn(async () => 'test-project');

    const config = require('../lib/config');
    const result = await config.getConfig();

    GoogleAuth.prototype.getProjectId = originalGetProjectId;

    assert.strictEqual(result.otlpEndpoint, null);
  });
});
