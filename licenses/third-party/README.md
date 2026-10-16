# 补充许可文本来源

这些文件补齐 npm 分发包缺失的许可和内嵌字体、素材声明。`scripts/generate-licenses.mjs` 将适用文本汇入网站声明，构建时无需联网下载许可证。

- `onnxruntime-1.27.0-*`：https://github.com/microsoft/onnxruntime/tree/v1.27.0 的 `LICENSE` 和 `ThirdPartyNotices.txt`；供 `onnxruntime-web` / `onnxruntime-common` 1.27.0 使用。
- `fft.js-4.0.4-LICENSE.txt`：https://github.com/indutny/fft.js/blob/f8be92e1369f684da3e121e4c5b7fbcc8d50f868/README.md 的 LICENSE 小节。
- `guid-typescript-1.0.9-NOTICE.txt`：该版本 npm 元数据声明 ISC、作者 `nicolas`，但未附独立许可文件。保留来源信息，并附 ISC 标准条款；不虚构上游未提供的版权年份或署名行。
- `font-*-LICENSE.txt` / `font-*-LICENCE.txt`：文件名所示版本的 `@vexflow-fonts/*` npm 包中的原始许可，对应 VexFlow 5.0.0 内嵌字体。
- `Salamander-README.txt`：https://github.com/Tonejs/audio/blob/master/salamander/README 。网站使用该来源的 MP3，按其 CC BY 3.0 声明署名。

升级 ONNX Runtime 或 VexFlow 时，重新核对内嵌组件/字体和此处文本；单看包的顶层 `license` 字段不够。
