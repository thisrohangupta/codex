import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";
import { vi } from "vitest";

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("renders hero content and workflow picker", () => {
    render(<App />);
    expect(screen.getByText(/Agentic pipeline orchestrator/i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud Release Autopilot/i)).toBeInTheDocument();
  });

  it("allows selecting a different workflow", () => {
    render(<App />);
    const buttons = screen.getAllByRole("button", { name: /select workflow/i });
    fireEvent.click(buttons[0]);
    expect(screen.getByText(/Secure Supply Chain pipeline/i)).toBeInTheDocument();
  });

  it("runs the pipeline and completes all steps", async () => {
    render(<App />);
    const executeButton = screen.getByRole("button", { name: /execute pipeline/i });

    fireEvent.click(executeButton);
    expect(screen.getByText(/Pipeline running/i)).toBeInTheDocument();

    await act(async () => {
      vi.runAllTimers();
    });

    const completedBadges = screen.getAllByText(/Completed/i);
    expect(completedBadges.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("button", { name: /execute pipeline/i })).toBeEnabled();
  });
});
