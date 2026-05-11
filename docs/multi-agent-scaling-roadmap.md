# Multi-Agent Scaling Roadmap

**Feature: RecourseOS Pro — Multi-Agent Support (10+ concurrent agents)**

This document outlines the technical roadmap for scaling RecourseOS to support 10+ concurrent AI agents. This is a premium/enterprise feature.

---

## Current State

| Metric | Current Capacity | Target (Pro) |
|--------|------------------|--------------|
| Concurrent evaluations | 3/sec | 50+/sec |
| Max agents | 1-3 | 100+ |
| State lookup latency | 200-500ms | <50ms |
| Request latency under load | >5s | <500ms |

**Bottlenecks identified:**
- Synchronous blast-radius evaluation blocks event loop
- No connection pooling for AWS/GCP/Azure API calls
- No state caching — every evaluation re-fetches
- In-memory attestations don't scale across processes
- No request queuing or backpressure

---

## Phase 1: Core Parallelization (Week 1-2)

### 1.1 Async Evaluation Pipeline
**Priority: Critical**

Move blast-radius analysis off the main thread.

```
src/evaluator/terraform.ts
src/evaluator/shell.ts
src/evaluator/mcp.ts
```

**Changes:**
- [ ] Wrap `evaluateBlastRadius()` in Worker thread pool
- [ ] Use `piscina` or `workerpool` for thread management
- [ ] Max workers = CPU cores - 1
- [ ] Fallback to async queue if workers exhausted

**Impact:** 3 evals/sec → 15-20 evals/sec per process

### 1.2 Request Queue with Backpressure
**Priority: Critical**

```
src/mcp/server.ts
src/http/server.ts
```

**Changes:**
- [ ] Add `p-queue` with concurrency limit
- [ ] Implement circuit breaker for downstream failures
- [ ] Add queue depth metrics
- [ ] Return 429 when queue exceeds threshold

**Config:**
```typescript
{
  maxConcurrency: 10,
  maxQueueSize: 100,
  queueTimeout: 30000
}
```

---

## Phase 2: Connection & Caching (Week 2-3)

### 2.1 AWS SDK v3 Migration
**Priority: High**

Replace custom `AwsSignedClient` with official SDK.

```
src/state/aws/*.ts
```

**Changes:**
- [ ] Migrate to `@aws-sdk/client-*` packages
- [ ] Enable HTTP/2 multiplexing
- [ ] Configure keep-alive connection pooling
- [ ] Add retry with exponential backoff

**Impact:** 50 connections → 5-10 reused connections

### 2.2 State Cache Layer
**Priority: High**

Add Redis-backed cache for state lookups.

```
NEW: src/cache/state-cache.ts
NEW: src/cache/redis-client.ts
```

**Cache strategy:**
| Resource Type | TTL | Cache Key |
|--------------|-----|-----------|
| S3 bucket | 60s | `s3:{region}:{bucket}` |
| RDS instance | 30s | `rds:{region}:{instanceId}` |
| EC2 instance | 30s | `ec2:{region}:{instanceId}` |
| IAM role | 300s | `iam:{accountId}:{roleName}` |

**Changes:**
- [ ] Add `ioredis` dependency
- [ ] Implement cache-aside pattern
- [ ] Add cache hit/miss metrics
- [ ] Support cache invalidation via MCP tool

**Impact:** ~70% cache hit rate → 2-3x throughput

### 2.3 GCP/Azure Parity
**Priority: Medium**

Apply same optimizations to other cloud providers.

```
src/state/gcp/*.ts
src/state/azure/*.ts
```

---

## Phase 3: Distributed Architecture (Week 3-4)

### 3.1 Redis-Backed Attestations
**Priority: High**

Replace in-memory + file attestation storage.

```
src/attestation/service.ts
NEW: src/attestation/redis-store.ts
```

**Changes:**
- [ ] Implement `AttestationStore` interface
- [ ] Add Redis implementation with TTL
- [ ] Support cross-process attestation lookups
- [ ] Add attestation replication for HA

**Schema:**
```
attestation:{id} → JSON(Attestation)
attestation:by-resource:{resourceId} → SET(attestationIds)
```

### 3.2 Horizontal Scaling
**Priority: Medium**

