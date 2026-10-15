const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.HEFT_SOURCE || path.join(__dirname, '../docs/script_new.js'), 'utf8');

function harness(input) {
  const area = { value: input };
  const alerts = [];
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById(id) { return id === 'heft-dag-input' ? area : null; } },
    alert(message) { alerts.push(message); },
  });
  vm.runInContext(source, context);
  const dispatched = [];
  context.startHeftSimulation = config => dispatched.push(config);
  return { area, alerts, context, dispatched };
}
const plain = value => JSON.parse(JSON.stringify(value));

for (const [label, input, message] of [
  ['self-cycle', 'A 1 A', /cycle/],
  ['two-node cycle', 'A 1 B\nB 1 A', /cycle/],
  ['disconnected cycle', 'Root 1\nA 1 B\nB 1 A', /cycle/],
  ['unknown parent', 'A 1 Missing', /Unknown parent/],
  ['duplicate ID', 'A 1\nA 2', /Duplicate/],
]) {
  test(`rejects ${label} without scheduling`, () => {
    const h = harness(input);
    assert.equal(h.context.parseHeftDagInput(), null);
    assert.equal(h.alerts.length, 1);
    assert.match(h.alerts[0], message);
    h.alerts.length = 0;
    h.context.runHeftCustom();
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.alerts.length, 1);
  });
}

for (const [label, input, expected] of [
  ['forward reference', 'B 2 A\nA 1', [{id:'B',weight:2,parents:['A']},{id:'A',weight:1,parents:[]}]],
  ['disconnected roots', 'A 1\nB 2', [{id:'A',weight:1,parents:[]},{id:'B',weight:2,parents:[]}]],
  ['repeated parent', 'A 1\nB 2 A,A', [{id:'A',weight:1,parents:[]},{id:'B',weight:2,parents:['A','A']}]],
  ['legacy skipped rows', 'bad\nA 1\ninvalid 0\nB 2 A', [{id:'A',weight:1,parents:[]},{id:'B',weight:2,parents:['A']}]],
]) {
  test(`preserves ${label} and finite dependency-respecting schedule`, () => {
    const h = harness(input);
    const config = h.context.parseHeftDagInput();
    assert.deepEqual(plain(config.tasks), expected);
    assert.deepEqual(plain(config.processors), [{id:'VM1',speed:1},{id:'VM2',speed:0.6},{id:'VM3',speed:1.2}]);
    assert.equal(config.comm, 2);
    const result = h.context.computeHeftSchedule(config);
    assert.equal(result.schedule.length, expected.length);
    const schedule = new Map(result.schedule.map(entry => [entry.taskId, entry]));
    for (const task of config.tasks) {
      const entry = schedule.get(task.id);
      assert.ok(Number.isFinite(entry.start) && Number.isFinite(entry.end));
      for (const parentId of task.parents) {
        const parent = schedule.get(parentId);
        assert.ok(entry.start >= parent.end + (entry.processorId === parent.processorId ? 0 : config.comm));
      }
    }
    h.context.runHeftCustom();
    assert.equal(h.dispatched.length, 1);
    assert.equal(h.alerts.length, 0);
  });
}

test('built-in-shaped graph keeps its exact schedule', () => {
  const h = harness('T1 10\nT2 18 T1\nT3 12 T1\nT4 14 T2,T3\nT5 10 T3\nT6 8 T4,T5');
  const expected = vm.runInContext('computeHeftSchedule(HEFT_EXAMPLE)', h.context);
  const actual = h.context.computeHeftSchedule(h.context.parseHeftDagInput());
  assert.deepEqual(plain(actual), plain(expected));
});

test('recovers on valid input after rejection', () => {
  const h = harness('A 1 A');
  h.context.runHeftCustom();
  h.area.value = 'A 1';
  h.context.runHeftCustom();
  assert.equal(h.alerts.length, 1);
  assert.equal(h.dispatched.length, 1);
});

test('blank input retains existing rejection', () => {
  const h = harness(' \n ');
  assert.equal(h.context.parseHeftDagInput(), null);
  assert.equal(h.alerts.length, 1);
});
