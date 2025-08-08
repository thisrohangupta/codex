export type Service = {
  id: string;
  imageRepo: string; // without tag
  port: number; // containerPort
  chartDefaults?: Record<string, any>;
};

export const services: Service[] = [
  { id: 'web', imageRepo: 'ghcr.io/your-org/ai-web', port: 3000 },
  { id: 'api-python', imageRepo: 'ghcr.io/your-org/ai-api-python', port: 8000 },
  { id: 'api-go', imageRepo: 'ghcr.io/your-org/ai-api-go', port: 8080 },
  { id: 'api-java', imageRepo: 'ghcr.io/your-org/ai-api-java', port: 8081 },
];

export function getService(id: string) {
  return services.find((s) => s.id === id);
}

