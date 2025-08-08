"use client";
import { useEffect, useMemo, useState } from 'react';

type Env = { id: string; name: string; provider: string; target: string; region?: string };
type Plan = { id: string; summary: string; steps: any[] };
type Policy = { allow: boolean; findings: { level: string; message: string; code: string }[] };

type Svc = { id: string; imageRepo: string; port: number };

export default function DeploymentsPage() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [envId, setEnvId] = useState<string>('');
  const [svc, setSvc] = useState<string>('web');
  const [catalog, setCatalog] = useState<Svc[]>([]);
  const [image, setImage] = useState<string>('');
  const [release, setRelease] = useState<string>('');
  const [namespace, setNamespace] = useState<string>('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);

  useEffect(() => {
    fetch('/api/environments').then((r) => r.json()).then((d) => {
      setEnvs(d.environments);
      if (d.environments.length) {
        setEnvId(d.environments[0].id);
        setNamespace(d.environments[0].name);
      }
    });
    fetch('/api/catalog/services').then((r) => r.json()).then((d) => setCatalog(d.services || []));
  }, []);

  useEffect(() => {
    const sel = catalog.find((s) => s.id === svc);
    if (sel) {
      fetch(`/api/images/latest?repo=${encodeURIComponent(sel.imageRepo)}`)
        .then((r) => r.json())
        .then((d) => setImage(`${sel.imageRepo}:${d.tag || 'latest'}`));
      if (!release) setRelease(`${sel.id}-${namespace || 'demo'}`);
    }
  }, [svc, namespace, catalog]);

  const valuesObj = useMemo(() => ({
    image: { repository: image.split(':')[0], tag: image.split(':')[1] || 'latest' },
    service: { targetPort: (catalog.find((s) => s.id === svc)?.port) || 3000 },
  }), [image, catalog, svc]);
  const valuesYaml = useMemo(() => {
    const obj = valuesObj as any;
    return `image:\n  repository: ${obj.image.repository}\n  tag: ${obj.image.tag}\n`;
  }, [valuesObj]);

  async function createPlan() {
    const meta = { helm: { release, chartPath: 'ops/helm/app', namespace, values: valuesObj } };
    const prompt = `Deploy ${svc} to ${namespace} canary 10%`;
    const res = await fetch('/api/agent/plan', { method: 'POST', body: JSON.stringify({ prompt, envId, meta }) });
    const data = await res.json();
    setPlan(data.plan);
    const pol = await fetch('/api/policy/evaluate', { method: 'POST', body: JSON.stringify({ planId: data.plan.id }) }).then((r) => r.json());
    setPolicy(pol);
  }

  async function execute() {
    if (!plan) return;
    const res = await fetch('/api/agent/execute', { method: 'POST', body: JSON.stringify({ planId: plan.id }) });
    const data = await res.json();
    setRunId(data.runId);
  }

  return (
    <div>
      <h2>Deployments Wizard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section>
          <div style={{ display: 'grid', gap: 8 }}>
            <label>
              Environment
              <select value={envId} onChange={(e) => { setEnvId(e.target.value); const env = envs.find(x => x.id === e.target.value); setNamespace(env?.name || ''); }}>
                {envs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.provider}/{e.target}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Service
              <select value={svc} onChange={(e) => setSvc(e.target.value)}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Release
              <input value={release} onChange={(e) => setRelease(e.target.value)} />
            </label>
            <label>
              Namespace
              <input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
            </label>
            <label>
              Image (repo:tag)
              <input value={image} onChange={(e) => setImage(e.target.value)} />
            </label>
            <div>
              <button onClick={createPlan}>Create Plan</button>
              <button onClick={execute} disabled={!plan || (policy && !policy.allow)} style={{ marginLeft: 8 }}>
                Execute
              </button>
            </div>
          </div>
        </section>
        <section>
          <h3>Helm Values Preview</h3>
          <pre style={{ background: '#fafafa', padding: 10, border: '1px solid #eee', borderRadius: 6 }}>{valuesYaml}</pre>
          <h3>Plan</h3>
          {!plan && <p>No plan yet.</p>}
          {plan && (
            <div>
              <p>{plan.summary}</p>
              <ol>
                {plan.steps.map((s) => (
                  <li key={s.id}>{s.title}</li>
                ))}
              </ol>
              {policy && (
                <div style={{ padding: 8, border: '1px solid #eee', borderRadius: 6, marginTop: 8 }}>
                  <strong>Policy:</strong> {policy.allow ? 'allow' : 'blocked'}
                  <ul>
                    {policy.findings.map((f, i) => (
                      <li key={i}>[{f.level}] {f.code}: {f.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
