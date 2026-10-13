# 李灵儿 · 动作实验

[Ryan Lab 入口](https://ryanlab.cn/lilinger/) · [公开 GitHub Pages 内容源](https://ryans-ai-lab.github.io/lilinger-lab/)

首页、`lab.html` 和 `motion.html` 提供同一动作实验。点击“开启摄像头”后，使用浏览器内的 MediaPipe Face Landmarker 与 Pose Landmarker 识别面部和身体，再驱动李灵儿的派生骨骼与实验用表情。动作预览可以在不开启摄像头时查看绑定效果。

追踪程序、WASM 和模型均固定版本并由本站同源提供；摄像头帧只用于当前浏览器推理，不上传、不录制，也不申请麦克风。点击停止、离开页面、预览被移除，或 RyanLab 临时分享失效/被遮罩时停止采集；恢复访问后需再次明确开启。

## 角色与使用边界

动作模型为原有静态角色的本地派生近似绑定，不是恢复出的原供应商骨骼或表情系统。支持头部、躯干、四肢与部分面部表情，不提供独立手指追踪、脚底锁定、布料或头发物理模拟；大幅交叉、深蹲等动作可能穿插。摄像头画面、光线和设备性能会影响识别。真实摄像头跟随和实体手机体验仍待用户实测，浏览器布局和测试图片推理通过不代表这两项已验收。

## 保留入口

- `archive.html`：原数字形象与历史资料导览。
- `cards.html`：原图文卡片实验。
- `tracking-sources.html`：追踪组件、模型来源、完整许可与本地修改说明。

照片版本与出处继续保留，不将文件年份当成拍摄日期。本仓库只保存已筛选公开的衍生资源与网页代码，不包含原运行镜像、内部知识原件、账号信息或采购材料。

RyanLab 域名的口令和临时分享由既有服务端管理；本仓库及 GitHub Pages 上游仍公开，域名门禁不改变公开源文件的范围。既有数字酒厂、文学馆、个人站、城市与 KOL 服务不在本仓库修改。

## 许可

角色与原图片权利归原权利方，网页展示不声明其可自由商用。Three.js MIT 许可完整保留在 `vendor/LICENSE`，Draco 第三方许可见 `vendor/draco/LICENSE`。MediaPipe 的 Apache License 2.0 完整保留在 `vendor/mediapipe/1.1.0/LICENSE`；固定文件来源和 SHA-256 见同目录 `ASSETS.json`，本地修改见 `LOCAL-MODIFICATIONS.md`。
