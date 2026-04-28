## What the product is

**A consequence-evaluation layer for AI agents and automation.**

It sits at the MCP seam (and at IaC tools like Terraform, which behave like an MCP layer for infrastructure even when no agent is involved). Every time an agent — or a pipeline, or a human running `terraform apply` — is about to call a tool that mutates state, the request gets paused, evaluated for what it actually does to the current world, and either auto-approved, blocked, or escalated to a human with the consequences spelled out.

It is not an identity tool. It is not a permissions tool. It is not a model gateway. It assumes those exist and works downstream of them. Its only job is the question no other layer answers: *given the current state of the system, what does this specific call do, and is that recoverable?*

## What it actually consists of

Three components, in order of importance:

**1. The state-aware analyzer.** This is the engineering core and the moat. For each kind of resource it protects — Terraform plans, SQL statements, AWS API calls, Kubernetes manifests, shell commands — it builds a live model of what exists, what depends on what, and what the call would change. Then it labels every change with a recoverability class: reversible, recoverable-with-effort, recoverable-from-backup, or unrecoverable. The output is a structured report a human can read in five seconds: *this call deletes 1 RDS instance, 3 EBS volumes, 47 snapshots, and breaks 12 Lambda functions. Recoverability: none.*

**2. The interception adapters.** Thin shims that catch the call before it executes. The three forms we already drew: an MCP server bundle (covers Cursor, Claude Code, Copilot, Kiro, and any future agent that speaks MCP), a CI/CD action and runner image (covers GitHub Actions, Azure Pipelines, CodeCatalyst, GitLab), and a shell wrapper for terraform/kubectl/psql/aws (covers humans and scripts). All three feed the same analyzer. They are deliberately commoditizable — anyone can write a shim — because the value lives in the analyzer, not the shim.

**3. The approval and audit plane.** When the analyzer flags something unrecoverable, the call waits for an out-of-band human approval — Slack, PR comment, or web console with SSO. Importantly, the approver is a *different identity* than the agent. The agent cannot self-approve no matter how clever it is, because the approval channel is on a network and identity surface the agent has no credentials for. Every decision (approved, blocked, auto-passed) is written to an append-only log that can be exported to SIEM and used as SOC2 evidence.

## What it deliberately is not

It is not a sandbox. It does not try to re-host your agents in a controlled environment. The whole point is that it works wherever your agents already run.

It is not a replacement for IAM, Entra, or any identity layer. Those still need to do their job — restricting *what is reachable*. This product restricts *what is consequential* among the things that are reachable.

It is not a model proxy. It does not care which LLM produced the call or whether the model is hosted on Bedrock, Azure OpenAI, or Anthropic direct. It looks at the structured tool call coming out, not the tokens going in.

It is not a code review tool. It evaluates *runtime calls against live state*, not pull requests against a codebase. A `terraform apply` is dangerous or safe depending on what already exists in the cloud, not on what the diff looks like.

## The packaging

**Free and open source: the core.** The analyzer for the most common resource types (Terraform plans, Postgres/MySQL/Mongo, AWS core services, Kubernetes), all three interception adapters, local audit log, single-user CLI approvals, YAML policy DSL. A solo developer or a small team can install it in an afternoon and immediately get blast-radius previews on every destructive call. This is the distribution engine — engineers find it through HN/GitHub/word-of-mouth, install it, and the install base becomes the foundation for everything else.

**Paid SaaS: everything that turns it into a team and enterprise product.** Hosted control plane with team RBAC and SSO. Slack and PR-comment approval flows with on-call routing. SIEM exporters. Anomaly detection (this agent is doing something it has never done before). Pre-built policy packs for HIPAA, PCI, SOC2. The curated **pattern library** — known-dangerous AI agent behaviors learned from the entire customer base, updated continuously. Managed deployment for teams that don't want to run the proxy themselves.

The split works because the buyers are different. The OSS user is an engineer who wants `blast plan` to tell them what their `terraform apply` will do. The SaaS buyer is a head of platform or a CISO who needs auditable controls across a fleet of agents touching production. The free product doesn't cannibalize the paid one because no compliance officer has ever accepted "we self-host an open-source tool with local-only logs" as their answer.

## The strategic position

The single most important thing to internalize from the layer analysis is this: **AWS and Microsoft will keep building the layers around this one, and that is good for you, not bad for you.** Better identity scoping, better MCP servers, more granular IAM — all of these *raise the floor* but leave your layer untouched. Every time a vendor ships a new MCP server or a new agent identity feature, the surface area of "agents doing consequential things on behalf of humans" grows, and the need for a consequence layer grows with it.

The cloud providers cannot easily build this themselves because it doesn't fit their primitives. AWS thinks in IAM policies. Microsoft thinks in Entra principals. Neither thinks in "blast radius from current state" because that abstraction crosses every cloud, every database, every IaC tool, and depends on live system state, not configuration. It belongs to a third party. That third party can be you.

## The one-line description

If someone asks you what the company does at a dinner party, the answer is now small enough to fit:

*We're the layer that tells you what an AI agent is actually about to destroy, before it does — across every cloud and every tool. Identity says who can call. We say what the call will do.*

That's the product. The diagrams we walked through aren't background context for it; they *are* the argument for why it has to exist as a separate thing. Want to look at what to build first — the v0.1 that proves the analyzer works on a single resource type — or sketch the go-to-market that turns OSS adoption into enterprise revenue?