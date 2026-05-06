# llama-recourse

LlamaIndex tools for [RecourseOS](https://recourseos.dev) - evaluate consequences before your AI agent executes destructive actions.

## Installation

```bash
pip install llama-recourse
```

**Requires:** Node.js 18+ (for `npx recourse-cli`)

## Quick Start

```python
from llama_recourse import get_recourse_tools
from llama_index.core.agent import ReActAgent
from llama_index.llms.openai import OpenAI

# Get RecourseOS tools
tools = get_recourse_tools()

# Create agent with consequence checking
llm = OpenAI(model="gpt-4")
agent = ReActAgent.from_tools(
    tools,
    llm=llm,
    verbose=True,
    system_prompt="""Before any destructive action, use recourse_evaluate_* tools.
    If risk is BLOCK, refuse to proceed. If ESCALATE, ask user to confirm."""
)

response = agent.chat("Delete the S3 bucket prod-backups")
```

## Tools

### `recourse_evaluate_terraform`

Evaluate Terraform plans before `terraform apply`.

```python
from llama_recourse import recourse_evaluate_terraform

result = recourse_evaluate_terraform(
    plan_json='{"resource_changes": [...]}',
    state_json=None  # optional
)
print(result)
# **Risk Assessment: BLOCK**
# ...
```

### `recourse_evaluate_shell`

Evaluate shell commands before execution.

```python
from llama_recourse import recourse_evaluate_shell

result = recourse_evaluate_shell("aws s3 rm s3://prod-data --recursive")
print(result)
# **Risk Assessment: BLOCK**
# ...
```

### `recourse_evaluate_mcp`

Evaluate MCP tool calls before invocation.

```python
from llama_recourse import recourse_evaluate_mcp

result = recourse_evaluate_mcp(
    server="aws",
    tool="s3.delete_bucket",
    arguments={"bucket": "prod-data"}
)
print(result)
# **Risk Assessment: ESCALATE**
# ...
```

## Full Agent Example

```python
from llama_recourse import get_recourse_tools
from llama_index.core.agent import ReActAgent
from llama_index.llms.openai import OpenAI
from llama_index.core.tools import FunctionTool

# Your existing tools
def execute_shell(command: str) -> str:
    """Execute a shell command."""
    import subprocess
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return result.stdout or result.stderr

shell_tool = FunctionTool.from_defaults(
    fn=execute_shell,
    name="execute_shell",
    description="Execute a shell command"
)

# Combine with RecourseOS tools
all_tools = [shell_tool] + get_recourse_tools()

# Create safety-aware agent
agent = ReActAgent.from_tools(
    all_tools,
    llm=OpenAI(model="gpt-4"),
    verbose=True,
    system_prompt="""You are a DevOps assistant.

CRITICAL: Before using execute_shell with ANY destructive command,
you MUST first use recourse_evaluate_shell to check consequences.

Based on the risk assessment:
- BLOCK: Refuse to proceed. Explain the danger.
- ESCALATE: Ask for explicit user confirmation.
- WARN: Inform user of risks, proceed if they agree.
- ALLOW: Proceed normally."""
)

# The agent will now check consequences before destructive actions
response = agent.chat("Remove all files from /tmp/old-backups")
print(response)
```

## With Query Engine Tools

```python
from llama_recourse import get_recourse_tools
from llama_index.core.agent import ReActAgent
from llama_index.core.tools import QueryEngineTool

# Your query engine
query_tool = QueryEngineTool.from_defaults(
    query_engine=index.as_query_engine(),
    name="docs_search",
    description="Search documentation"
)

# Add RecourseOS for safety
tools = [query_tool] + get_recourse_tools()
agent = ReActAgent.from_tools(tools, llm=llm)
```

## Risk Levels

| Level | Meaning | Agent Behavior |
|-------|---------|----------------|
| `ALLOW` | Safe to proceed | Execute normally |
| `WARN` | Recoverable but notable | Proceed with caution |
| `ESCALATE` | Needs human review | Ask user to confirm |
| `BLOCK` | Unrecoverable data loss | Do NOT proceed |

## Requirements

- Python 3.9+
- Node.js 18+ (for `npx recourse-cli`)
- `llama-index-core>=0.10.0`

## License

MIT
