# langchain-recourse

LangChain tools for [RecourseOS](https://recourseos.dev) - evaluate consequences before your AI agent executes destructive actions.

## Installation

```bash
pip install langchain-recourse
```

**Requires:** Node.js 18+ (for `npx recourse-cli`)

## Quick Start

```python
from langchain_recourse import RecourseToolkit
from langchain_openai import ChatOpenAI
from langchain.agents import create_react_agent, AgentExecutor

# Get all RecourseOS tools
toolkit = RecourseToolkit()
tools = toolkit.get_tools()

# Create your agent with consequence checking
llm = ChatOpenAI(model="gpt-4")
agent = create_react_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools)
```

## Tools

### `recourse_evaluate_terraform`

Evaluate Terraform plans before `terraform apply`.

```python
from langchain_recourse import RecourseEvaluateTerraform

tool = RecourseEvaluateTerraform()
result = tool.invoke({
    "plan_json": '{"resource_changes": [...]}'
})
# Returns: "**Risk Assessment: BLOCK** ..."
```

### `recourse_evaluate_shell`

Evaluate shell commands before execution.

```python
from langchain_recourse import RecourseEvaluateShell

tool = RecourseEvaluateShell()
result = tool.invoke({
    "command": "aws s3 rm s3://prod-data --recursive"
})
# Returns: "**Risk Assessment: BLOCK** ..."
```

### `recourse_evaluate_mcp`

Evaluate MCP tool calls before invocation.

```python
from langchain_recourse import RecourseEvaluateMCP

tool = RecourseEvaluateMCP()
result = tool.invoke({
    "server": "aws",
    "tool": "s3.delete_bucket",
    "arguments": {"bucket": "prod-data"}
})
# Returns: "**Risk Assessment: ESCALATE** ..."
```

## Risk Levels

| Level | Meaning | Agent Behavior |
|-------|---------|----------------|
| `ALLOW` | Safe to proceed | Execute normally |
| `WARN` | Recoverable but notable | Proceed with caution |
| `ESCALATE` | Needs human review | Ask user to confirm |
| `BLOCK` | Unrecoverable data loss | Do NOT proceed |

## Agent Integration Example

Here's a complete example of an agent that checks consequences before destructive actions:

```python
from langchain_recourse import RecourseToolkit, RecourseEvaluateShell
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain.agents import create_tool_calling_agent, AgentExecutor

# System prompt that enforces consequence checking
system_prompt = """You are a helpful DevOps assistant.

IMPORTANT: Before executing ANY destructive command (delete, remove, drop, etc.),
you MUST first use the recourse_evaluate_shell tool to check consequences.

If the risk assessment is:
- BLOCK: Refuse to proceed. Explain why to the user.
- ESCALATE: Ask the user to explicitly confirm before proceeding.
- WARN: Inform the user of the risk, then proceed if they agree.
- ALLOW: Proceed normally.

Never skip the consequence check for destructive operations."""

prompt = ChatPromptTemplate.from_messages([
    ("system", system_prompt),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

# Setup
llm = ChatOpenAI(model="gpt-4")
tools = RecourseToolkit().get_tools()
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run
result = executor.invoke({
    "input": "Delete the S3 bucket called prod-backups"
})
```

## With Other Tools

Combine RecourseOS tools with your existing tools:

```python
from langchain_recourse import RecourseToolkit
from langchain_community.tools import ShellTool

# Your tools + RecourseOS tools
my_tools = [ShellTool()]
recourse_tools = RecourseToolkit().get_tools()
all_tools = my_tools + recourse_tools
```

## Configuration

The tools use `npx recourse-cli@latest` under the hood. Ensure:

1. Node.js 18+ is installed
2. `npx` is in PATH
3. Network access to npm registry (first run downloads the CLI)

## License

MIT
