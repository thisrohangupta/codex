export const hello = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ service: 'functions', status: 'ok' }),
});

