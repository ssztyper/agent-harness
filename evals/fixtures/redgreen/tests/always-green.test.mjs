import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/add.mjs';
test('runs', () => assert.equal(typeof add, 'function'));
