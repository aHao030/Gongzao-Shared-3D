# 商家工艺文件白名单

此目录不附带可驱动设备的通用配置。请由商家从已验证的 PrusaSlicer 设备、材料和打印配置导出完整 INI，再放入自己的私有配置目录。

计算 SHA-256 后，在 `worker.config.json` 登记：

```json
{
  "profiles": {
    "farm-a-pla-standard": {
      "path": "profiles/farm-a-pla-standard.ini",
      "revision": 1,
      "sha256": "填写实际的64位SHA256值",
      "verified": false
    }
  }
}
```

商家工作台的 `localProfileId`、版本号、配置校验值须与此对应。更新 INI 后递增版本并重新校准。`verified` 只记录本地声明，不开放真实派单。

禁止配置 `post_process` 脚本。客户上传的 3MF 只提取网格，不读取其中的切片参数、附带 G-code 或打印机配置。切片器独立运行，永远不接受来自网页的任意命令行参数。
