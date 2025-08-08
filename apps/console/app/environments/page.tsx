'use client';
import { useEffect, useState } from 'react';

type Env = { id: string; name: string; provider: string; target: string; region?: string; createdAt: string };

export default function EnvironmentsPage() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [name, setName] = useState('staging');
  const [provider, setProvider] = useState('aws');
  const [target, setTarget] = useState('kubernetes');
  const [region, setRegion] = useState('us-east-1');

  const refresh = () => fetch('/api/environments').then((r) => r.json()).then((d) => setEnvs(d.environments));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    await fetch('/api/environments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, provider, target, region }) });
    refresh();
  };

  return (
    <div>
      <h2>Environments</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="aws">AWS</option>
          <option value="gcp">GCP</option>
          <option value="azure">Azure</option>
          <option value="local">Local</option>
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="kubernetes">Kubernetes</option>
          <option value="vm">VM</option>
          <option value="serverless">Serverless</option>
        </select>
        <input placeholder="region" value={region} onChange={(e) => setRegion(e.target.value)} />
        <button onClick={create}>Add</button>
      </div>
      <ul>
        {envs.map((e) => (
          <li key={e.id}><strong>{e.name}</strong> — {e.provider}/{e.target} — {e.region} — {new Date(e.createdAt).toLocaleString()}</li>
        ))}
      </ul>
    </div>
  );
}

