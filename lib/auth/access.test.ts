import { describe, expect, it } from "vitest";
import { accessFor } from "./access";

describe("accessFor", () => {
  it("waitlists everyone by default", () => {
    expect(accessFor("a@uwo.ca", {})).toBe("waitlist");
  });
  it("lets early-access emails in (case and spaces ignored)", () => {
    const env = { EARLY_ACCESS_EMAILS: " Noah@UWO.ca , tester@uwo.ca" };
    expect(accessFor("noah@uwo.ca", env)).toBe("app");
    expect(accessFor("TESTER@uwo.ca", env)).toBe("app");
    expect(accessFor("other@uwo.ca", env)).toBe("waitlist");
  });
  it("opens the app to everyone when WAITLIST_MODE=off", () => {
    expect(accessFor("x@uwo.ca", { WAITLIST_MODE: "OFF" })).toBe("app");
  });
  it("never grants access without an email", () => {
    expect(accessFor(undefined, { WAITLIST_MODE: "off" })).toBe("waitlist");
    expect(accessFor("", { EARLY_ACCESS_EMAILS: "" })).toBe("waitlist");
  });
});
