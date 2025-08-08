'use client';
import { useMockMode } from '../lib/useMock';

export default function MockToggle() {
  const [mock, setMock] = useMockMode(true);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className={`badge ${mock ? 'ok' : 'warn'}`}>{mock ? 'Mock Mode' : 'Live Mode'}</span>
      <button className="btn btn-ghost" onClick={() => setMock(!mock)}>{mock ? 'Disable' : 'Enable'}</button>
    </div>
  );
}

