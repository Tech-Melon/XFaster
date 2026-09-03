# Tech Melon XFaster — 项目 AI 协作规范（CLAUDE.md）

> 本文件约束在本仓库内工作的 Agent / Claude Code。全局用户规范仍适用；**本文件优先约束本项目特有规则**。

## 1. 项目定位

- **名称**：Tech Melon XFaster  
- **类型**：Chrome Manifest V3 浏览器扩展  
- **当前版本**：以 `manifest.json` 的 `version` 为准（文档同步至 **0.5.32**）  
- **目标**：外站更快打开 X（Twitter）；热壳复用 + 智能打开；可控内存  
- **非目标**：X 客户端替代、24h 挂死 X、iframe 嵌 X、上传浏览数据  

## 2. 产品默认（改前须确认）

| 项 | 默认 |
|----|------|
| 档位 | `balanced`（有链接暖 1 壳；不悬停狂预热） |
| 打开 | 优先复用 X 标签；无则 **只开目标 URL**（禁止 home+推文双开） |
| TTL | 20 分钟（1–60，最大 60） |
| L3 | 全局最多 1 个 |
| 调试日志 | 关 |
| 必需 host | **仅 X 相关域名** |
| 全网 host | **optional**；弹窗用户一键授权 |
| X 站内 | **禁止**外站拦截逻辑（侧栏必须可点） |

## 3. 目录

```text
manifest.json
background/   service-worker, open-router, warm-manager, nav-capture, spa-nav, owned-tabs
content/      window-open-hook-main, link-observer, x-shell-*
shared/       constants, settings, url-utils, permissions, debug
ui/           popup, options
docs/         使用说明、设计说明、变更记录、文档规范
```

- content 外站脚本多为 **IIFE**；background 为 **ES module**  
- 扩展目录保持可 Load unpacked；禁止把无关 `.py` 放进加载根目录  

## 4. 核心纪律

1. **KISS**：只做打开加速与可控预热  
2. **X 站内永不拦截**用户导航（`window-open-hook` / `link-observer` 在 X host 直接退出）  
3. **打开推文禁止先 `ensureWarmTab(home)`**  
4. SPA 须真成功；假成功必须整页回退  
5. 创建 X 标签用全局锁 `withXTabCreateLock`  
6. TTL 用绝对时间戳 + alarms  
7. 块注释中 **禁止** 写出提前结束的 `*/`（例如错误注释 `*://*/*`）  
8. 改权限 / 档位 / 消息协议 → 同步 README、docs、商店 DOC  

## 5. 文档

- `README.md`：入口  
- `docs/使用说明.md`：用户 FAQ  
- `docs/设计说明.md`：架构  
- `docs/变更记录.md`：版本  
- `docs/文档规范.md`：写法  
- 商店材料可在外部 `DOC\`（上架文案、隐私、审核指引）  

更新功能后至少改：README 版本摘要 + 变更记录；权限变更必改使用说明与商店权限话术。  

## 6. 自检清单

- [ ] 无 X 标签点推文 → 仅 1 标签  
- [ ] 全站授权 + 刷新外站 → 尽量无冷标签闪屏  
- [ ] x.com 侧栏可点  
- [ ] 重载扩展后刷新页面  
- [ ] 弹窗授权可点、不卡「加载中」  
- [ ] `node --check` 关键模块无语法错误  
- [ ] 热壳闲置数分钟后点另一条推文 → 打开新链接，不是上一帖  

## 7. 禁止

- 默认把 `http://*/*` 写回 **必需** `host_permissions`（审核风险）  
- 在 X 站内 `preventDefault` 指向 x.com 的点击  
- 在文档/回复中泄露用户点名要求保密的站点 URL  
