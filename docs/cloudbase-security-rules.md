# CloudBase 安全规则

这些规则在 CloudBase 控制台逐个集合设置。客户端只读取数据，所有个人数据写入都经过云函数并由 `cloud.getWXContext()` 取得 OpenID。

## 数据库

`user_profiles`、`drink_records`、`wheels`：

```json
{
  "read": "doc._openid == auth.openid",
  "write": false
}
```

客户端查询个人集合时必须带上 `_openid: "{openid}"` 条件；项目中的 repository 已这样处理。

`brands`、`drinks`：

```json
{
  "read": true,
  "write": false
}
```

目录只允许通过管理员云函数或控制台维护。

## 云存储

饮品与头像照片采用“仅创建者可读写”：

```json
{
  "read": "resource.openid == auth.openid || resource.openid == auth.uid",
  "write": "resource.openid == auth.openid || resource.openid == auth.uid"
}
```

## 云函数

`login`、`recordMutation`、`wheelMutation`、`accountMutation` 设置为：

```text
auth != null
```

`seedCatalog` 设置为 `false`，只从控制台调用；同时配置环境变量 `ADMIN_OPENIDS`，值为允许初始化目录的 OpenID，多个值用英文逗号分隔。

规则语法依据 CloudBase 官方的[数据库安全规则](https://docs.cloudbase.net/database/security-rules)、[云存储安全规则](https://docs.cloudbase.net/storage/security-rules)和[云函数安全规则](https://docs.cloudbase.net/cloud-function/security-rules)。
