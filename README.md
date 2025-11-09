# Tron Chess

This repository now contains both the Tron Chess web game and the Agentic Pipelines demo application.

## Development

### Tron Chess

Install dependencies and start the dev server:

```bash
cd games/tron-chess
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

### Agentic Pipelines Demo

The agentic pipelines product lives in the `apps/agentic-pipelines` workspace. To run it locally:

```bash
cd apps/agentic-pipelines
npm install
npm run dev
```

This will start a Vite development server. Follow the terminal output to open the provided local URL (typically `http://localhost:5173`) in your browser and interact with the shadcn UI-driven workflows.
