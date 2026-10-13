# 李灵儿 · 与你同步

Ryan Lab 的浏览器摄像头动作实验。Three.js 显示李灵儿角色，MediaPipe Tasks Vision 1.1.0 在访问者设备上识别面部和身体，摄像头画面不上传、不录制。

2026-10-13 修复版：连续视频帧采样、Canvas 快照、CPU 兼容回退、上半身局部驱动；25 骨骼、11 个表情目标，眼睑与肩肘权重改进，9 个刚性部件随对应骨骼附着。

入口为 index.html，motion.html 与 lab.html 相同。archive.html 和 cards.html 保存历史实验。组件来源与许可见 tracking-sources.html。

连续公开样本重放与实际网格运动已验证；真人摄像头和实体 iPhone Safari 复测尚未通过验收。手指静态，嘴部近似形变，裙装与极端动作仍有局限。

正式入口：https://ryanlab.cn/lilinger/ 。该域名的访问门禁与这个公开静态上游分开管理。
