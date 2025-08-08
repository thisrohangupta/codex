'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { mockPlan, runMockPlan, mockPolicy } from '../lib/mock';

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
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const { push } = useToast();
  const MOCK = true;

  useEffect(() => {
    fetch('/api/environments').then((r) => r.json()).then((d) => {
      setEnvs(d.environments);
      if (d.environments.length) setEnvId(d.environments[0].id);
    });
  }, []);

  const requestPlan = async () => {
    setMessages((m) => [...m, { role: 'user', content: input }]);
    setLoading(true);
    try {
      if (MOCK) {
        const p = mockPlan(input);
        setPlan(p);
        setMessages((m) => [...m, { role: 'assistant', content: p.summary }]);
        setPolicy(mockPolicy(p));
        push({ type: 'success', message: 'Plan created (mock)' });
      } else {
        const res = await fetch('/api/agent/plan', { method: 'POST', body: JSON.stringify({ prompt: input, envId }) });
        const data = await res.json();
        setPlan(data.plan);
        setMessages((m) => [...m, { role: 'assistant', content: data.plan.summary }]);
        const pol = await fetch('/api/policy/evaluate', { method: 'POST', body: JSON.stringify({ planId: data.plan.id }) }).then((r) => r.json());
        setPolicy(pol);
      }
    } catch (e) {
      push({ type: 'error', message: 'Failed to create plan' });
    } finally {
      setLoading(false);
    }
  };

  const approvePlan = async () => {
    if (!plan) return;
    if (MOCK) {
      setRunId('mock');
      runMockPlan(plan, (u) => {
        if (u.type === 'status' && u.stepId) {
          setPlan((p) => (p ? { ...p, steps: p.steps.map((s) => (s.id === u.stepId ? { ...s, status: u.status } : s)) } : p));
        }
        if (u.type === 'log') {
          setMessages((m) => [...m, { role: 'assistant', content: u.line }]);
          if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      });
      push({ type: 'success', message: 'Execution started (mock)' });
    } else {
      const res = await fetch('/api/agent/execute', { method: 'POST', body: JSON.stringify({ planId: plan.id }) });
      const data = await res.json();
      setRunId(data.runId);
    }
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
    <div className="grid-2">
      <section>
        <h2>Chat</h2>
        <div className="controls mb-8">
          <label className="muted">Environment:</label>
          <select className="select" value={envId ?? ''} onChange={(e) => setEnvId(e.target.value)}>
            {envs.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.provider}/{e.target}
              </option>
            ))}
          </select>
        </div>
        <div className="glass card messages" ref={logRef} style={{ maxHeight: 280, overflow: 'auto' }}>
          {messages.map((m, i) => (
            <div key={i} className="msg">
              <strong>{m.role === 'user' ? 'You' : 'AI'}:</strong> {m.content}
            </div>
          ))}
          {loading && <div className="skeleton" style={{ height: 16 }} />}
        </div>
        <div className="controls mt-8">
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe what you want to do" />
          <button className="btn btn-primary" onClick={requestPlan} disabled={loading}>Plan</button>
        </div>
      </section>
      <section>
        <h2>Plan Preview</h2>
        {!plan && <p className="muted">No plan yet. Ask for one on the left.</p>}
        {plan && (
          <div className="glass card">
            <p>{plan.summary}</p>
            {policy && (
              <div className="policy">
                <strong>Policy:</strong>{' '}
                <span className={policy.allow ? 'ok' : 'blocked'}>{policy.allow ? 'allow' : 'blocked'}</span>
                <ul>
                  {policy.findings.map((f, i) => (
                    <li key={i}>
                      [{f.level}] {f.code}: {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="stack">
              {plan.steps.map((s) => (
                <li key={s.id}>
                  {s.title} — <span className={`badge ${s.status === 'succeeded' ? 'ok' : s.status === 'running' ? 'warn' : ''}`}>{s.status}</span>
                </li>
              ))}
            </ol>
            <div className="controls mt-8">
              {!approval && <button className="btn btn-ghost" onClick={requestApprovalAction}>Request Approval</button>}
              {approval && approval.status === 'requested' && <button className="btn btn-ghost" onClick={adminApprove}>Admin Approve</button>}
              <button className="btn btn-primary" onClick={approvePlan} disabled={!!runId || (policy && !policy.allow && (!approval || approval.status !== 'approved'))}>
                Execute
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
