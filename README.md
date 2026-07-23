# WhatsDrink

WhatsDrink 是一个原生微信小程序，用来记录每天喝的咖啡和奶茶，并通过 Choice One 转盘解决“今天喝什么”的选择困难。

## 已实现

- 今日饮品时间线、已知热量汇总、记录新增/编辑/删除
- 咖啡与奶茶品牌/单品选择、自定义饮品、规格、甜度、价格、评分、备注和照片
- 月历回看及按日汇总
- 多个命名转盘、品牌库与自定义品牌候选、等概率动画抽取、结果带入记录草稿
- 微信身份初始化、可选头像昵称、清除记录、级联注销
- 个人页一周饮品章
- 无云环境时自动使用本地存储，网络保存失败时保留草稿
- 12 个常见品牌和 36 个代表单品的版本化目录

热量均显示为参考值，可由用户修改；本项目不提供医疗、营养或减脂建议。品牌名称仅用于饮品记录，不包含品牌 Logo。

## 本地体验

1. 安装依赖：

   ```bash
   npm install
   ```

2. 在微信开发者工具中导入仓库根目录。
3. 选择“游客 AppID”即可使用本地存储体验；首次打开后在“工具 → 构建 npm”生成 `miniprogram_npm`。
4. 运行检查：

   ```bash
   npm run check
   ```

## 接入真实小程序与云开发

1. 将 [project.config.json](project.config.json) 的 `appid` 换为真实 AppID。
2. 创建云开发环境，把环境 ID 写入 `miniprogram/services/config.ts` 的 `CLOUD_ENV_ID`。
3. 创建集合：`user_profiles`、`drink_records`、`wheels`、`brands`、`drinks`。
4. 在开发者工具中分别上传并部署 `cloudfunctions/` 下五个云函数，选择“云端安装依赖”。
5. 按 [CloudBase 安全规则](docs/cloudbase-security-rules.md) 配置数据库、云存储和云函数权限。
6. 给 `seedCatalog` 配置 `ADMIN_OPENIDS` 后，从控制台调用一次以初始化公开目录。
7. 在小程序管理后台填写用户隐私保护指引，说明头像昵称、相册/相机和云存储用途，再提交审核。

## 目录

```text
miniprogram/       小程序页面、领域逻辑、数据和本地/云端 repository
cloudfunctions/    登录、记录、转盘、账号与目录初始化云函数
tests/             日期日历、热量汇总和转盘确定性测试
docs/              云开发安全规则与交付说明
```
