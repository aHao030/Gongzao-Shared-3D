import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeReturnPath } from '../dist/trade-return.js';

test('咨询登录后保留该模型、店铺、规格或原会话', () => {
  assert.equal(tradeReturnPath('/messages?qty=2&modelId=m-20&material=PETG'), '/messages?modelId=m-20&qty=2&material=PETG');
  assert.equal(tradeReturnPath('/merchant/messages/?thread=t_123'), '/merchant/messages?thread=t_123');
});

test('返回入口仅允许站内消息页以及有效显示参数', () => {
  for (const path of ['//example.com/messages', '/admin', '/messages#outside', '/merchant/../messages', 'https://example.com/messages']) assert.equal(tradeReturnPath(path), null);
  assert.equal(tradeReturnPath('/messages?modelId=one&modelId=two&qty=99&next=outside&unit=inch'), '/messages?unit=inch');
});
