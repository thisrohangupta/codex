export function assertTrue(value: boolean, message: string): void {
  if (!value) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}; expected=${String(expected)} actual=${String(actual)}`);
  }
}

export async function assertRejects<T>(
  promise: Promise<T>,
  expectedMessageSubstring: string,
  message: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Assertion failed: ${message}; promise resolved unexpectedly`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(expectedMessageSubstring)) {
      throw new Error(
        `Assertion failed: ${message}; expected error containing "${expectedMessageSubstring}"`,
      );
    }
  }
}
