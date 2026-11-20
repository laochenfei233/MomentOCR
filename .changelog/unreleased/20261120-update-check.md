---
type: fixed
breaking: false
audience: user
commits: 4835a2c
---
「检查更新」此前始终失败：仓库地址写错导致拉不到发布信息，版本号又是写死的，永远误报有更新。现在会读取本机真实版本并与 GitHub 最新发布正确比较，直连失败时自动走镜像。
