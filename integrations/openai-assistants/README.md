# RecourseOS for OpenAI Assistants

Add consequence evaluation to your OpenAI Assistants before they execute destructive actions.

## Quick Start

### 1. Copy the files

```bash
cp recourse_functions.py your_project/
```

### 2. Create an Assistant with RecourseOS tools

```python
from openai import OpenAI
from recourse_functions import RECOURSE_TOOLS

client = OpenAI()

assistant = client.beta.assistants.create(
    name="DevOps Assistant",
    model="gpt-4-turbo",
    tools=RECOURSE_TOOLS,
    instructions="""You are a helpful DevOps assistant.

CRITICAL SAFETY RULE: Before executing ANY destructive action, you MUST use the
appropriate recourse_evaluate_* function to check consequences:

- recourse_evaluate_terraform: Before terraform apply
- recourse_evaluate_shell: Before rm, delete, drop, terminate commands
- recourse_evaluate_mcp: Before calling destructive MCP tools

Based on the risk assessment:
- BLOCK: Refuse to proceed. Explain the danger to the user.
- ESCALATE: Ask for explicit user confirmation before proceeding.
- WARN: Inform the user of risks, then proceed if they agree.
- ALLOW: Proceed normally.

Never skip the safety check for destructive operations."""
)
```

### 3. Handle function calls in your run loop

```python
import json
from recourse_functions import handle_recourse_function

def process_run(thread_id, run_id):
    while True:
        run = client.beta.threads.runs.retrieve(thread_id=thread_id, run_id=run_id)

        if run.status == "requires_action":
            tool_outputs = []

            for tool_call in run.required_action.submit_tool_outputs.tool_calls:
                name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                # Handle RecourseOS functions
                if name.startswith("recourse_"):
                    result = handle_recourse_function(name, args)
                else:
                    result = handle_other_function(name, args)

                tool_outputs.append({
                    "tool_call_id": tool_call.id,
                    "output": result
                })

            client.beta.threads.runs.submit_tool_outputs(
                thread_id=thread_id,
                run_id=run_id,
                tool_outputs=tool_outputs
            )

        elif run.status == "completed":
            break
        elif run.status in ["failed", "cancelled", "expired"]:
            raise Exception(f"Run failed: {run.status}")

        time.sleep(0.5)
```

## Full Example

```python
import json
import time
from openai import OpenAI
from recourse_functions import RECOURSE_TOOLS, handle_recourse_function

client = OpenAI()

# Create assistant
assistant = client.beta.assistants.create(
    name="Infrastructure Assistant",
    model="gpt-4-turbo",
    tools=RECOURSE_TOOLS + [{"type": "code_interpreter"}],
    instructions="""You help with infrastructure tasks.

SAFETY: Always use recourse_evaluate_* before destructive actions.
If risk is BLOCK or ESCALATE, ask the user before proceeding."""
)

# Create thread and send message
thread = client.beta.threads.create()
message = client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="Delete the S3 bucket called prod-backups"
)

# Run the assistant
run = client.beta.threads.runs.create(
    thread_id=thread.id,
    assistant_id=assistant.id
)

# Process the run
while True:
    run = client.beta.threads.runs.retrieve(
        thread_id=thread.id,
        run_id=run.id
    )

    if run.status == "requires_action":
        tool_outputs = []
        for tc in run.required_action.submit_tool_outputs.tool_calls:
            args = json.loads(tc.function.arguments)

            if tc.function.name.startswith("recourse_"):
                output = handle_recourse_function(tc.function.name, args)
            else:
                output = "Function not implemented"

            tool_outputs.append({"tool_call_id": tc.id, "output": output})

        client.beta.threads.runs.submit_tool_outputs(
            thread_id=thread.id,
            run_id=run.id,
            tool_outputs=tool_outputs
        )

    elif run.status == "completed":
        break
    elif run.status in ["failed", "cancelled", "expired"]:
        print(f"Run failed: {run.last_error}")
        break

    time.sleep(0.5)

# Get the response
messages = client.beta.threads.messages.list(thread_id=thread.id)
print(messages.data[0].content[0].text.value)
```

## Available Functions

### `recourse_evaluate_terraform`

Evaluates Terraform plan JSON before apply.

```python
result = handle_recourse_function("recourse_evaluate_terraform", {
    "plan_json": '{"resource_changes": [...]}',
    "state_json": '...'  # optional
})
```

### `recourse_evaluate_shell`

Evaluates shell commands for destructive patterns.

```python
result = handle_recourse_function("recourse_evaluate_shell", {
    "command": "aws s3 rm s3://bucket --recursive"
})
```

### `recourse_evaluate_mcp`

Evaluates MCP tool calls.

```python
result = handle_recourse_function("recourse_evaluate_mcp", {
    "server": "aws",
    "tool": "s3.delete_bucket",
    "arguments": {"bucket": "prod-data"}
})
```

## Risk Levels

| Level | Meaning | Recommended Action |
|-------|---------|-------------------|
| ✅ ALLOW | Safe | Proceed normally |
| ⚠️ WARN | Recoverable risk | Inform user, then proceed |
| 🖐️ ESCALATE | Needs review | Ask user to confirm |
| ⛔ BLOCK | Unrecoverable | Refuse to proceed |

## Requirements

- Python 3.9+
- Node.js 18+ (for `npx recourse-cli`)
- `openai` Python package

## License

MIT
