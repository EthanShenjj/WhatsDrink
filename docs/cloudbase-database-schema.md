# 云开发文档型数据库结构

目标环境：`ethan-workspace-d7f7k5ma0befbf77`。项目使用文档型数据库；集合中的字段由云函数写入，不需要预先创建固定列。需要先创建下列五个集合，再设置索引和[访问规则](cloudbase-security-rules.md)。所有用户数据文档都以 `_openid` 标识归属，`_id` 是云数据库文档 ID；客户端看到的 `userId`、`id` 分别由云函数从这两个字段转换得到，不作为额外列写入。

| 集合 | 云端主要字段 | 使用位置 |
| --- | --- | --- |
| `user_profiles` | `_openid`, `nickname`, `avatarUrl`, `createdAt`, `updatedAt` | `login`、`accountMutation` |
| `footprints` | `_openid`, `status`, `poiName`, `address?`, `lat?`, `lng?`, `country?`, `province?`, `city?`, `district?`, `visitDate?`, `photos`, `mood?`, `category?`, `tags`, `note?`, `markerStyle?`, `visibility`, `source`, `placeId?`, `wishId?`, `isImportant`, `wishlistCreatedAt?`, `fulfilledAt?`, `fulfilledVisitId?`, `convertedFromWishlist?`, `clientRequestId`, `createdAt`, `updatedAt` | `footprintMutation`；旅行计划和时间胶囊也会校验足迹引用 |
| `travel_plans` | `_openid`, `title`, `city`, `days`, `preferences`, `poiIds`, `dayPlans`, `status`, `createdAt`, `updatedAt` | `travelPlanMutation` |
| `time_capsules` | `_openid`, `title`, `footprintId?`, `text?`, `photos`, `unlockDate`, `status`, `subscriptionId?`, `createdAt`, `updatedAt`, `unlockedAt?`, `reminderAttemptedAt?`, `reminderSentAt?`, `reminderFailedAt?` | `timeCapsuleMutation`、`sendCapsuleReminder` |
| `share_snapshots` | 当前仅预留；客户端分享快照保存在本地 | `accountMutation` 删除账号时会清理此集合 |

`?` 表示可选字段。`status` 在 `footprints` 中为 `visited`、`wishlist` 或 `fulfilled`；在 `travel_plans` 中为 `planning`、`ongoing` 或 `completed`；在 `time_capsules` 中为 `locked` 或 `unlocked`。`visitDate`、`unlockDate` 使用 `YYYY-MM-DD` 字符串；时间戳字段使用毫秒数。

## 索引

先核对云端现有索引，再补齐缺少的索引。复合索引的字段顺序与排序方向应如下：

| 集合 | 索引字段 | 唯一 | 对应查询 |
| --- | --- | --- | --- |
| `user_profiles` | `_openid` 升序 | 否（沿用现有索引） | 登录和账号资料查询 |
| `footprints` | `_openid` 升序，`updatedAt` 降序 | 否 | 按用户列出足迹 |
| `footprints` | `_openid` 升序，`clientRequestId` 升序 | 建议唯一 | 创建足迹的幂等检查 |
| `travel_plans` | `_openid` 升序，`updatedAt` 降序 | 否 | 按用户列出旅行计划 |
| `time_capsules` | `_openid` 升序，`unlockDate` 升序 | 否 | 按用户列出时间胶囊 |
| `time_capsules` | `status` 升序，`unlockDate` 升序 | 否 | 定时查找待解锁胶囊 |
| `share_snapshots` | `_openid` 升序 | 否 | 删除账号时清理数据 |

`_id` 使用集合自带索引。`footprints` 的 `(_openid, clientRequestId)` 已设置为唯一索引，用于保证同一用户创建请求的幂等性。`user_profiles` 沿用环境中已有的 `_openid_1` 普通索引；登录云函数仍会按 `_openid` 查询第一条资料。现有数据不应因结构对齐而删除。

## 当前核对状态

2026-09-24 已通过 CloudBase CLI 3.8.4 对齐环境 `ethan-workspace-d7f7k5ma0befbf77`（文档数据库实例 `tnt-nz52fgtjs`）：

- 保留原有 `brands`、`drink_records`、`drinks`、`wheels` 和系统集合及其数据。
- 沿用原有空集合 `user_profiles` 及 `_openid_1` 索引。
- 新建 `footprints`、`travel_plans`、`time_capsules`、`share_snapshots`。
- 已创建本节表格所列索引，并通过 `listIndexes` 逐项复查。
- 五个业务集合均已关闭客户端直接读写：新建集合使用 `ADMINONLY`，`user_profiles` 安全规则为 `read: false`、`write: false`。
