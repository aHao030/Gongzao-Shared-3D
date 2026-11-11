// Deliberate integration point. The current hosted backend accepts Sites identity only.
// Implement a server-verified WeChat login/exchange flow before enabling remote mode.
// wx.login code exchange and all AppSecret operations belong on your trusted server.
// Never copy a browser's ChatGPT session cookie or embed a long-lived token.
async function getAccessToken() { return null; }
module.exports = { getAccessToken };
