/**
 * Agent + RecourseOS Demo
 *
 * User talks to an AI agent. Agent tries to execute commands.
 * RecourseOS intercepts dangerous actions. User approves/rejects.
 *
 * This is the real flow:
 * 1. User: "Delete the staging RDS to save costs"
 * 2. Agent interprets → aws rds delete-db-instance...
 * 3. RecourseOS intercepts → ESCALATE
 * 4. UI shows approval drawer
 * 5. User approves/rejects
 * 6. Agent continues or stops
 */

import * as React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';

const API_URL = 'http://localhost:3099';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  pending?: boolean;
  command?: string;
  evaluation?: any;
  status?: 'thinking' | 'executing' | 'waiting' | 'approved' | 'rejected' | 'completed';
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Intent Mapping (simulates Claude Code understanding)
// ─────────────────────────────────────────────────────────────────────────────

interface AgentAction {
  thought: string;
  command: string;
  dangerous: boolean;
}

function interpretUserIntent(input: string): AgentAction | null {
  const lower = input.toLowerCase();

  // RDS operations
  if (lower.includes('delete') && (lower.includes('rds') || lower.includes('database') || lower.includes('db'))) {
    const dbName = lower.includes('staging') ? 'staging-db' :
                   lower.includes('prod') ? 'prod-database' :
                   lower.includes('test') ? 'test-db' : 'my-database';
    return {
      thought: `I'll delete the ${dbName} RDS instance to help reduce costs.`,
      command: `aws rds delete-db-instance --db-instance-identifier ${dbName} --skip-final-snapshot`,
      dangerous: true,
    };
  }

  // S3 operations
  if (lower.includes('delete') && (lower.includes('s3') || lower.includes('bucket'))) {
    const bucket = lower.includes('backup') ? 'old-backups' :
                   lower.includes('log') ? 'application-logs' :
                   lower.includes('data') ? 'customer-data' : 'my-bucket';
    return {
      thought: `I'll delete the ${bucket} S3 bucket.`,
      command: `aws s3 rb s3://${bucket} --force`,
      dangerous: true,
    };
  }

  // EC2 operations
  if (lower.includes('terminate') && (lower.includes('ec2') || lower.includes('instance') || lower.includes('server'))) {
    return {
      thought: "I'll terminate the EC2 instance.",
      command: 'aws ec2 terminate-instances --instance-ids i-0123456789abcdef0',
      dangerous: true,
    };
  }

  // Kubernetes operations
  if (lower.includes('delete') && (lower.includes('deploy') || lower.includes('kubernetes') || lower.includes('k8s') || lower.includes('pod'))) {
    const resource = lower.includes('api') ? 'api-server' : 'web-frontend';
    return {
      thought: `I'll delete the ${resource} deployment from Kubernetes.`,
      command: `kubectl delete deployment ${resource} -n production`,
      dangerous: true,
    };
  }

  // Docker operations
  if (lower.includes('remove') && lower.includes('container')) {
    return {
      thought: "I'll remove all Docker containers.",
      command: 'docker rm -f $(docker ps -aq)',
      dangerous: true,
    };
  }

  // File operations
  if ((lower.includes('delete') || lower.includes('remove') || lower.includes('rm')) &&
      (lower.includes('file') || lower.includes('folder') || lower.includes('directory') || lower.includes('data'))) {
    const path = lower.includes('log') ? '/var/log/*' :
                 lower.includes('temp') ? '/tmp/*' :
                 lower.includes('data') ? '/var/data/*' : '/app/data/*';
    return {
      thought: `I'll remove the files at ${path}.`,
      command: `rm -rf ${path}`,
      dangerous: true,
    };
  }

  // Safe operations - list/describe/get
  if (lower.includes('list') || lower.includes('show') || lower.includes('describe') || lower.includes('get')) {
    if (lower.includes('s3') || lower.includes('bucket')) {
      return {
        thought: "I'll list the S3 buckets.",
        command: 'aws s3 ls',
        dangerous: false,
      };
    }
    if (lower.includes('ec2') || lower.includes('instance')) {
      return {
        thought: "I'll describe the EC2 instances.",
        command: 'aws ec2 describe-instances',
        dangerous: false,
      };
    }
    if (lower.includes('pod') || lower.includes('kubernetes')) {
      return {
        thought: "I'll list the Kubernetes pods.",
        command: 'kubectl get pods -A',
        dangerous: false,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

async function evaluateCommand(command: string) {
  const res = await fetch(`${API_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: { source: 'shell', command }, description: command }),
  });
  return res.json();
}

async function approveEvaluation(id: string) {
  await fetch(`${API_URL}/approve/${id}`, { method: 'POST' });
}

async function rejectEvaluation(id: string) {
  await fetch(`${API_URL}/reject/${id}`, { method: 'POST' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '80%',
        padding: '12px 16px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        backgroundColor: isUser ? '#00ff66' : isSystem ? 'rgba(255, 184, 0, 0.15)' : 'rgba(232, 232, 232, 0.08)',
        color: isUser ? '#0a0a0a' : '#e8e8e8',
        fontSize: 13,
        lineHeight: 1.5,
      }}>
        {!isUser && !isSystem && (
          <div style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.5)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Claude Code
          </div>
        )}
        <div>{message.content}</div>

        {/* Show command being executed */}
        {message.command && (
          <div style={{
            marginTop: 10,
            padding: '8px 12px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: 4,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            color: '#ff5f57',
            wordBreak: 'break-all',
          }}>
            $ {message.command}
          </div>
        )}

        {/* Status indicator */}
        {message.status && message.status !== 'completed' && (
          <div style={{
            marginTop: 8,
            fontSize: 10,
            color: message.status === 'waiting' ? '#ffb800' :
                   message.status === 'approved' ? '#00ff66' :
                   message.status === 'rejected' ? '#ff5f57' : '#00d4ff',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}>
            {message.status === 'thinking' && '● Thinking...'}
            {message.status === 'executing' && '● Evaluating with RecourseOS...'}
            {message.status === 'waiting' && '● Awaiting your approval'}
            {message.status === 'approved' && '✓ Approved'}
            {message.status === 'rejected' && '✗ Rejected'}
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalBanner({ evaluation, onApprove, onReject }: {
  evaluation: any;
  onApprove: () => void;
  onReject: () => void;
}) {
  const e = evaluation.result;
  return (
    <div style={{
      padding: 16,
      backgroundColor: 'rgba(255, 184, 0, 0.1)',
      borderTop: '1px solid rgba(255, 184, 0, 0.3)',
      borderBottom: '1px solid rgba(255, 184, 0, 0.3)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#ffb800', marginBottom: 8 }}>
            ⚠ RecourseOS Intercepted a Dangerous Action
          </div>
          <div style={{ fontSize: 11, color: 'rgba(232, 232, 232, 0.8)', marginBottom: 8 }}>
            {e.reason}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ padding: '2px 8px', fontSize: 10, backgroundColor: 'rgba(255, 95, 87, 0.2)', color: '#ff5f57', borderRadius: 2 }}>
              {e.summary.worstRecoverability.label}
            </span>
            {e.mutations.map((m: any, i: number) => (
              <span key={i} style={{ padding: '2px 8px', fontSize: 10, backgroundColor: 'rgba(0, 212, 255, 0.15)', color: '#00d4ff', borderRadius: 2 }}>
                {m.target.type} → {m.action}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onApprove}
            style={{
              padding: '8px 20px',
              backgroundColor: '#00ff66',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Approve
          </button>
          <button
            onClick={onReject}
            style={{
              padding: '8px 20px',
              backgroundColor: 'transparent',
              color: '#ff5f57',
              border: '1px solid #ff5f57',
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export function AgentDemo() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: "Hi! I'm Claude Code. I can help you manage your infrastructure. Try asking me to delete a database, remove containers, or clean up S3 buckets - RecourseOS will intercept any dangerous actions.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [pendingApproval, setPendingApproval] = useState<{ messageId: string; evaluation: any } | null>(null);
  const [processing, setProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const approvalResolver = useRef<((approved: boolean) => void) | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const id = `msg-${Date.now()}`;
    setMessages(prev => [...prev, { ...msg, id, timestamp: new Date() }]);
    return id;
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || processing) return;

    const userInput = input.trim();
    setInput('');
    setProcessing(true);

    // Add user message
    addMessage({ role: 'user', content: userInput });

    // Agent thinks
    const agentMsgId = addMessage({ role: 'agent', content: 'Let me help you with that...', status: 'thinking' });
    await sleep(800);

    // Interpret intent
    const action = interpretUserIntent(userInput);

    if (!action) {
      updateMessage(agentMsgId, {
        content: "I'm not sure how to help with that. Try asking me to delete a database, remove S3 buckets, terminate EC2 instances, or clean up Kubernetes deployments.",
        status: 'completed',
      });
      setProcessing(false);
      return;
    }

    // Agent decides to execute
    updateMessage(agentMsgId, {
      content: action.thought,
      command: action.command,
      status: 'executing',
    });
    await sleep(500);

    // Evaluate with RecourseOS
    try {
      const evaluation = await evaluateCommand(action.command);

      if (evaluation.result.decision === 'allow') {
        updateMessage(agentMsgId, { status: 'completed' });
        addMessage({
          role: 'agent',
          content: '✓ Command executed successfully. RecourseOS verified this action is safe.',
        });
      } else if (evaluation.result.decision === 'block') {
        updateMessage(agentMsgId, { status: 'rejected' });
        addMessage({
          role: 'system',
          content: `🛑 RecourseOS blocked this action: ${evaluation.result.reason}`,
        });
      } else {
        // Escalate - need approval
        updateMessage(agentMsgId, { status: 'waiting', evaluation });
        setPendingApproval({ messageId: agentMsgId, evaluation });

        const approved = await new Promise<boolean>(resolve => {
          approvalResolver.current = resolve;
        });

        if (approved) {
          await approveEvaluation(evaluation.id);
          updateMessage(agentMsgId, { status: 'approved' });
          addMessage({
            role: 'agent',
            content: '✓ Action approved and executed. Thank you for confirming.',
          });
        } else {
          await rejectEvaluation(evaluation.id);
          updateMessage(agentMsgId, { status: 'rejected' });
          addMessage({
            role: 'agent',
            content: 'Understood. I won\'t execute that command.',
          });
        }
        setPendingApproval(null);
      }
    } catch (err) {
      updateMessage(agentMsgId, { status: 'rejected' });
      addMessage({
        role: 'system',
        content: `Error connecting to RecourseOS: ${err}`,
      });
    }

    setProcessing(false);
  }, [input, processing, addMessage, updateMessage]);

  const handleApprove = useCallback(() => {
    approvalResolver.current?.(true);
    approvalResolver.current = null;
  }, []);

  const handleReject = useCallback(() => {
    approvalResolver.current?.(false);
    approvalResolver.current = null;
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#0a0a0a',
      color: '#e8e8e8',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(232, 232, 232, 0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Claude Code</span>
          <span style={{ fontSize: 11, color: 'rgba(232, 232, 232, 0.5)', marginLeft: 12 }}>
            Protected by RecourseOS
          </span>
        </div>
        <div style={{
          fontSize: 10,
          padding: '4px 12px',
          color: '#00ff66',
          border: '1px solid #00ff66',
          borderRadius: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}>
          Connected
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Approval Banner */}
      {pendingApproval && (
        <ApprovalBanner
          evaluation={pendingApproval.evaluation}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} style={{
        padding: '16px 24px',
        borderTop: '1px solid rgba(232, 232, 232, 0.1)',
        display: 'flex',
        gap: 12,
      }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Try: Delete the staging database to save costs..."
          disabled={processing}
          style={{
            flex: 1,
            padding: '12px 16px',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(232, 232, 232, 0.15)',
            borderRadius: 4,
            color: '#e8e8e8',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={processing || !input.trim()}
          style={{
            padding: '12px 24px',
            backgroundColor: processing ? 'rgba(232, 232, 232, 0.2)' : '#00ff66',
            color: processing ? 'rgba(232, 232, 232, 0.5)' : '#0a0a0a',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: processing ? 'default' : 'pointer',
            fontFamily: 'inherit',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          Send
        </button>
      </form>

      {/* Example prompts */}
      <div style={{
        padding: '12px 24px',
        borderTop: '1px solid rgba(232, 232, 232, 0.05)',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, color: 'rgba(232, 232, 232, 0.4)', marginRight: 8 }}>Try:</span>
        {[
          'Delete the staging RDS',
          'Remove the old S3 backups',
          'Terminate the test EC2 instance',
          'Delete the api-server deployment',
          'List all S3 buckets',
        ].map(prompt => (
          <button
            key={prompt}
            onClick={() => setInput(prompt)}
            disabled={processing}
            style={{
              padding: '4px 10px',
              backgroundColor: 'rgba(232, 232, 232, 0.05)',
              border: '1px solid rgba(232, 232, 232, 0.1)',
              borderRadius: 2,
              color: 'rgba(232, 232, 232, 0.6)',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default AgentDemo;
