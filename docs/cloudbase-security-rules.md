# CloudBase 安全规则

这些规则在 CloudBase 控制台逐个集合设置。个人数据的读取和写入都经过云函数，由 `cloud.getWXContext()` 取得 OpenID，再按 `_openid` 过滤和校验。

## 数据库

`user_profiles`、`footprints`、`travel_plans`、`time_capsules`、`share_snapshots`：

```json
{
  "read": false,
  "write": false
}
```

客户端不直接查询这些集合；`footprintMutation`、`travelPlanMutation` 和 `timeCapsuleMutation` 的 `list` 动作会在云函数中按当前 OpenID 查询。

## 云存储

足迹照片与头像采用"仅创建者可读写"：

```json
{
  "read": "resource.openid == auth.openid || resource.openid == auth.uid",
  "write": "resource.openid == auth.openid || resource.openid == auth.uid"
}
```

## 云函数

`login`、`footprintMutation`、`accountMutation`、`aiAssistant`、`travelPlanMutation`、`timeCapsuleMutation`、`shareCode` 设置为：

```text
auth != null
```

`sendCapsuleReminder` 设置为 `false`，只允许定时触发器或云开发控制台调用。

规则语法依据 CloudBase 官方的[数据库安全规则](https://docs.cloudbase.net/database/security-rules)、[云存储安全规则](https://docs.cloudbase.net/storage/security-rules)和[云函数安全规则](https://docs.cloudbase.net/cloud-function/security-rules)。
