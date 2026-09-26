# 微信虚拟支付部署说明

本项目已经实现拾光+ 31 天卡与 372 天卡的道具直购链路。密钥没有写入代码，部署后必须完成本页配置才能发起真实支付。

## 1. 微信后台商品

在“小程序后台 → 支付与交易 → 虚拟支付 → 道具管理”创建并发布：

| 应用内商品 | 默认道具 ID | 价格 |
|---|---|---:|
| 拾光+ 31 天 | `plus_31d_v1` | 600 分 |
| 拾光+ 372 天 | `plus_372d_v1` | 4900 分 |

如果后台使用了不同的道具 ID，通过云函数环境变量映射，不要修改客户端价格。

## 2. 数据库

创建 `payment_orders` 和 `user_entitlements` 两个集合，并设置为仅管理员读写。

索引：

- `payment_orders`: `_openid` 升序、`createdAt` 降序。
- `payment_orders`: `outTradeNo` 升序，唯一索引。
- `payment_orders`: `wxOrderId` 升序，唯一索引；允许未填字段。
- `user_entitlements`: `_openid` 升序、`expiresAt` 降序。
- `user_entitlements`: `sourceOrderId` 升序，唯一索引。

## 3. paymentMutation

上传并部署 `cloudfunctions/paymentMutation`，选择云端安装依赖，并配置：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `VIRTUAL_PAY_OFFER_ID` | 是 | 虚拟支付 OfferID |
| `VIRTUAL_PAY_APP_KEY` | 是 | 虚拟支付现网 AppKey |
| `WECHAT_APP_ID` | 是 | 小程序 AppID，用于查单兜底 |
| `WECHAT_APP_SECRET` | 是 | 小程序 AppSecret，用于查单兜底 |
| `VIRTUAL_PAY_PRODUCT_PLUS_31D` | 否 | 31 天卡后台道具 ID，默认 `plus_31d_v1` |
| `VIRTUAL_PAY_PRODUCT_PLUS_372D` | 否 | 372 天卡后台道具 ID，默认 `plus_372d_v1` |

云函数权限设为 `auth != null`。AppKey 和 AppSecret 只能存在于云函数环境变量中，不要提交到 Git，也不要返回给客户端。

`paymentMutation` 负责：

- 根据服务端商品白名单创建唯一订单。
- 通过 `auth.code2Session` 获得本次支付签名所需的 session key。
- 生成 `signData`、`paySig` 和 `signature`。
- 查询用户自己的购买记录。
- 用户支付后轮询订单时调用官方 `query_order` 查单，作为通知丢失时的兜底发货路径。

## 4. paymentNotify

上传并部署 `cloudfunctions/paymentNotify`，配置环境变量：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `PAYMENT_MESSAGE_TOKEN` | 是 | 自定义随机 Token，必须与 MP 消息推送配置一致 |

为该云函数开通 HTTP 访问，云函数调用权限设为 `false`，仅允许 HTTP 入口。代码会使用 Token、timestamp、nonce 校验微信消息签名。

在“小程序后台 → 开发与服务 → 开发管理 → 消息推送”中：

1. URL 填写 `paymentNotify` 的 HTTPS 访问地址。
2. Token 填写与 `PAYMENT_MESSAGE_TOKEN` 相同的值。
3. 消息加密方式选择明文模式。当前实现不接收 AES 加密消息。
4. 保存时微信会发送 GET 验证，函数会在验签后原样返回 `echostr`。

函数处理：

- `xpay_goods_deliver_notify`：校验用户、商品、订单，按 `wxOrderId` 幂等发放时长权益。
- `xpay_refund_notify`：标记退款、撤销未使用权益，并保留订单与权益审计记录。

## 5. 发版前真机验收

- [ ] iOS 已配置小程序简称并开通 iOS 支付。
- [ ] 两个道具均已发布，价格与代码白名单一致。
- [ ] 创建 ¥6 真单，客户端能拉起 `wx.requestVirtualPayment`。
- [ ] 支付成功后收到通知，`payment_orders.status` 变为 `fulfilled`。
- [ ] `user_profiles.growth.plusUntil` 增加 31 天。
- [ ] 同一通知重复发送不会重复增加时长。
- [ ] 购买第二张卡从当前到期日顺延，不覆盖剩余时间。
- [ ] 临时关闭消息推送后，客户端查单能补发权益。
- [ ] Android 退款与 iOS App Store 退款各验证一次。
- [ ] 支付页、购买记录页、后台订单金额一致。

本地开发环境不会伪造支付成功或免费发放正式权益；未连接已配置的云环境时，购买按钮会给出明确错误。