Support multi-process deployment.

```
NEW: src/cluster.ts
```

**Changes:**
- [ ] Add Node.js cluster mode support
- [ ] Sticky sessions for MCP connections
- [ ] Shared Redis for cross-process state
- [ ] PM2 ecosystem config

**Deployment options:**
- Single node: 4-8 workers via cluster
- Multi-node: Load balancer + Redis

### 3.3 Connection Multiplexing
**Priority: Medium**

Single MCP connection serving multiple agents.

```
src/mcp/server.ts
NEW: src/mcp/multiplexer.ts
```

**Changes:**
- [ ] Add agent ID to request context
- [ ] Route responses to correct agent
- [ ] Per-agent rate limiting
- [ ] Agent isolation (no cross-contamination)

---

## Phase 4: Observability & Hardening (Week 4-5)

### 4.1 Metrics & Monitoring
**Priority: High**

```
NEW: src/metrics/prometheus.ts
```

**Metrics to track:**
- `recourse_evaluation_duration_seconds` (histogram)
- `recourse_queue_depth` (gauge)
- `recourse_cache_hit_ratio` (gauge)
- `recourse_active_agents` (gauge)
- `recourse_state_lookup_duration_seconds` (histogram)

### 4.2 Rate Limiting
**Priority: High**

Per-agent and global rate limits.

```
NEW: src/ratelimit/index.ts
```

**Tiers:**
| Plan | Evals/min | Agents | State lookups/min |
|------|-----------|--------|-------------------|
| Free | 10 | 1 | 100 |
| Pro | 500 | 25 | 5000 |
| Enterprise | Unlimited | 100+ | Unlimited |

### 4.3 Graceful Degradation
**Priority: Medium**

- [ ] Timeout slow evaluations (30s max)
- [ ] Fallback to cached state on API failures
- [ ] Circuit breaker for cloud provider APIs
- [ ] Health check endpoints

---

## Phase 5: Enterprise Features (Week 5-6)

### 5.1 Multi-Tenancy
**Priority: Enterprise**

```
NEW: src/tenant/index.ts
```

- [ ] Tenant isolation
- [ ] Per-tenant Redis namespaces
- [ ] Tenant-specific rate limits
- [ ] Usage metering per tenant

### 5.2 Streaming Evaluations
**Priority: Enterprise**

For large Terraform plans (1000+ resources).

- [ ] Stream changes instead of buffering
- [ ] Incremental blast-radius updates
- [ ] Progress callbacks to agents

### 5.3 Audit Logging
**Priority: Enterprise**

- [ ] Structured audit log for all evaluations
- [ ] S3/CloudWatch export
- [ ] Compliance reporting

---

## Dependencies

```json
{
  "piscina": "^4.0.0",
  "p-queue": "^7.0.0",
  "ioredis": "^5.3.0",
  "@aws-sdk/client-s3": "^3.500.0",
  "@aws-sdk/client-rds": "^3.500.0",
  "@aws-sdk/client-ec2": "^3.500.0",
  "prom-client": "^15.0.0"
}
```

---

## Milestones

| Milestone | Target | Deliverable |
|-----------|--------|-------------|
| M1: Parallel Eval | Week 2 | 15+ evals/sec single process |
| M2: Cached State | Week 3 | <50ms state lookups |
| M3: Multi-Process | Week 4 | 50+ evals/sec cluster |
| M4: Pro Beta | Week 5 | 25 agent support |
| M5: Enterprise GA | Week 6 | 100+ agent support |

---

## Pricing Considerations

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Concurrent agents | 1 | 25 | 100+ |
| Evaluations/month | 1,000 | 50,000 | Unlimited |
| State caching | No | Yes | Yes |
| Redis (managed) | No | Included | Dedicated |
| SLA | None | 99.5% | 99.9% |
| Support | Community | Email | Dedicated |

---

## Open Questions

1. **Redis hosting**: Managed (Upstash/Redis Cloud) vs self-hosted?
2. **Pricing model**: Per-agent vs per-evaluation vs flat tier?
3. **Agent authentication**: API keys per agent or per org?
4. **Data residency**: Regional Redis deployments needed?

---

*Last updated: 2026-05-10*
