# 微信虚拟支付部署说明

本项目已经实现拾光+ 31 天卡、372 天卡与拾光 Pro 年卡的道具直购链路，以及会员到期提醒（一次性订阅消息）。密钥没有写入代码，部署后必须完成本页配置才能发起真实支付。

## 0. 一键部署（推荐）

填写 `.env.payment`（复制 `.env.payment.example`，文件已被 Git 忽略）后执行：

```bash
# 手机真机与正式发布
npm run deploy:payment -- --target=production

# 仅开发者工具内沙箱调试
npm run deploy:payment -- --target=sandbox
```

脚本会自动完成：创建三个集合与索引、部署 `accountMutation` / `paymentMutation` / `paymentNotify` / `sendMembershipReminder` 并写入环境变量、注册到期提醒定时器，收敛云函数调用权限，并创建 `/payment-notify` HTTP 网关路由。凭证优先用 `.env.payment` 里的 CAM 密钥，否则复用 `cloudbase login` 的本机授权登录态。小程序后台消息推送绑定与虚拟支付商品发布仍需手动完成（脚本结束会打印清单）。可以先用 `npm run deploy:payment -- --target=production --dry-run` 预览现网部署计划。

## 1. 微信后台商品

在“小程序后台 → 支付与交易 → 虚拟支付 → 道具管理”创建并发布：

| 应用内商品 | 默认道具 ID | 价格 |
|---|---|---:|
| 拾光+ 31 天 | `plus_31d_v1` | 600 分 |
| 拾光+ 372 天 | `plus_372d_v1` | 4900 分 |
| 拾光 Pro 年卡 | `pro_372d_v1` | 9900 分 |

如果后台使用了不同的道具 ID，通过云函数环境变量映射，不要修改客户端价格。

## 2. 数据库

创建 `payment_orders`、`user_entitlements` 与 `reminder_subscriptions` 三个集合，并设置为仅管理员读写（`npm run deploy:payment` 会自动创建）。

索引：

- `payment_orders`: `_openid` 升序、`createdAt` 降序。
- `payment_orders`: `_openid` 升序、`hiddenAt` 升序、`createdAt` 降序（购买记录分页）。
- `payment_orders`: `_openid` 升序、`status` 升序、`createdAt` 降序（已购状态判断）。
- `payment_orders`: `outTradeNo` 升序，唯一索引。
- `payment_orders`: `wxOrderId` 升序，普通索引。不要建唯一索引：文档数据库会把缺失字段都视为 null，第二笔待支付订单就会插入失败；发货幂等由事务内的状态检查保证。
- `user_entitlements`: `_openid` 升序、`expiresAt` 降序。
- `user_entitlements`: `sourceOrderId` 升序，唯一索引。
- `reminder_subscriptions`: `_openid` 升序、`templateId` 升序。

## 3. paymentMutation

上传并部署 `cloudfunctions/paymentMutation`，选择云端安装依赖，并配置：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `VIRTUAL_PAY_OFFER_ID` | 是 | 虚拟支付 OfferID |
| `VIRTUAL_PAY_APP_KEY_PRODUCTION` | 现网部署必填 | 现网 AppKey，仅由 `--target=production` 读取 |
| `VIRTUAL_PAY_APP_KEY_SANDBOX` | 沙箱部署必填 | 沙箱 AppKey，仅由 `--target=sandbox` 读取 |
| `WECHAT_APP_ID` | 是 | 小程序 AppID，用于查单兜底 |
| `WECHAT_APP_SECRET` | 是 | 小程序 AppSecret，用于查单兜底 |
| `VIRTUAL_PAY_PRODUCT_PLUS_31D` | 否 | 31 天卡后台道具 ID，默认 `plus_31d_v1` |
| `VIRTUAL_PAY_PRODUCT_PLUS_372D` | 否 | 372 天卡后台道具 ID，默认 `plus_372d_v1` |
| `VIRTUAL_PAY_PRODUCT_PRO_372D` | 否 | Pro 年卡后台道具 ID，默认 `pro_372d_v1` |
| `MEMBERSHIP_TEMPLATE_ID` | 否 | 会员到期提醒订阅模板 ID，与 `sendMembershipReminder` 一致；不配则提醒功能关闭 |

云函数权限设为 `auth != null`。AppKey 和 AppSecret 只能存在于云函数环境变量中，不要提交到 Git，也不要返回给客户端。

旧版 `.env.payment` 的 `VIRTUAL_PAY_APP_KEY` + `VIRTUAL_PAY_ENV` 仍可迁移使用，但部署脚本只会在旧环境值与 `--target` 完全一致时接受；建议分别改为上表的现网/沙箱专用变量。

沙箱仅适合开发者工具内调试。手机真机预览或体验版使用沙箱会报 `PAYMENT_ILLEGAL_IN_SANDBOX`。部署脚本会根据 `--target` 自动写入 `VIRTUAL_PAY_ENV` 并选择对应 AppKey，不再允许手工拼错环境与密钥。现网真机购买会产生真实交易；iOS 真机还需开通苹果 IAP 支付。

`paymentMutation` 负责：

- 根据服务端商品白名单创建唯一订单。
- 通过微信官方 `sns/jscode2session` 接口获得本次支付签名所需的 session key。
- 生成 `signData`、`paySig` 和 `signature`。
- 查询用户自己的购买记录，附带到期提醒的剩余授权条数。
- `saveReminderSubscription`：记录或删除会员到期提醒的一次性订阅授权（写入 `reminder_subscriptions`，同一用户最多保留 3 条未使用授权）。
- 用户支付后轮询订单时调用官方 `query_order` 查单，作为通知丢失时的兜底发货路径。

