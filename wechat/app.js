App({
  globalData: {
    // 后端 API 地址 - 开发阶段用局域网IP，上线后改为 HTTPS 域名
    baseUrl: 'http://192.168.31.60:3002',
  },
  onLaunch() {
    console.log('[App] 水泵BOM语音助手启动');
  }
});
