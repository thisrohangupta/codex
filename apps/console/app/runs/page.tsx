'use client';
import { useEffect, useState } from 'react';

type Run = { id: string; createdAt: string; planSummary: string; status: string };

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  useEffect(() => {
    fetch('/api/runs').then((r) => r.json()).then((d) => setRuns(d.runs));
  }, []);
  return (
    <div>
      <h2>Runs</h2>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <strong>{r.planSummary}</strong> — {r.status} — {new Date(r.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

