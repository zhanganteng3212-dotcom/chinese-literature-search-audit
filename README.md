# 中文文献检索审计 Skill

面向中国知网、万方、维普和 SinoMed 的可复现检索、导出审计、题录合并、精确去重和筛选交接工具。

当前版本：`1.1.0-alpha3`。稳定核心仍是人工授权导出后的自动审计与去重；CNKI浏览器辅助采集候选版新增总库与正式文献类型的范围审计，并保留alpha2的Windows兼容性修复。2026-11-15 已完成一次 28 条、两个非零资源类型、四个导出批次的中等规模现场验证。

## 它解决什么问题

普通检索只回答“搜到了什么”；本工具还记录：

- 实际执行了什么检索式；
- 数据库页面显示多少条；
- 每批导出了多少条；
- 本地文件实际解析出多少条；
- 哪些记录被判为精确重复；
- 哪些缺口导致结果只能标为 `partial`；
- 最终记录如何追溯到原始文件。

## 安装

### 项目级安装（推荐）

将整个 `chinese-literature-search-audit` 文件夹复制到：

```text
你的项目/.agents/skills/chinese-literature-search-audit/
```

### Codex 用户级安装

复制到：

```text
%USERPROFILE%\.codex\skills\chinese-literature-search-audit\
```

## 第一次使用

对 Agent 说：

```text
请使用 chinese-literature-search-audit Skill，
为“针灸干预膝骨关节炎”建立中文数据库正式检索项目。
数据库包括中国知网、万方、维普和SinoMed。
先建立研究问题、概念组、检索族和纳排标准。
先复述你的理解，不要立即检索。
```

初始化本地目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_project.ps1 -ProjectPath "D:\research\knee_oa_search"
```

用户完成数据库登录并手工导出后，将原始文件放入：

```text
imports/raw/cnki/
imports/raw/wanfang/
imports/raw/vip/
imports/raw/sinomed/
```

运行审计和去重：

```powershell
python scripts/audit_exports.py --project "D:\research\knee_oa_search"
python scripts/merge_deduplicate.py --project "D:\research\knee_oa_search"
```

## 当前支持边界

| 数据库 | 稳定支持 | 说明 |
|---|---|---|
| CNKI | RefWorks解析与审计；浏览器辅助采集为alpha候选 | 2026-11-15已通过28条中等规模现场验证；验证码仍由用户完成 |
| 万方 | 原始 RefWorks TXT 解析与审计 | 登录和导出由用户完成 |
| 维普 | `PeriodicalPaper` XML 解析与审计 | 可见范围受账号和页面限制 |
| SinoMed | 通用 RefWorks TXT 解析入口 | 必须先做现场格式验证 |

本版本不承诺网页自动点击长期可用，也不绕过登录、验证码、导出上限或机构权限。

## 浏览器辅助自动采集（alpha）

当前公开自动化适配器只覆盖 CNKI。程序启动独立的可见 Chrome 资料目录，用户自行完成学校入口、登录和验证码；遇到导出拼图时程序等待用户完成，不尝试绕过。随后程序可以执行冻结检索式、读取期刊/学位/会议数量、审计总库范围差额、分批导出 RefWorks、断点续传、数量核查和台账回写。

首次使用必须先运行单个检索族的 `--dry-run`，人工比对检索式与分类数量，不能直接批量运行全部检索族。万方、维普和 SinoMed 暂时继续使用人工导出＋自动本地审计。

详细安装、命令、安全边界和停止条件见：[browser-automation.md](references/browser-automation.md)。

## 现场验证证据

`1.1.0-alpha3` 已完成两级现场验证：

| 日期 | 验证规模 | 覆盖内容 | 结果 |
|---|---:|---|---|
| 2026-11-09 | 1 条 | 认证页识别、范围差额审计、单条 RefWorks 导出、零结果处理 | 通过 |
| 2026-11-15 | 28 条 | 期刊 17、学位论文 11；四批导出（10、7、10、1）；尾批、选择清空、零结果跳过、断点、台账与 SHA-256 | 通过 |

中等规模验证中，页面显示数、批次选择数和本地 RefWorks 记录数均为 28；28/28 条有题名，精确题名去重后仍为 28 条。1 条期刊记录在数据库导出中没有摘要和关键词，但其记录类型与题名完整，因此按“源记录字段缺失”记录，不判为漏导。

验证结论仅适用于记录的日期、界面、检索式和权限范围，不代表 CNKI 任意页面变化、任意规模或验证码中断场景均已验证。详细证据见：[alpha3 中等规模现场验证](references/live-validation-alpha3-20261115.md)。

## 目录

- `SKILL.md`：Agent调用入口；
- `references/`：流程、数据库规则、验收口径和文件格式；
- `scripts/`：初始化、审计和精确去重脚本；
- `templates/`：协议、配置和台账模板；
- `examples/demo_project/`：完全虚构的脱敏示例；
- `automation/`：可选的浏览器辅助采集适配层及离线测试；
- `tests/`：稳定核心的本地冒烟测试。

## 开源许可证

本项目的代码、Skill 说明、模板和随包提供的虚构示例采用 [MIT License](LICENSE)。

```text
Copyright (c) 2026 安藤
```

MIT License 允许使用、复制、修改、合并、发布、分发、再许可和销售本项目的软件副本，但必须在软件的全部或实质性部分中保留版权声明和许可证文本。

### 许可证不覆盖的内容

本许可证不授予下列内容的权利：

- 用户自行导入的真实检索题录、全文、附件和研究数据；
- 中国知网、万方、维普、SinoMed 等数据库平台的页面、内容、接口、商标或其他第三方材料；
- 机构账号、访问权限、Cookie、令牌或其他认证信息；
- 另有许可证或权利声明的第三方内容。

用户应自行确认数据库访问、导出、共享和再利用行为符合相应平台规则及适用法律。


