# API 接口专项 PRD 模板

针对 RESTful API / GraphQL / Webhook 等接口服务的专项 PRD 模板。

> 用法（DSH 版）：确认项目类型后读本文，把协议/认证、接口清单、错误码、限流、幂等、SLA、版本兼容等专项要求拆进 `features` / `non_functional` / `tech`，接口契约写进对应故事的验收标准。
> prd.md 固定 9 章，不需要为模板另开章节：把下面检查项落到 `prd` 对象的对应字段即可。

---

## 专属章节

### API 概览
- 协议：REST / GraphQL / gRPC
- 认证方式：JWT / OAuth 2.0 / API Key / 签名
- 基础路径：`https://api.example.com/v1`
- 数据格式：JSON
- 字符编码：UTF-8

### 接口清单

#### 1. 用户登录

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "********"
}
```

**响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "token": "eyJhbGc...",
    "expires_at": 1717392000
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | ✅ | 邮箱 |
| password | string | ✅ | 密码 |

---

#### 2. 获取用户信息

```http
GET /users/{id}
Authorization: Bearer {token}
```

### 统一错误码

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|------------|
| 0 | 成功 | 200 |
| 40001 | 参数错误 | 400 |
| 40101 | Token 无效 | 401 |
| 40102 | Token 过期 | 401 |
| 40301 | 无权限 | 403 |
| 40401 | 资源不存在 | 404 |
| 50001 | 服务器内部错误 | 500 |

### 限流策略
- 匿名用户：60 次 / 分钟
- 已登录用户：1000 次 / 分钟
- 白名单：无限制

### 幂等性要求
- 所有写接口支持 `X-Idempotency-Key`
- 有效期：24 小时

### SLA 承诺
- 可用性：99.9%
- P95 响应时间：< 200ms
- 数据持久化：写入后 1s 内可读取

### 文档与工具
- OpenAPI 3.0 规范文档
- Postman Collection
- 在线 Sandbox 环境

### 版本兼容策略
- 向后兼容：旧版本字段保留至少 3 个月
- 废弃通知：接口废弃前邮件通知 + 响应头警告
- 版本号：URL 路径中携带 `/v1/`
