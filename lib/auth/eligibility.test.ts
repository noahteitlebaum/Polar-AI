import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./eligibility";

describe("isAllowedEmail", () => {
  it.each(["student@uwo.ca", "  Student.Name@UWO.CA ", "a+b@uwo.ca"])("allows %s", (e) => {
    expect(isAllowedEmail(e)).toBe(true);
  });

  it.each([
    "",
    "student@gmail.com",
    "student@sub.uwo.ca",
    "student@uwo.ca.evil.com",
    "student@xuwo.ca",
    "student@uwo.co",
    "student@uwo.ca.",
    "studеnt@uwo.ca", // Cyrillic "е"
    "student@uwо.ca", // Cyrillic "о"
    "student@@uwo.ca",
    "uwo.ca",
    "@uwo.ca",
  ])("rejects %s", (e) => {
    expect(isAllowedEmail(e)).toBe(false);
  });
});
