import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlueBubblesWebhook, senderAllowed } from './bluebubbles.js';

test('empty allowlist answers nobody; * answers everyone', () => {
  assert.equal(senderAllowed('+15550100000', []), false);
  assert.equal(senderAllowed('+15550100000', ['*']), true);
});

test('phones match across formatting and the US country code', () => {
  assert.equal(senderAllowed('+15550100000', ['(555) 010-0000']), true);
  assert.equal(senderAllowed('5550100000', ['+1 555 010 0000']), true);
  assert.equal(senderAllowed('+15550100001', ['+15550100000']), false);
});

test('a foreign number never suffix-matches a 10-digit entry', () => {
  assert.equal(senderAllowed('+525550100000', ['5550100000']), false);
  assert.equal(senderAllowed('+445550100000', ['5550100000']), false);
  assert.equal(senderAllowed('+15550100000', ['0100000']), false);
});

test('emails match case-insensitively and exactly', () => {
  assert.equal(senderAllowed('Me@Example.com', ['me@example.com']), true);
  assert.equal(senderAllowed('notme@example.com', ['me@example.com']), false);
});

const evt = (address: string, chatGuid = `any;-;${address}`) =>
  ({ type: 'new-message', data: { handle: { address }, text: 'hi', guid: 'g1', chats: [{ guid: chatGuid }] } });
const bb = { url: 'http://unused', password: 'x' };

test('webhook from a sender off the allowlist is dropped', async () => {
  assert.equal(await parseBlueBubblesWebhook(evt('+15550109999'), bb, ['+15550100000']), null);
  assert.equal((await parseBlueBubblesWebhook(evt('+15550100000'), bb, ['+15550100000']))?.from, '+15550100000');
});

test('group chat messages are dropped even from an allowed sender', async () => {
  assert.equal(await parseBlueBubblesWebhook(evt('+15550100000', 'iMessage;+;chat42'), bb, ['*']), null);
});
