function wxTransport(request) {
  return new Promise((resolve, reject) => {
    wx.request({ url: request.url, method: request.method, header: request.headers, data: request.data,
      timeout: request.timeout, dataType: 'json', success: response => resolve({ statusCode: response.statusCode, data: response.data }),
      fail: () => reject(new Error('WX_REQUEST_FAILED')) });
  });
}
module.exports = { wxTransport };
