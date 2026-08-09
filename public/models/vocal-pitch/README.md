# 清唱增强分析模型

这两个 ONNX 文件只在用户同意增强分析后下载并缓存，不属于 PWA 首次加载资源。

- `fcpe-v1.onnx`: 从 `torchfcpe==0.0.4` 的官方 FCPE Conv-only 权重导出，SHA-256 为 `d425a36c66d751558574f230dd6caff682d2b1bdccf57315e3c907677e8b1d1c`。
- `swift-f0-v1.onnx`: 来自 `swift-f0==0.1.2`，SHA-256 为 `fa91bb45512b90339cf4b00a599ba8fe3a253c46419fcfe6b46df77a8a8336a5`。

两者均使用各自项目的 MIT 许可。重新生成时运行：

```powershell
uv run --project analysis\pitch python analysis\pitch\export_browser_models.py
```

生成后必须先跑固定音频对比和浏览器模型测试；只有结果仍符合当前基线，才更新代码中的模型版本与校验值。
