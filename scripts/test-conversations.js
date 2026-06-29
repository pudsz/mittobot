/**
 * Test script: verifies the AI conversation system correctly preserves
 * user identification across multi-user shared channel threads.
 *
 * Run: node scripts/test-conversations.js
 */

const db = require("../src/db");

async function main() {
// ── Setup: initialise schema ────────────────────────────────────────
console.log("[test] Initialising DB schema...");
db.init();

const TEST_GUILD = "test_guild_multi_user";
const TEST_CHANNEL = "test_channel_general";
const USER_A = "100000000000000001"; // Alice
const USER_B = "100000000000000002"; // Bob
const USER_C = "100000000000000003"; // Carol

// ── Clean up any leftover test data ─────────────────────────────────
db.db.prepare("DELETE FROM ai_conversations WHERE guild_id = ? AND channel_id = ?")
  .run(TEST_GUILD, TEST_CHANNEL);
db.db.prepare("DELETE FROM ai_conversations WHERE guild_id = ? AND user_id IN (?, ?, ?)")
  .run(TEST_GUILD, USER_A, USER_B, USER_C);

console.log("[test] Cleaned up old test data.");

// ── Insert: multi-user conversation in shared channel ──────────────
// Simulate a real conversation:
//   Alice: "hey mitto what's 2+2?"
//   Bot: "4!"
//   Bob: "mitto what's my name?"
//   Bot: "I don't know your name, but I remember Alice asked about math."
//   Carol: "mitto hello"
//   Bot: "Hey Carol!"

const turns = [
  { scope: "global", key: { guildId: TEST_GUILD, channelId: TEST_CHANNEL, userId: USER_A }, role: "user", content: "hey mitto what's 2+2?" },
  { scope: "global", key: { guildId: TEST_GUILD, channelId: TEST_CHANNEL, userId: USER_A }, role: "assistant", content: "4!" },
  { scope: "global", key: { guildId: TEST_GUILD, channelId: TEST_CHANNEL, userId: USER_B }, role: "user", content: "mitto what's my name?" },
  { scope: "global", key: { guildId: TEST_GUILD, channelId: TEST_CHANNEL, userId: USER_B }, role: "assistant", content: "I don't know your name yet!" },
  { scope: "global", key: { guildId: TEST_GUILD, channelId: TEST_CHANNEL, userId: USER_C }, role: "user", content: "mitto hello" },
  { scope: "global", key: { guildId: TEST_GUILD, channelId: TEST_CHANNEL, userId: USER_C }, role: "assistant", content: "Hey Carol!" },
];

for (const turn of turns) {
  db.addConversationTurn(turn.scope, turn.key, turn.role, turn.content);
}
console.log(`[test] Inserted ${turns.length} conversation turns.`);

// ── Test 1: getConversationHistory attributes only user turns ───────
console.log("\n── Test 1: getConversationHistory user attribution ──");
const history = db.getConversationHistory("global", { guildId: TEST_GUILD, channelId: TEST_CHANNEL }, 20);

let attributionShapeOk = true;
for (const row of history) {
  if (row.role === "user" && !row.user_id) {
    console.log(`  FAIL: user row missing user_id — content="${row.content.slice(0, 30)}..."`);
    attributionShapeOk = false;
  }
  if (row.role !== "user" && row.user_id !== null) {
    console.log(`  FAIL: non-user row should not have user_id — role=${row.role}, user_id=${row.user_id}`);
    attributionShapeOk = false;
  }
}
if (attributionShapeOk) {
  console.log("  PASS: user rows have speakers; assistant rows are not misattributed");
}

// ── Test 2: Verify user messages have correct user_id ───────────────
console.log("\n── Test 2: User messages have correct user_id ──");
const userMessages = history.filter(r => r.role === "user");
const expected = [
  { user_id: USER_A, content: "hey mitto what's 2+2?" },
  { user_id: USER_B, content: "mitto what's my name?" },
  { user_id: USER_C, content: "mitto hello" },
];

let userIdsCorrect = true;
for (let i = 0; i < expected.length; i++) {
  const row = userMessages[i];
  if (!row || row.user_id !== expected[i].user_id) {
    console.log(`  FAIL: expected user_id=${expected[i].user_id}, got ${row?.user_id}`);
    userIdsCorrect = false;
  }
}
if (userIdsCorrect) {
  console.log("  PASS: all user messages have correct user_id");
}

// ── Test 3: Simulate buildMessageHistory formatting ─────────────────
console.log("\n── Test 3: buildMessageHistory speaker labels ──");
// This mirrors the new formatting in src/ai.js buildMessageHistory
const formatted = history.map(row => {
  if (row.role === "user" && row.user_id) {
    return {
      role: "user",
      name: String(row.user_id).slice(0, 64),
      content: `[User id:${row.user_id}]: ${row.content}`
    };
  }
  return { role: row.role, content: row.content };
});

// Verify Alice's message is tagged with Alice's ID
const aliceMsg = formatted.find(m => m.content?.includes("2+2"));
if (aliceMsg && aliceMsg.content.startsWith(`[User id:${USER_A}]:`)) {
  console.log("  PASS: Alice's message tagged with her ID");
} else {
  console.log(`  FAIL: Alice's message not correctly tagged. Content: "${aliceMsg?.content?.slice(0, 50)}"`);
}

// Verify Bob's message is tagged with Bob's ID
const bobMsg = formatted.find(m => m.content?.includes("what's my name"));
if (bobMsg && bobMsg.content.startsWith(`[User id:${USER_B}]:`)) {
  console.log("  PASS: Bob's message tagged with his ID");
} else {
  console.log(`  FAIL: Bob's message not correctly tagged. Content: "${bobMsg?.content?.slice(0, 50)}"`);
}

// Verify Carol's message is tagged with Carol's ID
const carolMsg = formatted.find(m => m.content?.includes("hello"));
if (carolMsg && carolMsg.content.startsWith(`[User id:${USER_C}]:`)) {
  console.log("  PASS: Carol's message tagged with her ID");
} else {
  console.log(`  FAIL: Carol's message not correctly tagged. Content: "${carolMsg?.content?.slice(0, 50)}"`);
}

// ── Test 4: Verify assistant messages are NOT tagged ────────────────
console.log("\n── Test 4: Assistant messages are not user-tagged ──");
const assistantMsgs = formatted.filter(r => r.role === "assistant");
let assistantClean = true;
for (const msg of assistantMsgs) {
  if (msg.content.startsWith("[User id:") || msg.content.startsWith("<@")) {
    console.log(`  FAIL: assistant message has user tag: "${msg.content.slice(0, 40)}"`);
    assistantClean = false;
  }
}
if (assistantClean) {
  console.log("  PASS: all assistant messages are clean (no user tags)");
}

// ── Test 5: getConversationHistory distinguishes users (not all same) ──
console.log("\n── Test 5: Different users have different user_ids ──");
const uniqueUsers = new Set(userMessages.map(r => r.user_id));
if (uniqueUsers.size === 3) {
  console.log(`  PASS: ${uniqueUsers.size} distinct users detected in history`);
} else {
  console.log(`  FAIL: expected 3 distinct users, got ${uniqueUsers.size}`);
}

// ── Test 6: Test DM (private) scope ─────────────────────────────────
console.log("\n── Test 6: Private DM scope preserves user_id ──");
const DM_USER = "200000000000000001";
db.addConversationTurn("private", { userId: DM_USER }, "user", "hello bot");
db.addConversationTurn("private", { userId: DM_USER }, "assistant", "hi there!");

const dmHistory = db.getConversationHistory("private", { userId: DM_USER }, 10);
const dmUserMsgs = dmHistory.filter(r => r.role === "user");
const dmHasUserId = dmUserMsgs.every(r => r.user_id === DM_USER);
if (dmHasUserId && dmUserMsgs.length > 0) {
  console.log("  PASS: DM history has correct user_id");
} else {
  console.log(`  FAIL: DM history user_id check failed. Got ${dmUserMsgs.length} user messages`);
}

// ── Test 7: Conversation list groups global channel as one thread ─────
console.log("\n── Test 7: Global channel list is grouped by channel, not user ──");
const globalThreads = db.getConversationUsers({ scope: "global", guildId: TEST_GUILD, channelId: TEST_CHANNEL });
const globalGrouped = globalThreads.length === 1 && globalThreads[0].user_id === null;
if (globalGrouped) {
  console.log("  PASS: global channel has one shared thread entry");
} else {
  console.log(`  FAIL: expected one global thread, got ${JSON.stringify(globalThreads)}`);
}

// ── Test 8: DM memories do not read shared dm/server rows ─────────────
console.log("\n── Test 8: DM memory recall is private to the DM user ──");
const aiMemory = require("../src/ai/memory");
await aiMemory.load();
const privateMem = await aiMemory.add("dm", DM_USER, "private favorite color is green");
const leakedMem = await aiMemory.add("dm", null, "shared dm bucket should not be recalled");
const recalled = aiMemory.recallDm(DM_USER, 10);
const privateRecallOk = recalled.some(m => m.id === privateMem.id) && !recalled.some(m => m.id === leakedMem.id);
if (privateRecallOk) {
  console.log("  PASS: DM recall includes user memory and excludes shared dm bucket");
} else {
  console.log(`  FAIL: DM recall leakage check failed: ${JSON.stringify(recalled)}`);
}

// ── Clean up ────────────────────────────────────────────────────────
db.db.prepare("DELETE FROM ai_conversations WHERE guild_id = ? AND channel_id = ?")
  .run(TEST_GUILD, TEST_CHANNEL);
db.db.prepare("DELETE FROM ai_conversations WHERE user_id = ? AND scope = 'private'")
  .run(DM_USER);
db.db.prepare("DELETE FROM ai_memories WHERE id IN (?, ?)")
  .run(privateMem.id, leakedMem.id);

// ── Summary ─────────────────────────────────────────────────────────
console.log("\n── Summary ──");
const allPassed = attributionShapeOk && userIdsCorrect && assistantClean && uniqueUsers.size === 3 && dmHasUserId && globalGrouped && privateRecallOk;
if (allPassed) {
  console.log("✅ All tests PASSED — user identification works correctly in conversation history.");
} else {
  console.log("❌ Some tests FAILED — check output above.");
}

// Print sample of what the AI would see
console.log("\n── What the AI sees (first 4 messages) ──");
for (const msg of formatted.slice(0, 4)) {
  const preview = msg.content.slice(0, 60);
  console.log(`  [${msg.role}]${msg.name ? ` (${msg.name})` : ""} ${preview}${msg.content.length > 60 ? "..." : ""}`);
}

db.close();
process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error("[test] Fatal error:", err);
  try { db.close(); } catch {}
  process.exit(1);
});
