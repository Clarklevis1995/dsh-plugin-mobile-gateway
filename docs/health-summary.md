# 健康摘要协议


继续使用 `phone_health_daily_summary` / `health.daily-summary`，参数仍为带时区偏移的 `start`、`end` 和 IANA `timeZone`，最长 8 天；不新增网关白名单。`schemaVersion: 2` 的结果保留顶层 `steps`、`sleepMinutes`、`timeZone`、`coverage`、`availability`、`collectedAt`，并新增实际查询的 `start`、`end` 与 `metrics`。

每个 `metrics` 项包含 `value`（数字或 `null`）、`unit`、`aggregation`；体重有记录时还带 `recordedAt`。单位固定，不受设备地区设置影响。下表的“平均”是查询窗口内 HealthKit 的样本统计均值，不是实时测量或按天的趋势序列。

| metrics 字段 | 数据 | unit | aggregation |
| --- | --- | --- | --- |
| `steps` | 步数 | `count` | `sum` |
| `sleepMinutes` | 睡眠时长 | `min` | `union-duration` |
| `walkingRunningDistance` | 步行与跑步距离 | `m` | `sum` |
| `flightsClimbed` | 已爬楼层 | `count` | `sum` |
| `activeEnergy` | 活动能量 | `kcal` | `sum` |
| `basalEnergy` | 静息能量 | `kcal` | `sum` |
| `exerciseMinutes` | Apple 运动时间 | `min` | `sum` |
| `heartRate` | 平均心率 | `bpm` | `average` |
| `restingHeartRate` | 平均静息心率 | `bpm` | `average` |
| `heartRateVariability` | 平均心率变异性（SDNN） | `ms` | `average` |
| `oxygenSaturation` | 平均血氧饱和度（例如 98，而非 0.98） | `%` | `average` |
| `respiratoryRate` | 平均呼吸频率 | `breaths/min` | `average` |
| `bodyMass` | 窗口内最新体重（不查窗口外旧记录） | `kg` | `latest` |

数值查询仅纳入完整落在请求窗口中的样本。睡眠允许跨窗口，裁剪后合并重叠区间，只统计睡着的阶段，避免多来源重复计时；不计入清醒或仅卧床时间。所有数值使用 HealthKit 统计查询，体重使用窗口内按结束时间倒序的单条查询。逐项查询均可取消，原有关闭连接器、网关撤权、租约失效、后台与超时约束继续有效。

已有用户更新 App 后，在手机连接器页将“健康”关闭再开启，系统会对新增数据类型请求授权；用户可逐项拒绝，旧权限不自动扩大。没有记录或未共享的数据返回 `null`，不会冒报为 0，也不据此断言用户拒绝授权。没有手表或其他数据来源时，部分类型可能一直没有记录。仍然只读，不导出原始逐条记录，不申请写入权限。


部署顺序：先更新网关的 v2 回包校验，再更新手机 App。新网关继续接受旧版手机仅含步数和睡眠的回包；旧网关会将 v2 新字段判为 invalid_result。
