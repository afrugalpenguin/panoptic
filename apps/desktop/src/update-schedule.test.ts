import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, scheduleUpdateChecks } from "./update-schedule";

describe("scheduleUpdateChecks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never: makes no checks at all, at launch or later", () => {
    const check = vi.fn();
    scheduleUpdateChecks("never", check, { atLaunch: true });
    vi.advanceTimersByTime(5 * HOUR_MS);
    expect(check).not.toHaveBeenCalled();
  });

  it("startup: checks once at launch and never again", () => {
    const check = vi.fn();
    scheduleUpdateChecks("startup", check, { atLaunch: true });
    vi.advanceTimersByTime(5 * HOUR_MS);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("hourly: checks at launch and then every hour", () => {
    const check = vi.fn();
    scheduleUpdateChecks("hourly", check, { atLaunch: true });
    vi.advanceTimersByTime(3 * HOUR_MS);
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("switching to hourly mid-session does not check immediately", () => {
    const check = vi.fn();
    scheduleUpdateChecks("hourly", check, { atLaunch: false });
    expect(check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR_MS);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("stopping cancels the hourly timer", () => {
    const check = vi.fn();
    const stop = scheduleUpdateChecks("hourly", check, { atLaunch: false });
    stop();
    vi.advanceTimersByTime(3 * HOUR_MS);
    expect(check).not.toHaveBeenCalled();
  });
});
