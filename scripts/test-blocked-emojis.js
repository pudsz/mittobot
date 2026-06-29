const automod = require("../src/automod");

const { hasBlockedMessageEmoji, hasBlockedReactionEmoji, normalizeEmojiToken } = automod._test;

let failed = false;

function check(name, condition) {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    failed = true;
    console.error(`FAIL: ${name}`);
  }
}

check("unicode message emoji matches", hasBlockedMessageEmoji("hello 😀", ["😀"]));
check("custom message emoji matches by mention", hasBlockedMessageEmoji("bad <:blocked:123456789012345678>", ["<:blocked:123456789012345678>"]));
check("custom message emoji matches by id", hasBlockedMessageEmoji("bad <:blocked:123456789012345678>", ["123456789012345678"]));
check("custom name:id normalizes to id", normalizeEmojiToken("blocked:123456789012345678") === "123456789012345678");
check("unlisted message emoji does not match", !hasBlockedMessageEmoji("hello 😀", ["😎"]));

const unicodeReaction = { name: "💀", id: null, animated: false };
const customReaction = { name: "blocked", id: "123456789012345678", animated: false };
const animatedReaction = { name: "blocked", id: "999999999999999999", animated: true };

check("unicode reaction emoji matches", hasBlockedReactionEmoji(unicodeReaction, ["💀"]));
check("custom reaction emoji matches by id", hasBlockedReactionEmoji(customReaction, ["123456789012345678"]));
check("custom reaction emoji matches by name:id", hasBlockedReactionEmoji(customReaction, ["blocked:123456789012345678"]));
check("animated reaction emoji matches by mention", hasBlockedReactionEmoji(animatedReaction, ["<a:blocked:999999999999999999>"]));
check("unlisted reaction emoji does not match", !hasBlockedReactionEmoji(customReaction, ["different:111111111111111111"]));

process.exit(failed ? 1 : 0);
