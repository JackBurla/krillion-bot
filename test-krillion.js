const assert = require('assert');
const {
  assignMedals,
  buildRecap,
  dateForPuzzle,
  parsePost,
  puzzleForDate,
  tallyMedals
} = require('./krillion');

function testPuzzleNumbers() {
  assert.strictEqual(puzzleForDate('2026-07-16'), 1);
  assert.strictEqual(puzzleForDate('2026-10-16'), 93);
  assert.strictEqual(dateForPuzzle(93), '2026-10-16');
  assert.strictEqual(dateForPuzzle(puzzleForDate('2026-11-02')), '2026-11-02');
}

function testParsePost() {
  const post = 'Krillion #93 🦐\n230\n\n🐟🫧🐟🦑🦑🐟🫧\n\nhttps://krillion.io';
  assert.deepStrictEqual(parsePost(post, 93), {
    puzzleNum: 93, score: 230, tiles: '🐟🫧🐟🦑🦑🐟🫧', dateStr: '2026-10-16'
  });
  assert.deepStrictEqual(parsePost('Krillion #93 🦐\n230\n🐟🫧🐟🦑🦑🐟🫧', 93).score, 230);
  assert.strictEqual(parsePost('Krillion #92 🦐\n410\n\n⬛⬛🐟🫧🦑🦑🐟', 93).puzzleNum, 92);
  assert.strictEqual(parsePost('Krillion #93 🦐\n0\n\n⬛⬛⬛⬛⬛⬛⬛', 93).score, 0);

  assert.strictEqual(parsePost('Krillion ⟲ #40 🦐\n300\n\n🐟🫧', 93), null, 'archive');
  assert.strictEqual(parsePost('Krillion ∞ #4 🦐\n300\n\n🐟🫧', 93), null, 'unlimited');
  assert.strictEqual(parsePost('Krillion #94 🦐\n300\n\n🐟🫧', 93), null, 'future puzzle');
  assert.strictEqual(parsePost('Krillion #93 🦐\n701\n\n🐟🫧', 93), null, 'over max');
  assert.strictEqual(parsePost('i got 230 on krillion today', 93), null);
}

function testMedals() {
  const rows = [
    { user_id: 'a', username: 'a', score: 300 },
    { user_id: 'b', username: 'b', score: 300 },
    { user_id: 'c', username: 'c', score: 200 },
    { user_id: 'd', username: 'd', score: 100 }
  ];
  assert.deepStrictEqual(assignMedals(rows).map(m => [m.user_id, m.medal]), [
    ['a', 'gold'], ['b', 'gold'], ['c', 'bronze']
  ]);

  const tally = tallyMedals([
    { user_id: 'a', username: 'a', score: 300, puzzle_num: 1 },
    { user_id: 'b', username: 'b', score: 200, puzzle_num: 1 },
    { user_id: 'a', username: 'a', score: 100, puzzle_num: 2 },
    { user_id: 'b', username: 'b', score: 400, puzzle_num: 2 },
    { user_id: 'b', username: 'b', score: 400, puzzle_num: 3 }
  ]);
  assert.deepStrictEqual(tally, [
    { username: 'b', gold: 2, silver: 1, bronze: 0 },
    { username: 'a', gold: 1, silver: 1, bronze: 0 }
  ]);
}

function testRecap() {
  const dayRows = [
    { user_id: 'a', username: 'jack', score: 230, tiles: '🐟🫧', puzzle_num: 93 },
    { user_id: 'b', username: 'rusty', score: 410, tiles: null, puzzle_num: 93 }
  ];
  const recap = buildRecap({
    puzzleNum: 93,
    dayRows,
    allTimeTop: [dayRows[1], dayRows[0]],
    medalTally: tallyMedals(dayRows)
  });
  assert.strictEqual(recap.title, 'Krillion #93 Recap 🦐');
  assert.strictEqual(recap.footer, 'Oct 16, 2026');
  assert.match(recap.fields[0].value, /^🥇 \*\*rusty\*\* - 410 pts\n🥈 \*\*jack\*\* - 230 pts 🐟🫧/);
  assert.match(recap.fields[0].value, /Average: 320 pts \(2 players\)/);
  assert.match(recap.fields[1].value, /1\. \*\*rusty\*\* - 410 pts on #93/);
  assert.strictEqual(recap.fields[2].value, '**rusty** - 🥇1\n**jack** - 🥈1');

  const empty = buildRecap({ puzzleNum: 94, dayRows: [], allTimeTop: [], medalTally: [] });
  assert.strictEqual(empty.fields[0].value, '_No scores recorded_');
}

testPuzzleNumbers();
testParsePost();
testMedals();
testRecap();
console.log('All Krillion tests passed');
