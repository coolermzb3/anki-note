# 第三方组件与素材

ScoreTone 自有代码采用 AGPL-3.0-or-later。依赖、模型、字体和采样继续适用各自的许可，不因项目许可证改变而重新授权。版权归各自作者所有。

## 网站运行时

| 组件 | 许可 |
| --- | --- |
| React / React DOM、Tone.js、VexFlow、Pitchy、ONNX Runtime Web | MIT |
| Dexie、ECharts、WebMidi | Apache-2.0 |
| Lucide | ISC；部分图标源自 MIT 许可的 Feather |

`pnpm run licenses` 从当前安装的运行时依赖及其间接依赖收集完整许可与 NOTICE，生成 `public/legal/THIRD_PARTY_LICENSES.txt`。开发启动和生产构建都会执行它；Vite 将结果复制到 `dist/legal/`。清单可能包含被 tree shaking 移除的依赖。

部分 npm 包未附许可文件，补充文本及来源保存在 [licenses/third-party](licenses/third-party)。ONNX Runtime 1.27.0 的 MIT 许可和完整 ThirdPartyNotices 来自其上游版本，包含上游汇总的内嵌组件声明，可能涵盖本次 Web 构建未使用的组件。缺失文本的包采用版本绑定，升级后需重新核对。

## 模型、字体与音频

| 资源 | 来源及许可 | 在本项目中的处理 |
| --- | --- | --- |
| FCPE Conv-only | https://github.com/CNChTu/FCPE ，MIT，Copyright (c) 2023 CN_ChiTu | 从 `torchfcpe==0.0.4` 官方权重导出 ONNX，未训练新权重 |
| SwiftF0 | https://github.com/lars76/swift-f0 ，MIT，Copyright (c) 2025 Lars Nieradzik | 复制 `swift-f0==0.1.2` 的 ONNX，未修改模型内容 |
| Bravura、Academico、Petaluma、Petaluma Script | https://github.com/vexflow/vexflow-fonts ，SIL OFL 1.1 | VexFlow 5.0.0 内嵌字体；未修改，保留字体许可及原始版权声明 |
| Gonville | https://www.chiark.greenend.org.uk/~sgtatham/gonville/ ，Simon Tatham | 使用上游允许无条件使用的输出字体；完整 LICENCE 同时保留其生成器源码条款 |
| Salamander Grand Piano | Alexander Holm；https://github.com/Tonejs/audio/tree/master/salamander ，CC BY 3.0：https://creativecommons.org/licenses/by/3.0/ | 从 Tone.js 托管地址加载 MP3；ScoreTone 未修改采样文件，播放时按音高映射 |

模型许可文本分别放在 [FCPE-LICENSE.txt](public/models/vocal-pitch/FCPE-LICENSE.txt) 与 [SwiftF0-LICENSE.txt](public/models/vocal-pitch/SwiftF0-LICENSE.txt)，随模型和网站声明分发。字体完整许可与 Salamander 上游说明保存在 `licenses/third-party/`，也汇入网站声明。

## 离线分析及开发工具

`analysis/` 与 `analysis/pitch/` 的 Python 依赖不随网站发布，由 uv 根据锁文件安装：NumPy、Pandas、SciPy、PyTorch 主要为 BSD；TorchAudio 为 BSD-2-Clause；Matplotlib 为基于 PSF 的许可；librosa 为 ISC；ONNX 为 Apache-2.0；ONNX Script、TorchCREPE、TorchFCPE、SwiftF0 为 MIT；PESTO 为 LGPLv3。各分发包内附的额外第三方条款仍适用。

Vite、Vitest、React Vite 插件、Ruff、pytest、pre-commit 主要为 MIT，TypeScript 与 fake-indexeddb 为 Apache-2.0；构建工具使用的 caniuse-lite 数据为 CC BY 4.0。这些工具不因被用于构建就全部成为网站运行时组成部分。

若另行打包 Python 环境、实验模型或开发工具，须按该分发内容保留对应许可、NOTICE，并履行适用的源码提供等义务；网站的声明清单不替代这一步。