## 4. paymentNotify

上传并部署 `cloudfunctions/paymentNotify`，配置环境变量：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `PAYMENT_MESSAGE_TOKEN` | 是 | 自定义随机 Token，必须与 MP 消息推送配置一致 |

该函数按事件云函数部署（`cloudbaserc.json` 中为 `type: "Event"`），部署脚本会创建 `/payment-notify` HTTP 网关路由；不要按需要 `scf_bootstrap` 的独立 HTTP Web 服务部署。云函数调用权限设为 `false`，仅允许 HTTP 入口。代码会使用 Token、timestamp、nonce 校验微信消息签名。

在“小程序后台 → 开发与服务 → 开发管理 → 消息推送”中：

1. URL 填写 `paymentNotify` 的 HTTPS 访问地址。
2. Token 填写与 `PAYMENT_MESSAGE_TOKEN` 相同的值。
3. 消息加密方式选择明文模式。当前实现不接收 AES 加密消息。
4. 保存时微信会发送 GET 验证，函数会在验签后原样返回 `echostr`。

函数处理：

- `xpay_goods_deliver_notify`：校验用户、商品、订单，按 `wxOrderId` 幂等发放时长权益。
- `xpay_refund_notify`：标记退款、撤销未使用权益，并保留订单与权益审计记录。

## 5. sendMembershipReminder（会员到期提醒）

会员是一次性购买、不会自动续费，续购闭环依赖到期提醒。`cloudbaserc.json` 已注册每天 10:00 的定时触发器。

授权链路：会员页打开「到期提醒」→ `wx.requestSubscribeMessage` 授权一次性订阅 → `paymentMutation.saveReminderSubscription` 把授权写入 `reminder_subscriptions` → 定时函数在临期窗口内消耗一条授权发送一条提醒。

在「小程序后台 → 订阅消息 → 我的模板」申领一个含「会员名称(thing)、到期时间(time)、提示(thing)」三类字段的模板，然后：

1. 把模板 ID 填入 `.env.payment` 的 `MEMBERSHIP_TEMPLATE_ID`，重跑 `npm run deploy:payment`。客户端会从 `paymentMutation` 读取模板 ID，无需在小程序代码中重复填写。
2. 模板字段名如与默认 `thing1/time2/thing3` 不同，通过 `MEMBERSHIP_TITLE_FIELD` / `MEMBERSHIP_DATE_FIELD` / `MEMBERSHIP_NOTE_FIELD` 配置。
3. 时间字段必须是中文日期（如 `2026年10月3日`），函数已按此格式发送，改成其他格式会报 47003。

环境变量：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `MEMBERSHIP_TEMPLATE_ID` | 是 | 与 paymentMutation 使用同一环境变量；客户端会从服务端读取，不配则函数直接跳过 |
| `MEMBERSHIP_REMIND_DAYS` | 否 | 到期前多少天内提醒，默认 3 天 |
| `MEMBERSHIP_TITLE_FIELD` / `MEMBERSHIP_DATE_FIELD` / `MEMBERSHIP_NOTE_FIELD` | 否 | 模板字段映射，默认 `thing1` / `time2` / `thing3` |
| `MEMBERSHIP_PAGE` | 否 | 点击提醒跳转路径，默认 `pages/membership/index` |
| `MEMBERSHIP_MINIPROGRAM_STATE` | 否 | `developer` / `trial`，仅调试用 |

行为要点：

- 同一到期日只发一条：多授权或跨天重跑不会重复打扰；同账号最多保留 3 条待用授权。
- 未开通或过期超过一天的授权不消耗，留到用户下次开通后再提醒。
- 发送失败 12 小时后重试，最多 3 次；客户端关闭开关会删除未使用的授权。

## 6. 发版前真机验收

- [ ] iOS 已配置小程序简称并开通 iOS 支付。
- [ ] 三个道具均已发布，价格与代码白名单一致。
- [ ] 创建 ¥6 真单，客户端能拉起 `wx.requestVirtualPayment`。
- [ ] 支付成功后收到通知，`payment_orders.status` 变为 `fulfilled`。
- [ ] 购买记录每次加载 10 条；左滑“隐藏”只写入 `hiddenAt`，不会删除订单或影响退款、查单与权益核对。
- [ ] “同步支付结果”可重新查询待确认订单，并刷新当前会员权益。
- [ ] `user_profiles.growth.plusUntil` 增加 31 天。
- [ ] 购买 Pro 年卡后 `proUntil` 增加 372 天，且 `plusUntil` 至少覆盖同一到期日。
- [ ] 同一通知重复发送不会重复增加时长。
- [ ] 购买第二张卡从当前到期日顺延，不覆盖剩余时间。
- [ ] 临时关闭消息推送后，客户端查单能补发权益。
- [ ] Android 退款与 iOS App Store 退款各验证一次。
- [ ] 支付页、购买记录页、后台订单金额一致。
- [ ] 到期提醒：会员页开启「到期提醒」后 `reminder_subscriptions` 出现未使用授权；把 `MEMBERSHIP_MINIPROGRAM_STATE` 设为 `trial` 并把 `MEMBERSHIP_REMIND_DAYS` 临时调大，能在体验版收到提醒，同一到期日只收到一条。
- [ ] 会员到期后购买页出现「会员已到期」续购卡，剩余天数与后台 `plusUntil`/`proUntil` 一致。

本地开发环境不会伪造支付成功或免费发放正式权益；未连接已配置的云环境时，购买按钮会给出明确错误。
