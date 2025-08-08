'use client';
import { useEffect, useState } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };
type PlanStep = { id: string; title: string; status: 'pending' | 'planned' | 'running' | 'succeeded' | 'failed' };
type Plan = { id: string; summary: string; steps: PlanStep[] };

export default function Page() {
  const [input, setInput] = useState('Deploy web to staging canary 10%');
  const [messages, setMessages] = useState<Message[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [policy, setPolicy] = useState<{ allow: boolean; findings: { level: string; message: string; code: string }[] } | null>(null);
  const [approval, setApproval] = useState<{ id: string; status: string } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [envs, setEnvs] = useState<any[]>([]);
  const [envId, setEnvId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/environments').then((r) => r.json()).then((d) => {
      setEnvs(d.environments);
      if (d.environments.length) setEnvId(d.environments[0].id);
    });
  }, []);

  const requestPlan = async () => {
    setMessages((m) => [...m, { role: 'user', content: input }]);
    const res = await fetch('/api/agent/plan', { method: 'POST', body: JSON.stringify({ prompt: input, envId }) });
    const data = await res.json();
    setPlan(data.plan);
    setMessages((m) => [...m, { role: 'assistant', content: data.plan.summary }]);
    const pol = await fetch('/api/policy/evaluate', { method: 'POST', body: JSON.stringify({ planId: data.plan.id }) }).then((r) => r.json());
    setPolicy(pol);
  };

  const approvePlan = async () => {
    if (!plan) return;
    const res = await fetch('/api/agent/execute', { method: 'POST', body: JSON.stringify({ planId: plan.id }) });
    const data = await res.json();
    setRunId(data.runId);
  };

  const requestApprovalAction = async () => {
    if (!plan) return;
    const res = await fetch('/api/approvals', { method: 'POST', body: JSON.stringify({ planId: plan.id }) });
    const data = await res.json();
    setApproval({ id: data.approval.id, status: data.approval.status });
  };

  const adminApprove = async () => {
    if (!approval) return;
    const res = await fetch(`/api/approvals/${approval.id}/approve`, { method: 'POST' });
    const data = await res.json();
    setApproval({ id: data.approval.id, status: data.approval.status });
  };

  useEffect(() => {
    if (!runId) return;
    const ev = new EventSource(`/api/runs/${runId}/events`);
    ev.onmessage = (e) => {
      try {
        const update = JSON.parse(e.data);
        if (update.type === 'status' && update.stepId) {
          setPlan((p) => (p ? { ...p, steps: p.steps.map((s) => (s.id === update.stepId ? { ...s, status: update.status } : s)) } : p));
        }
        if (update.type === 'log') {
          setMessages((m) => [...m, { role: 'assistant', content: update.line }]);
        }
        if (update.done) ev.close();
      } catch {}
    };
    return () => ev.close();
  }, [runId]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <section>
        <h2>Chat</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <label>Environment:</label>
          <select value={envId ?? ''} onChange={(e) => setEnvId(e.target.value)}>
            {envs.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.provider}/{e.target}
              </option>
            ))}
          </select>
        </div>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, minHeight: 200 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <strong>{m.role === 'user' ? 'You' : 'AI'}:</strong> {m.content}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe what you want to do" style={{ flex: 1 }} />
          <button onClick={requestPlan}>Plan</button>
        </div>
      </section>
      <section>
        <h2>Plan Preview</h2>
        {!plan && <p>No plan yet. Ask for one on the left.</p>}
        {plan && (
          <div>
            <p>{plan.summary}</p>
            {policy && (
              <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6, marginBottom: 8 }}>
                <strong>Policy:</strong> {policy.allow ? 'allow' : 'blocked'}
                <ul>
                  {policy.findings.map((f, i) => (
                    <li key={i}>
                      [{f.level}] {f.code}: {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ol>
              {plan.steps.map((s) => (
                <li key={s.id}>
                  {s.title} — <em>{s.status}</em>
                </li>
              ))}
            </ol>
            <div style={{ display: 'flex', gap: 8 }}>
              {!approval && <button onClick={requestApprovalAction}>Request Approval</button>}
              {approval && approval.status === 'requested' && <button onClick={adminApprove}>Admin Approve</button>}
              <button onClick={approvePlan} disabled={!!runId || (policy && !policy.allow && (!approval || approval.status !== 'approved'))}>
                Execute
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
