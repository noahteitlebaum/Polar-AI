import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password";

describe("passwordProblem", () => {
  it("accepts a reasonable password", () => expect(passwordProblem("polarbear42", "polarbear42")).toBeNull());
  it("rejects short ones", () => expect(passwordProblem("ab1")).toMatch(/at least 8/));
  it("needs a letter and a number", () => {
    expect(passwordProblem("abcdefgh")).toMatch(/letter and one number/);
    expect(passwordProblem("12345678")).toMatch(/letter and one number/);
  });
  it("checks the confirmation", () => expect(passwordProblem("polarbear42", "polarbear43")).toMatch(/match/));
});
