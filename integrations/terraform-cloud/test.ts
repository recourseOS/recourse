/**
 * Local test for Terraform Cloud Run Task handler
 *
 * Usage:
 *   1. Start RecourseOS server: recourse serve
 *   2. Run this test: npx tsx test.ts
 */

import { handleRunTask } from './handler.js';

// Sample Terraform plan (inline for testing without TFC)
const samplePlan = {
  format_version: "1.2",
  terraform_version: "1.5.0",
  resource_changes: [
    {
      address: "aws_s3_bucket.logs",
      type: "aws_s3_bucket",
      name: "logs",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: {
        actions: ["delete"],
        before: {
          bucket: "prod-logs",
          versioning: [{ enabled: false }],
        },
        after: null,
      },
    },
    {
      address: "aws_db_instance.prod",
      type: "aws_db_instance",
      name: "prod",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: {
        actions: ["delete"],
        before: {
          identifier: "prod-database",
          skip_final_snapshot: true,
          backup_retention_period: 0,
        },
        after: null,
      },
    },
  ],
};

// Mock TFC request
const mockRequest = {
  payload_version: 1,
  access_token: "mock-token",
  stage: "post_plan" as const,
  run_id: "run-test123",
  workspace_id: "ws-test123",
  workspace_name: "test-workspace",
  organization_name: "test-org",
  plan_json_api_url: "mock://plan", // Will be intercepted
  configuration_version_id: "cv-test123",
  run_message: "Test run",
  run_created_at: new Date().toISOString(),
  run_created_by: "test@example.com",
};

// Mock fetch to intercept plan request
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
  const urlStr = typeof url === 'string' ? url : url.toString();

  // Mock TFC plan fetch
  if (urlStr === "mock://plan") {
    return new Response(JSON.stringify(samplePlan), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mock TFC callback
  if (urlStr.includes('callback')) {
    console.log('\n📤 TFC Callback would be sent:');
    const body = init?.body ? JSON.parse(init.body as string) : null;
    console.log(JSON.stringify(body, null, 2));
    return new Response('{}', { status: 200 });
  }

  // Pass through to real fetch (RecourseOS API)
  return originalFetch(url, init);
};

async function runTest() {
  console.log('🧪 Testing Terraform Cloud Run Task Handler\n');
  console.log('📋 Sample Plan:');
  console.log(`   - Delete aws_s3_bucket.logs (no versioning)`);
  console.log(`   - Delete aws_db_instance.prod (skip_final_snapshot=true)`);
  console.log('');

  try {
    const result = await handleRunTask(mockRequest, 'mock://callback', {
      RECOURSE_API_URL: 'http://localhost:3001',
    });

    console.log('\n📊 Result:');
    console.log(`   Status: ${result.status}`);
    console.log(`   URL: ${result.url}`);
    console.log('\n📝 Message:');
    console.log(result.message?.split('\n').map(l => `   ${l}`).join('\n'));

    if (result.status === 'failed') {
      console.log('\n✅ Test passed: Dangerous plan correctly blocked');
    } else {
      console.log('\n⚠️  Test note: Plan was allowed (check RecourseOS config)');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.log('\n💡 Make sure RecourseOS server is running: recourse serve');
    process.exit(1);
  }
}

runTest();
