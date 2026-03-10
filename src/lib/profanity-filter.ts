import { Profanity } from "@2toad/profanity";

// Create profanity instance with English and Hindi support
const profanity = new Profanity({
	languages: ["en", "hi"],
	wholeWord: false, // Allow partial word matches (e.g., "chod" in "behenchod")
	grawlix: "***",
});

// Additional custom words (Hindi and English)
const customHindiWords = [
	// Common Hindi profanity/slurs
	"behenchod",
	"madarchod",
	"chutiya",
	"bhosadike",
	"randi",
	"harami",
	"kutte",
	"suar",
	"jhantu",
	"gaand",
	"chut",
	"lund",
	"randwa",
	"lavde",
	"gandu",
	"bhenchod",
	"maachod",
	"bhadwe",
	"chutiye",
	"madar",
	"chod",
	"chodne",
	"chodu",
	"choda",
];

const customEnglishWords = [
	// Additional English words that might not be in default list
	"fk",
	"fking",
	"stupid",
	"idiot",
	"moron",
	"retard",
	"loser",
	"dumbass",
];

// Add custom words
profanity.addWords([...customHindiWords, ...customEnglishWords]);

/**
 * Censor text by replacing profanity with ***
 * Used for display purposes only - original text is preserved in database
 */
export function censorText(text: string): string {
	if (!text || typeof text !== "string") return text;
	return profanity.censor(text);
}

/**
 * Check if text contains profanity
 * Useful for logging or analytics
 */
export function containsProfanity(text: string): boolean {
	if (!text || typeof text !== "string") return false;
	return profanity.exists(text);
}
