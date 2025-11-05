# OpenTelemetry Metrics Exporter for GitHub Actions

A GitHub Action that collects workflow step metrics (duration, status) and exports them to Google Cloud Monitoring via OpenTelemetry.

## Features

- 📊 Collects job and step-level metrics from GitHub Actions workflows
- ⏱️ Records duration histograms for performance tracking
- ✅ Tracks success/failure rates with counters
- 🏷️ Rich metric labels (workflow, job, repository, run info)
- 🔒 Minimal permissions (Monitoring Metric Writer only)
- 🔄 Always runs (even when steps fail)

## Setup

### 1. Create a Google Cloud Service Account

Create a service account with only the permission to write metrics:

```bash
# Set your GCP project ID
PROJECT_ID="your-project-id"

# Create the service account
gcloud iam service-accounts create github-actions-metrics \
  --display-name="GitHub Actions OpenTelemetry Metrics" \
  --description="Service account for GitHub Actions to write OpenTelemetry metrics to Cloud Monitoring" \
  --project="${PROJECT_ID}"

# Grant the Monitoring Metric Writer role
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:github-actions-metrics@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/monitoring.metricWriter" \
  --condition=None

# Create and download a JSON key
gcloud iam service-accounts keys create github-actions-metrics-key.json \
  --iam-account="github-actions-metrics@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 2. Add Service Account Key to GitHub Secrets

1. Copy the contents of the JSON key file:
   ```bash
   cat github-actions-metrics-key.json
   ```

2. In your GitHub repository, go to **Settings → Secrets and variables → Actions**

3. Click **New repository secret**

4. Name: `GCP_SERVICE_ACCOUNT_KEY`

5. Value: Paste the entire JSON content

6. Click **Add secret**

7. Also add your GCP project ID as a secret:
   - Name: `GCP_PROJECT_ID`
   - Value: Your project ID (e.g., `jason-chainguard`)

8. **Securely delete the key file:**
   ```bash
   rm github-actions-metrics-key.json
   ```

## Usage

### Basic Usage

Add the action as one of the first steps in your workflow. The action will automatically collect metrics in a post-action phase after all other steps complete.

```yaml
name: CI Pipeline

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      # Enable metrics collection
      - name: Setup OpenTelemetry Metrics
        uses: your-org/otel-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          gcp-project-id: ${{ secrets.GCP_PROJECT_ID }}
          gcp-service-account-key: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY }}

      # Your regular workflow steps
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
      - name: Build
        run: npm run build

      # Metrics are automatically collected and exported after this job completes
```

### Advanced Configuration

```yaml
- name: Setup OpenTelemetry Metrics
  uses: your-org/otel-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    gcp-project-id: ${{ secrets.GCP_PROJECT_ID }}
    gcp-service-account-key: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY }}

    # Optional: Customize service name for resource attributes
    service-name: 'my-app-ci'

    # Optional: Customize service namespace
    service-namespace: 'production'

    # Optional: Customize metric name prefix
    metric-prefix: 'ci.metrics'

    # Optional: Adjust export interval (milliseconds)
    export-interval-millis: '5000'
```

## Metrics Collected

### Job Duration
- **Metric:** `github.actions.job.duration`
- **Type:** Histogram
- **Unit:** milliseconds
- **Labels:**
  - `workflow.name` - Name of the workflow
  - `job.name` - Name of the job
  - `job.status` - Status (completed, in_progress, etc.)
  - `job.conclusion` - Conclusion (success, failure, cancelled, etc.)
  - `repository.owner` - Repository owner
  - `repository.name` - Repository name
  - `repository.full_name` - Full repository name (owner/repo)
  - `run.id` - Workflow run ID
  - `run.number` - Workflow run number
  - `run.attempt` - Run attempt number

### Step Duration
- **Metric:** `github.actions.step.duration`
- **Type:** Histogram
- **Unit:** milliseconds
- **Labels:** All job labels plus:
  - `step.name` - Name of the step
  - `step.number` - Step number
  - `step.status` - Status (completed, in_progress, etc.)
  - `step.conclusion` - Conclusion (success, failure, skipped, etc.)

### Step Count
- **Metric:** `github.actions.step.total`
- **Type:** Counter
- **Labels:** Same as step duration

## Viewing Metrics

Metrics will appear in Google Cloud Monitoring under custom metrics:

1. Go to **Cloud Console → Monitoring → Metrics Explorer**
2. Search for: `custom.googleapis.com/github.actions`
3. Available metrics:
   - `custom.googleapis.com/github.actions/job.duration`
   - `custom.googleapis.com/github.actions/step.duration`
   - `custom.googleapis.com/github.actions/step.total`

### Example Queries

**Average step duration by step name:**
```
custom.googleapis.com/github.actions/step.duration
| filter resource.project_id = "your-project-id"
| group_by [metric.step.name]
| mean
```

**Job failure rate:**
```
custom.googleapis.com/github.actions/step.total
| filter metric.step.conclusion = "failure"
| rate(1m)
```

## Alternative: Using Workload Identity Federation

Instead of service account keys, you can use Workload Identity Federation (recommended for production):

```yaml
jobs:
  build:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      id-token: write

    steps:
      - name: Setup OpenTelemetry Metrics
        uses: your-org/otel-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          gcp-project-id: ${{ secrets.GCP_PROJECT_ID }}
          # No service account key needed!

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      # Your workflow steps...
```

## Development

### Install Dependencies

```bash
npm install
```

### Run Tests

```bash
npm test
```

### Build

The action uses [@vercel/ncc](https://github.com/vercel/ncc) to compile the JavaScript and dependencies into a single file for distribution.

```bash
npm run build
```

This creates:
- `dist/index.js` - Main entry point
- `dist/post/index.js` - Post-action with all dependencies

**Important:** Always run `npm run build` before committing changes. The `dist/` directory must be committed for the action to work in GitHub Actions.

### Project Structure

```
otel-action/
├── action.yml           # Action definition
├── index.js             # Main entry point (source)
├── post.js              # Post-action (source)
├── dist/                # Compiled action (committed)
│   ├── index.js         # Built main entry
│   └── post/
│       └── index.js     # Built post-action
├── lib/
│   ├── config.js        # Configuration parsing
│   ├── collector.js     # GitHub API metrics collection
│   └── exporter.js      # OpenTelemetry export
└── test/
    ├── collector.test.js
    └── exporter.test.js
```

## License

Apache-2.0

## Contributing

Issues and pull requests welcome!
