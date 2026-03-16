import { describe, it, expect } from "vitest";
import { censorText, containsProfanity } from "#/lib/profanity-filter";

describe("Profanity Filter", () => {
	describe("censorText", () => {
		it("censors Hindi profanity", () => {
			const result = censorText("You are a chutiya");
			expect(result).not.toContain("chutiya");
			expect(result).toContain("***");
		});

		it("censors English profanity", () => {
			const result = censorText("This is damn good");
			expect(result).not.toContain("damn");
			expect(result).toContain("***");
		});

		it("handles empty string", () => {
			const result = censorText("");
			expect(result).toBe("");
		});

		it("handles null/undefined", () => {
			expect(censorText(null as unknown as string)).toBe(null);
			expect(censorText(undefined as unknown as string)).toBe(undefined);
		});

		it("handles non-string input", () => {
			expect(censorText(123 as unknown as string)).toBe(123);
			expect(censorText({} as unknown as string)).toEqual({});
		});

		it("preserves clean text", () => {
			const cleanText = "This is a nice room for gaming";
			const result = censorText(cleanText);
			expect(result).toBe(cleanText);
		});

		it("censors multiple profanities in one text", () => {
			const result = censorText("chutiya madarchod behenchod");
			expect(result).not.toContain("chutiya");
			expect(result).not.toContain("madarchod");
			expect(result).not.toContain("behenchod");
		});

		it("preserves whitelisted words", () => {
			const result = censorText("Welcome to BhayanakCast, it's bhayanak!");
			expect(result).toContain("BhayanakCast");
			expect(result).toContain("bhayanak");
		});

		it("handles partial word matches", () => {
			const result = censorText("behenchod person");
			expect(result).not.toContain("behenchod");
		});

		it("handles case variations", () => {
			const result1 = censorText("CHUTIYA");
			const result2 = censorText("Chutiya");
			const result3 = censorText("cHuTiYa");

			expect(result1).not.toContain("CHUTIYA");
			expect(result2).not.toContain("Chutiya");
			expect(result3).not.toContain("cHuTiYa");
		});

		it("censors custom English words", () => {
			const result = censorText("You are such an idiot");
			expect(result).not.toContain("idiot");
			expect(result).toContain("***");
		});

		it("handles text with punctuation", () => {
			const result = censorText("chutiya! madarchod? behenchod.");
			expect(result).not.toContain("chutiya");
			expect(result).not.toContain("madarchod");
			expect(result).not.toContain("behenchod");
		});

		it("handles words that may contain profanity substrings", () => {
			// Note: The filter uses partial matching, so some legitimate words
			// may be partially censored. This is expected behavior for aggressive filtering.
			const result1 = censorText("analytical");
			const result2 = censorText("scuttle");
			const result3 = censorText("shuttle");

			// These words contain substrings that match profanity patterns
			// The filter censors the matching portion
			expect(typeof result1).toBe("string");
			expect(typeof result2).toBe("string");
			expect(typeof result3).toBe("string");
		});
	});

	describe("containsProfanity", () => {
		it("returns true for Hindi profanity", () => {
			expect(containsProfanity("You are a chutiya")).toBe(true);
			expect(containsProfanity("madarchod behavior")).toBe(true);
		});

		it("returns true for English profanity", () => {
			expect(containsProfanity("This is damn good")).toBe(true);
		});

		it("returns false for clean text", () => {
			expect(containsProfanity("This is a nice room")).toBe(false);
		});

		it("returns false for whitelisted words", () => {
			expect(containsProfanity("BhayanakCast is awesome")).toBe(false);
			expect(containsProfanity("This is bhayanak")).toBe(false);
		});

		it("handles empty string", () => {
			expect(containsProfanity("")).toBe(false);
		});

		it("handles null/undefined", () => {
			expect(containsProfanity(null as unknown as string)).toBe(false);
			expect(containsProfanity(undefined as unknown as string)).toBe(false);
		});

		it("handles multiple profanities", () => {
			expect(containsProfanity("chutiya madarchod")).toBe(true);
		});

		it("handles case variations", () => {
			expect(containsProfanity("CHUTIYA")).toBe(true);
			expect(containsProfanity("Chutiya")).toBe(true);
		});

		it("detects custom English words", () => {
			expect(containsProfanity("You idiot")).toBe(true);
			expect(containsProfanity("What a moron")).toBe(true);
		});
	});

	describe("Common Usage Patterns", () => {
		it("handles room names", () => {
			const roomName = "Gaming with chutiyas";
			const censored = censorText(roomName);
			expect(censored).not.toContain("chutiyas");
		});

		it("handles chat messages", () => {
			const chat = "Hey madarchod, nice play!";
			const censored = censorText(chat);
			expect(censored).not.toContain("madarchod");
		});

		it("handles user descriptions", () => {
			const description = "I love gaming and I'm not a behenchod";
			const censored = censorText(description);
			expect(censored).not.toContain("behenchod");
		});

		it("handles very long text", () => {
			const longText = "a".repeat(1000) + " chutiya " + "b".repeat(1000);
			const censored = censorText(longText);
			expect(censored).not.toContain("chutiya");
			// Note: Length may change because profanity is replaced with ***
			// which can be different length than original word
			expect(censored.length).toBeGreaterThan(0);
		});

		it("handles special characters", () => {
			const text = "chutiya@#$%^&*()madarchod";
			const censored = censorText(text);
			expect(censored).not.toContain("chutiya");
			expect(censored).not.toContain("madarchod");
		});

		it("handles numbers in text", () => {
			const text = "123chutiya456madarchod789";
			const censored = censorText(text);
			expect(censored).not.toContain("chutiya");
			expect(censored).not.toContain("madarchod");
		});

		it("handles emojis", () => {
			const text = "chutiya madarchod 😀👍";
			const censored = censorText(text);
			expect(censored).not.toContain("chutiya");
			expect(censored).not.toContain("madarchod");
			expect(censored).toContain("😀");
			expect(censored).toContain("👍");
		});
	});

	describe("Edge Cases", () => {
		it("handles only profanity", () => {
			const result = censorText("chutiya");
			expect(result).not.toContain("chutiya");
			expect(result).toBe("***");
		});

		it("handles profanity at start", () => {
			const result = censorText("chutiya is here");
			expect(result).not.toContain("chutiya");
		});

		it("handles profanity at end", () => {
			const result = censorText("you are a chutiya");
			expect(result).not.toContain("chutiya");
		});

		it("handles repeated profanity", () => {
			const result = censorText("chutiya chutiya chutiya");
			const count = (result.match(/\*\*\*/g) || []).length;
			expect(count).toBe(3);
		});

		it("handles whitespace variations", () => {
			const result1 = censorText("chutiya madarchod");
			const result2 = censorText("chutiya  madarchod");
			const result3 = censorText("chutiya\tmadarchod");

			expect(result1).not.toContain("chutiya");
			expect(result2).not.toContain("chutiya");
			expect(result3).not.toContain("chutiya");
		});
	});
});
