'use client';
import { useEffect, useState } from 'react';

const KEY = 'mockMode';

export function useMockMode(defaultOn = true): [boolean, (v: boolean) => void] {
  const [mock, setMock] = useState<boolean>(defaultOn);
  useEffect(() => {
    const v = localStorage.getItem(KEY);
    if (v === null) {
      localStorage.setItem(KEY, defaultOn ? '1' : '0');
      setMock(defaultOn);
    } else {
      setMock(v === '1');
    }
  }, [defaultOn]);
  const update = (v: boolean) => {
    setMock(v);
    localStorage.setItem(KEY, v ? '1' : '0');
  };
  return [mock, update];
}

